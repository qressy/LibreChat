# Comergent Demo — Performance Debugging & Latency Analysis

## Context

A buying query such as "I want to buy bag" takes ~11 seconds end-to-end in the Comergent demo. This document records the debugging process used to identify where that time goes, the tooling built to measure it, and the conclusions reached.

**Date:** June 2026  
**Branch:** `feat/comergent-branding`  
**Stack:** Browser → LibreChat (Docker, port 3080) → DeepSeek API → Comergent MCP server (host.docker.internal:8787)

---

## Request Architecture

Every tool-calling query follows this sequential path:

```
Browser
  └─▶ LibreChat API (Express in Docker)
        └─▶ DeepSeek LLM call #1   — model reasons and emits tool call(s)
              └─▶ MCP tool call(s) — POST http://host.docker.internal:8787/mcp
                    └─▶ DeepSeek LLM call #2 — synthesises tool results into answer
                          └─▶ SSE stream → browser
```

Each arrow adds latency. Simple arithmetic: 3s LLM₁ + 0.5s MCP + 3s LLM₂ = 6.5s theoretical floor for a single-tool query. Anything above that is overhead or model slowness.

---

## Instrumentation Added

### 1 — Server-side MCP call timing

**File:** [`packages/api/src/mcp/MCPManager.ts`](../../packages/api/src/mcp/MCPManager.ts) (~line 642)

Wraps the `connection.client.request()` call that dispatches to the MCP server with `Date.now()` bookends:

```typescript
const mcpCallStart = Date.now();
const result = await connection.client.request({ method: 'tools/call', ... });
logger.debug(`${logPrefix}[${toolName}] tool call completed in ${Date.now() - mcpCallStart}ms`);
```

Log pattern produced:
```
[MCP][User: <uid>][comergent][<toolName>] tool call completed in <N>ms
```

This requires a Docker rebuild to take effect (`docker compose up --build`).

### 2 — Debug logging enabled

**File:** [`.env`](../../.env)

```dotenv
DEBUG_LOGGING=true      # writes debug-level entries to ./api/logs/debug-*.log
DEBUG_CONSOLE=true      # also prints debug logs to stdout (docker logs)
AGENT_DEBUG_LOGGING=true
```

With these set, the existing LLM call timing in the codebase becomes visible:
- `api/server/controllers/agents/responses.js:845` — `[Responses API] Request ... completed in <N>ms (streaming)`
- `api/server/controllers/agents/openai.js:807` — `[OpenAI API] Response ... completed in <N>ms (streaming)`

Only `docker restart LibreChat` needed (no rebuild) for this change.

### 3 — Playwright end-to-end timing script

**File:** [`e2e/comergent-perf.mjs`](../../e2e/comergent-perf.mjs)

Headless Chromium script that logs in, submits a query, and reports three timing segments:

| Segment | Measured via |
|---|---|
| Submit → TTFB | `Date.now()` at Enter keypress vs. first matching API response event |
| TTFB → stream end | `response.body()` promise resolution |
| Stream end → text visible | `waitForFunction` on send-button re-enablement |

Also dumps the browser's `performance.getEntriesByType('resource')` waterfall for every `/api/agents/*` call.

**Usage:**
```bash
# Run from the scratchpad dir where playwright is installed, or install locally:
cd e2e && npm install playwright
node e2e/comergent-perf.mjs "I want to buy bag"
node e2e/comergent-perf.mjs "show me leather wallets under $100"
```

Environment overrides:
```bash
E2E_USER_EMAIL=your@email.com E2E_USER_PASSWORD=yourpassword node e2e/comergent-perf.mjs "query"
```

---

## Metrics Tracked

### End-to-end (Playwright)

| Metric | Description |
|---|---|
| Submit → TTFB | Wall-clock from Enter keypress to first byte of streaming API response |
| TTFB → stream end | Duration of the SSE stream (how long tokens take to arrive) |
| Stream end → text visible | React render time (should be < 100ms; longer = UI issue) |
| **TOTAL** | Full user-perceived latency |

> **Note on TTFB measurement:** Playwright's `response` event fires on the first matching URL (which may be a quick setup endpoint, not the main LLM stream). For more precise TTFB, filter for the SSE response by checking `Content-Type: text/event-stream` or targeting the endpoint URL pattern `/api/agents/chat/<endpointName>`.

### Per-tool (server logs)

```
[MCP][User: <uid>][<server>][<toolName>] tool call completed in <N>ms
```

Captures pure MCP round-trip latency: from LibreChat sending `tools/call` to receiving the result. Does **not** include time spent in DeepSeek deciding to call the tool.

