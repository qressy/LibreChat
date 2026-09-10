# Mercury-2 (Inception Labs) — Integration & Performance Assessment

## Context

Following the DeepSeek performance baseline (~11s for "I want to buy bag"), Mercury-2 from Inception Labs was evaluated as a potential faster alternative. This document records the full test history across three configurations: baseline Mercury without a system prompt, Mercury after adding a `promptPrefix` with few-shot tool call examples, and DeepSeek for comparison.

**Date:** June 2026
**Model:** `mercury-2` (Inception Labs)
**Branch:** `feat/mcp-apps-support`
**Stack:** Browser → LibreChat (Docker, port 3080) → Inception API (`https://api.inceptionlabs.ai/v1`) → Comergent MCP server

---

## Integration

Mercury's API is fully OpenAI-compatible — integration required only a `librechat.yaml` change, no code changes.

```yaml
endpoints:
  custom:
    - name: "Inception"
      apiKey: "${INCEPTION_API_KEY}"
      baseURL: "https://api.inceptionlabs.ai/v1"
      models:
        default: ["mercury-2"]
        fetch: false
      titleConvo: true
      titleModel: "mercury-2"
      modelDisplayLabel: "Mercury"

modelSpecs:
  list:
    - name: "comergent-mercury"
      label: "Comergent"
      default: true
      mcpServers: ["comergent"]
      preset:
        endpoint: "Inception"
        model: "mercury-2"
        promptPrefix: |   # ← added in Phase 2
          ...
```

---

## Test Methodology

- **Query:** "I want to buy bag" (single `search_catalog` + `render_product_results` tool cycle)
- **Playwright script:** `e2e/comergent-perf.mjs` — headless Chromium, measures browser-side resource timing
- **Server logs:** `docker logs LibreChat 2>&1 | grep -E "LLM call complete|Invoking LLM|tool call completed|FINAL"` — authoritative server-side wall-clock
- **Note on Playwright TOTAL:** The script's `responsePromise` resolves on the first matching API response, which is a quick setup endpoint (`/api/agents/chat/Inception`, ~40ms), not the LLM stream. The "Stream end → text visible" segment inflates to 6–8s, making Playwright TOTAL ~11s regardless of true completion time. **Server FINAL event is the authoritative measure.**

---

## Phase 1 — Mercury Without System Prompt (Baseline)

### Server-Side LLM Call Sequence

Query submitted: `21:38:14.935Z`

| Step | Duration | Cumulative |
|---|---|---|
| LLM call 1 | 0.83s | T+1.5s |
| LLM call 2 | 0.75s | T+2.3s |
| LLM call 3 | 0.60s | T+2.9s |
| LLM call 4 | 0.95s | T+3.9s |
| LLM call 5 | 0.69s | T+4.6s |
| LLM call 6 | 1.29s | T+5.9s |
| LLM call 7 | 1.17s | T+7.1s |
| LLM call 8 | 1.46s | T+8.5s |
| LLM call 9 | 1.26s | T+9.8s |
| `search_catalog` MCP | 580ms | T+10.4s |
| LLM call 10 | 2.00s | T+12.6s |
| `render_product_results` MCP | 16ms | T+12.6s |
| LLM call 11 | 0.48s | T+13.1s |
| **FINAL event** | — | **T+13.2s** |

**Schema errors on search_catalog: 8** (Mercury spent 9 LLM rounds guessing the correct argument structure before a successful call on round 10)

**Key observation:** Mercury-2 is a diffusion model — it makes many short sequential LLM API calls instead of one long stream. Each call refines the output. Without tool call examples it spent all 9 pre-MCP rounds trying different argument formats.

---

## Phase 2 — Mercury With `promptPrefix` (Few-Shot Examples)

### What Was Added

Added `promptPrefix` to the model spec preset in `librechat.yaml`. The prompt includes:
- The shopping flow (search → render → cart)
- Correct `search_catalog` argument structure, explicitly noting `pagination` is a sibling of `catalog`, not nested inside it
- Correct `render_product_results` argument structure
- Response style guidance (brief intro + `\ui{}` marker)

This becomes the base system instructions; MCP server instructions are appended after.

### Run 1 — `21:55:56Z`

