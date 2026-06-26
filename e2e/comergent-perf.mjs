/**
 * Comergent buying-query performance measurement script.
 *
 * Measures end-to-end latency for a shopping query and breaks it down into:
 *   1. Submit → TTFB  (time until the streaming API responds with first byte)
 *   2. TTFB → stream end  (time to stream the full response)
 *   3. Stream end → text visible  (React render time)
 *
 * Usage:
 *   node e2e/comergent-perf.mjs [query]
 *   node e2e/comergent-perf.mjs "I want to buy bag"
 *
 * Prerequisites: `npm install playwright` (or use npx)
 */

import { chromium } from 'playwright';

const BASE = 'http://localhost:3080';
const EMAIL = process.env.E2E_USER_EMAIL ?? 'playwright@test.local';
const PASSWORD = process.env.E2E_USER_PASSWORD ?? 'PlaywrightTest123!';
const QUERY = process.argv[2] ?? 'I want to buy bag';
const RESPONSE_TIMEOUT_MS = 90_000;

function fmt(ms) {
  return ms == null ? '—' : `${ms.toLocaleString('en')} ms`;
}

function printTable(rows) {
  const maxLabel = Math.max(...rows.map((r) => r[0].length));
  for (const [label, value, note] of rows) {
    const pad = ' '.repeat(maxLabel - label.length);
    console.log(`  ${label}${pad}  ${value}${note ? `   ← ${note}` : ''}`);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true, slowMo: 0 });
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();

  // ── Auth ─────────────────────────────────────────────────────────────────
  await page.goto('/');
  await page.waitForTimeout(1500);
  if (await page.getByTestId('login-button').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByTestId('login-button').click();
    await page.waitForURL(/\/c\//, { timeout: 15_000 });
  }

  await page.goto('/c/new');
  await page.waitForTimeout(1500);

  // ── Wire up response interception BEFORE sending the message ─────────────
  let apiTtfbMs = null;
  let apiStreamEndMs = null;
  let submitTs = null;

  const responsePromise = new Promise((resolve) => {
    page.on('response', async (response) => {
      const url = response.url();
      if (!url.includes('/api/ask') && !url.includes('/api/agents') && !url.includes('/api/chat')) {
        return;
      }
      if (submitTs == null) return;

      // Playwright fires 'response' when the first byte of the response headers/body arrives — that's TTFB
      if (apiTtfbMs == null) {
        apiTtfbMs = Date.now();
      }

      // Consume the body to know when the stream ends
      response
        .body()
        .then(() => {
          apiStreamEndMs = Date.now();
          resolve();
        })
        .catch(() => resolve());
    });
  });

  // ── Send the query ────────────────────────────────────────────────────────
  const textarea = page.getByTestId('text-input');
  await textarea.waitFor({ timeout: 5_000 });
  await textarea.fill(QUERY);

  submitTs = Date.now();
  console.log(`\n⏱  Query: "${QUERY}"`);
  console.log(`   Submitted at: ${new Date(submitTs).toISOString()}\n`);

  await textarea.press('Enter');

  // ── Wait for stream to finish (or timeout) ───────────────────────────────
  await Promise.race([
    responsePromise,
    page.waitForTimeout(RESPONSE_TIMEOUT_MS),
  ]);

  // ── Wait for the assistant message text to appear in DOM ─────────────────
  let domVisibleMs = null;
  try {
    await page.waitForSelector('[data-testid="message-text"], [data-message-author-role="assistant"]', {
      timeout: 10_000,
    });
    // Also wait until the send button is re-enabled (streaming done)
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="send-button"]');
        return btn && !btn.hasAttribute('disabled');
      },
      { timeout: RESPONSE_TIMEOUT_MS },
    ).catch(() => {});
    domVisibleMs = Date.now();
  } catch {
    domVisibleMs = Date.now();
  }

  // ── Browser-side resource timing for the API call ────────────────────────
  const resourceEntries = await page.evaluate(() => {
    return performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes('/api/ask') || e.name.includes('/api/agents') || e.name.includes('/api/chat'))
      .map((e) => ({
        name: e.name,
        startTime: Math.round(e.startTime),
        duration: Math.round(e.duration),
        ttfb: Math.round(e.responseStart - e.requestStart),
        transferSize: e.transferSize,
      }));
  });

  // ── Compute deltas ────────────────────────────────────────────────────────
  const streamEnd = apiStreamEndMs ?? domVisibleMs;
  const ttfbDelta = apiTtfbMs != null ? apiTtfbMs - submitTs : null;
  const streamDuration = streamEnd != null && apiTtfbMs != null ? streamEnd - submitTs - ttfbDelta : null;
  const renderDelta = domVisibleMs != null && streamEnd != null ? domVisibleMs - streamEnd : null;
  const totalDelta = domVisibleMs != null ? domVisibleMs - submitTs : null;

  // ── Print results ─────────────────────────────────────────────────────────
  console.log('─── End-to-End Timing Breakdown ─────────────────────────────');
  printTable([
    ['Submit → TTFB', fmt(ttfbDelta), 'LLM call(s) + MCP round-trip(s)'],
    ['TTFB → stream end', fmt(streamDuration != null ? streamDuration : streamEnd != null ? streamEnd - submitTs : null), 'streaming the answer tokens'],
    ['Stream end → text visible', fmt(renderDelta), 'React render'],
    ['TOTAL', fmt(totalDelta), ''],
  ]);

  if (resourceEntries.length > 0) {
    console.log('\n─── Browser Resource Timing (API calls) ─────────────────────');
    for (const e of resourceEntries) {
      console.log(`  ${new URL(e.name).pathname}`);
      printTable([
        ['  start (page-relative)', fmt(e.startTime)],
        ['  TTFB (requestStart→responseStart)', fmt(e.ttfb), 'LLM + MCP time before first byte'],
        ['  total duration', fmt(e.duration)],
        ['  transfer size', e.transferSize ? `${(e.transferSize / 1024).toFixed(1)} KB` : '(unknown — CORS or streaming)'],
      ]);
    }
  }

  console.log('\n─── Interpretation Guide ────────────────────────────────────');
  console.log('  TTFB > 4s  → Check server logs for slow LLM or MCP call:');
  console.log('    docker logs LibreChat 2>&1 | grep -E "completed in|tool call completed"');
  console.log('  TTFB < 2s  → Streaming issue; check chunk delivery');
  console.log('  MCP log pattern: [MCP][comergent][<tool>] tool call completed in <N>ms');
  console.log('  LLM log pattern: [OpenAI API] Response ... completed in <N>ms (streaming)');
  console.log('─────────────────────────────────────────────────────────────\n');

  await browser.close();
}

run().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