### LLM call (server logs)

```
[OpenAI API] Response <id> completed in <N>ms (streaming)
```

Total time DeepSeek takes to stream all tokens for a single completion. Covers both the "decide what to do" call and the "synthesise tool results" call; they each produce a separate log entry.

---

## Observed Baseline (June 2026)

Query: `"I want to buy bag"` — single `search_catalog` + `render_product_results` tool call cycle

| Segment | Observed |
|---|---|
| `search_catalog` MCP call | **479 ms** |
| `render_product_results` MCP call | **10 ms** |
| DeepSeek LLM (both calls combined) | **~9.5 s** (inferred as remainder) |
| Total wall-clock | **~11.1 s** |

### Key finding: MCP is not the bottleneck

Both MCP calls together took under 500ms. The Comergent server at `host.docker.internal:8787` is fast.

**The bottleneck is DeepSeek `deepseek-v4-flash` latency.** Roughly 9 of the 11 seconds are spent waiting for LLM completions.

---

## How to Run a Diagnostic Session

```bash
# Terminal 1 — live server logs filtered to timing entries
docker logs -f LibreChat 2>&1 | grep -E "tool call completed|completed in.*streaming"

# Terminal 2 — Playwright timing script
node e2e/comergent-perf.mjs "I want to buy bag"
```

Cross-reference: the timestamps in `docker logs` output (UTC) will fall within the Playwright test window, letting you correlate each log line with the overall timeline.

---

## Optimization Levers (given the bottleneck is LLM latency)

| Lever | Expected impact | Effort |
|---|---|---|
| **Re-enable streaming visibility** (`showProcessingSteps: true`) | Makes 9s feel like 3s — user sees tokens as they arrive instead of waiting for the full response | Zero — config only |
| **Shorten system prompt / tool descriptions** | Fewer input tokens → faster time-to-first-token | Low |
| **Reduce output verbosity** | Prompt the model to respond concisely; fewer output tokens → shorter stream | Low |
| **Switch model** | Try a smaller/faster DeepSeek variant or another provider with lower TTFB | Low (config only) |
| **Parallel tool calls** | If the model supports it, multiple tools can run concurrently instead of sequentially | Medium (model + prompt work) |
| **Response caching** | Cache common catalog queries at the MCP server layer | Medium (MCP server work) |

---

## Files Changed for This Debugging Setup

| File | Change | Reversible? |
|---|---|---|
| `packages/api/src/mcp/MCPManager.ts` | Added `Date.now()` timing around MCP `tools/call` dispatch | Yes — remove the 2 added lines |
| `.env` | `DEBUG_CONSOLE=true`, `AGENT_DEBUG_LOGGING=true` | Yes — revert to `false` for production |
| `e2e/comergent-perf.mjs` | New Playwright timing script | Keep — useful for ongoing monitoring |

---

## Existing Timing Hooks in the Codebase (No Changes Needed)

| Location | What it times | Log level |
|---|---|---|
| `api/server/controllers/agents/responses.js:294,845` | Full LLM streaming request duration | `debug` |
| `api/server/controllers/agents/openai.js:160,807` | Same, OpenAI-compat path | `debug` |
| `packages/api/src/agents/stream.ts` (`SseStreamTelemetry`) | `time_to_first_chunk_ms`, chunk count, bytes sent | internal only |
| `packages/api/src/mcp/MCPManager.ts:511` | `logPrefix` includes server name and userId for all MCP logs | — |

---

## MCP Connection Timing (from logs)

On first use per session, the MCP server goes through a lazy-init handshake:

```
[MCP][comergent] Initialized in: 238ms
```

This 238ms is a one-time cost per server instance (not per tool call). Subsequent tool calls skip straight to `tools/call`.

---

## Reference: Relevant env vars for logging

Full list at [LibreChat env docs](https://www.librechat.ai/docs/configuration/dotenv).

| Variable | Default | Effect |
|---|---|---|
| `DEBUG_LOGGING` | `true` | Writes debug logs to `./api/logs/debug-<date>.log` inside the container |
| `DEBUG_CONSOLE` | `false` | Also prints debug logs to stdout (visible in `docker logs`) |
| `AGENT_DEBUG_LOGGING` | `false` | Agent-specific debug events (tool calls, agent steps) |
| `LOG_TO_FILE` | `true` | File-backed Winston transports; set `false` for stdout-only |
| `MEM_DIAG` | unset | Heap/RSS snapshots every 60s (useful for memory leak diagnosis) |