| Step | Duration | Cumulative |
|---|---|---|
| LLM call 1 | 1.54s | T+1.5s |
| `search_catalog` MCP | 471ms | T+2.0s |
| LLM call 2 | 1.15s | T+3.2s |
| `render_product_results` MCP | 25ms | T+3.2s |
| LLM call 3 | 0.45s | T+3.7s |
| **FINAL event** | — | **T+4.5s** |

Schema errors: **0** — search_catalog succeeded on the first attempt.

SSE stream (from browser resource timing): started T+3.0s, duration 3.3s, **48.7 KB** transferred.

### Run 2 — `21:56:54Z` (warm cache)

| Step | Duration | Cumulative |
|---|---|---|
| LLM call 1 | 0.84s | T+0.8s |
| `search_catalog` MCP | 303ms | T+1.2s |
| LLM call 2 | 1.23s | T+2.4s |
| `render_product_results` MCP | 11ms | T+2.4s |
| LLM call 3 | 0.68s | T+3.1s |
| **FINAL event** | — | **T+3.3s** |

Schema errors: **0**

SSE stream: started T+2.8s, duration 2.3s, **48.8 KB** transferred.

---

## Full Comparison

| Metric | DeepSeek v4-flash | Mercury-2 (no prompt) | Mercury-2 (with promptPrefix) |
|---|---|---|---|
| LLM calls per query | 2 | **11** | **3** |
| Total LLM time | ~9.5s | ~11.5s | **~2.8s** |
| `search_catalog` | 479ms | 580ms | 303–471ms |
| `render_product_results` | 10ms | 16ms | 11–25ms |
| Schema errors | 0 | **8** | **0** |
| **True wall-clock (server FINAL)** | **~11.1s** | ~13.2s | **3.3–4.5s** |
| vs DeepSeek | baseline | +2.1s slower | **~2.7× faster** |

---

## Root Cause of Phase 1 Failures

Mercury's diffusion architecture iteratively refines output over multiple rounds. Without tool call examples in the system prompt, Mercury was reasoning its way to the correct argument schema from scratch across 9 rounds:

- Rounds 1–3: nested `pagination` inside `catalog` → schema error
- Rounds 4–6: added/removed `businessUrl: null` → schema error
- Rounds 7–9: tried flat argument structures → schema error
- Round 10: dropped all optional fields → `{"arguments": {"catalog": {"query": "bag"}}}` → ✅

The `promptPrefix` eliminated this entirely by showing the exact correct structure up front.

---

## Why Mercury Is Now Faster Than DeepSeek

DeepSeek (autoregressive) makes 2 LLM calls totalling ~9.5s of LLM time — the second call is slow because it must process the full tool-results payload (product catalog data) before streaming a response.

Mercury (diffusion) makes 3 LLM calls totalling ~2.8s — each individual call is short (0.45–1.54s) because diffusion rounds are inherently bounded. The tool-result payload doesn't proportionally inflate the cost of any single round.

```
DeepSeek:
  LLM₁ [──────── 2s ────────]
  search_catalog [─ 480ms ─]
  LLM₂ [────────────────────── 7.5s ──────────────────────]
  Total: ~11s

Mercury (with promptPrefix):
  LLM₁ [── 1s ──]
  search_catalog [─ 400ms ─]
  LLM₂ [── 1s ──]
  render [─ 20ms ─]
  LLM₃ [─ 0.5s ─]
  Total: ~3.5s
```

---

## Phase 3 — Tool Consolidation (`search_products`)

Even at 3 LLM calls, the flow carried a structural cost: `search_catalog` returned the **entire compacted product payload as JSON text** (~48KB) to the LLM, which then **re-emitted that whole `products` array** as the arguments to `render_product_results`. That re-emission was the most expensive generation in the turn — the LLM acting as a copy-paste buffer between two tools.

### Root cause (confirmed in code)

- `shopify-catalog-mcp/src/tools/utils/toolResult.ts` — `proxyToolResult` does `JSON.stringify(value)` of the full payload into `content[].text`, which is exactly what LibreChat forwards to the model.
- `search_catalog` had no `_meta.ui.resourceUri`, so it could not render on its own and depended on a second `render_product_results` call.
- LibreChat's MCP-apps bridge (`packages/api/src/mcp/parsers.ts` → `formatToolContent`) routes a tool's `structuredContent`/UI resource into the LangChain `ToolMessage.artifact`, which is **excluded from the LLM context**. Only `content[].text` reaches the model.

### Change

The two tools were folded into one `search_products` MCP tool (`shopify-catalog-mcp`):
- runs the upstream UCP `search_catalog` search + `compactCatalogResults` (unchanged),
- declares the same `_meta.ui.resourceUri` (`ui://widget/product-results-v10.html`) so LibreChat renders the product-cards widget directly,
- returns the **full product data in `structuredContent`** (→ widget/artifact, never seen by the LLM) and a **lean text summary** (`productResultsSummary`: per-product title / variantId / price / businessUrl — no descriptions or image URLs) as `content[].text`.

`search_catalog` and `render_product_results` are unregistered (kept commented for a future text/JSON-only agentic variant). The `librechat.yaml` `promptPrefix` was simplified to the single-tool flow.

### Measured impact

| | Before (Phase 2) | After (Phase 3) |
|---|---|---|
| Distinct MCP tool calls | `search_catalog` + `render_product_results` | **`search_products` only** |
| LLM calls per query | 3 | **2–3** (no render round-trip; extra calls are just diffusion rounds to emit the one tool call) |
| Products array re-emitted by LLM | yes (~48KB output) | **no** |
| Tool payload into LLM context | full JSON (~48KB) | **lean summary (~530 bytes)** |
| SSE stream transfer | ~48.8 KB | **~19.5 KB** |
| Widget paints | after 2nd LLM call + render tool | **on the first/only tool return** |
| True wall-clock (server FINAL) | 3.3–4.5s | **~2.8–3.3s** |

Verified live against the running MCP server: `search_products` returns the full product set (id, title, businessUrl, variantId, merchantName, price, priceText, imageUrl, description) in `structuredContent`, and a 532-byte lean summary in `content[].text`.

Two e2e runs (`e2e/comergent-perf.mjs`):
- "I want to buy bag" — submit → FINAL ~2.8s; LLM call 1 (0.97s) → `search_products` (345ms) → LLM call 2 (0.70s) → FINAL. Stream 19.5 KB.
- "show me leather wallets" — submit → FINAL ~3.3s; two diffusion rounds (0.98s, 0.98s) to emit the tool call → `search_products` (526ms) → final round (0.57s) → FINAL. No `render_product_results` in either.

Flow becomes: **LLM emits one `search_products` call (widget paints on its return) → one short closing sentence.** The render round-trip and the 48KB products re-emission are gone; the wall-clock gain is modest (Mercury per-call latency dominates) but the token/context cost drop is large.

---

## Current Configuration

Mercury-2 with `promptPrefix` is the active default in `librechat.yaml` (`comergent-mercury` model spec, `default: true`).

The `promptPrefix` is the key enabler — without it, Mercury regresses to 13s and 8 schema errors. It should be kept and extended as new tools or shopping flows are added.

---

## SSE Stream Observations

Both runs transferred ~48.8 KB over the SSE stream (the product catalog data + rendered response). Stream duration tracks closely with server FINAL timing:

| Run | Stream start | Stream duration | Transfer |
|---|---|---|---|
| Run 1 | T+3.0s | 3.3s | 48.7 KB |
| Run 2 | T+2.8s | 2.3s | 48.8 KB |

The transfer size is dominated by the product data returned by `search_catalog` (4 products with full descriptions, image URLs, etc.). Reducing this payload (e.g. limiting to 3 products, dropping `description` field) would shrink the stream and could shave another 0.5–1s.

---

## Next Optimisation Directions

| Lever | Expected impact | Effort |
|---|---|---|
| Reduce `search_catalog` payload (fewer products, fewer fields) | ~0.5–1s | Low (MCP server change) |
| Re-enable streaming visibility (`showProcessingSteps: true`) | Same 3.5s feels like 1s — user sees tokens arrive | Zero (config only) |
| Extend `promptPrefix` with cart/checkout examples | Eliminate retries on cart flows too | Low (yaml only) |
| Tune Mercury `temperature` / `max_tokens` in preset | May reduce per-round duration | Low (yaml only) |
