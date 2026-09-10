# DeepSeek Thinking Mode — Investigation & Findings

## Context

Following the performance baseline (see [performance-debugging.md](./performance-debugging.md)), the obvious hypothesis was that DeepSeek's internal reasoning chain was inflating the ~11s response time. This document records what we tried, the exact API measurements, and the conclusion.

**Date:** June 2026  
**Model:** `deepseek-v4-flash`  
**Branch:** `feat/comergent-branding`

---

## Background: How deepseek-v4-flash Thinking Works

`deepseek-v4-flash` is the unified successor to two older models:

| Old model | Behaviour | Status |
|---|---|---|
| `deepseek-chat` | No thinking/reasoning | Deprecated July 2026 |
| `deepseek-reasoner` | Always thinking | Deprecated July 2026 |
| **`deepseek-v4-flash`** | Thinking on by default, controllable via API | **Current** |

Thinking is enabled by default. Before generating its answer, the model produces a `reasoning_content` chain — an internal scratchpad — that does not appear in the final `content` field but is returned alongside it.

### API parameter to control it

```json
{ "thinking": { "type": "disabled" } }
{ "thinking": { "type": "enabled" } }
```

This goes in the request body alongside `model`, `messages`, etc. In OpenAI-compatible clients it maps to `extra_body`.

---

## What the Existing Config Was Doing

In `librechat.yaml`:

```yaml
customParams:
  reasoningFormat: disabled
```

**What this does:** Tells LibreChat's internal plumbing not to add a `reasoning_effort` parameter to the request. This is a LibreChat-level switch — it does not send anything to DeepSeek about thinking.

**What it does NOT do:** It does not send `thinking: {type: "disabled"}` to DeepSeek. The model was still doing full thinking on every call.

`reasoningFormat: disabled` was already correct for keeping LibreChat's UI from trying to render thinking content (together with `showProcessingSteps: false`). But thinking was still happening at the model level.

---

## What We Tried

Added `addParams` to the endpoint config so LibreChat would pass `thinking: {type: "disabled"}` as `extra_body` to every DeepSeek API call:

```yaml
# librechat.yaml — TESTED, then reverted
endpoints:
  custom:
    - name: "DeepSeek"
      addParams:
        thinking:
          type: "disabled"
      customParams:
        reasoningFormat: disabled
```

In LibreChat's codebase, unknown keys in `addParams` are routed to `modelKwargs` in `packages/api/src/endpoints/openai/llm.ts:601`, which the OpenAI SDK sends as `extra_body` — the correct mechanism for DeepSeek's non-standard parameters.

---

## Direct API Measurements

To isolate the effect independently of LibreChat, both modes were called directly against the DeepSeek API.

### Test 1 — Trivial query ("Say hello in one sentence.")

| Mode | Latency | Prompt tokens | Output tokens | Has `reasoning_content` |
|---|---|---|---|---|
| thinking = default (on) | 1,128 ms | 10 | 29 | Yes |
| thinking = disabled | 1,089 ms | 10 | 2 | No |

Difference: **39 ms** — negligible. The thinking overhead was tiny for a trivial query.

### Test 2 — Realistic shopping query

System prompt describing a shopping assistant with `search_catalog` and `get_product` tools. User message: `"I want to buy a bag"`.

| Mode | Latency | Prompt tokens | Output tokens | Reasoning chars |
|---|---|---|---|---|
| thinking = default (on) | **1,232 ms** | 45 | **41** | 86 |
| thinking = disabled | 1,917 ms | 45 | 103 | 0 |

**Thinking enabled was 685 ms faster and generated 62 fewer output tokens.**

---

## Why Disabling Thinking Made Things Worse

When thinking is enabled, the model reasons internally (86 chars of private scratchpad), then produces a tight, targeted tool call (41 tokens). When thinking is disabled, the model has no internal space to reason, so it works out loud in the final response — generating 103 tokens of hedging and elaboration before arriving at the tool call.

This is a known characteristic of reasoning models: the thinking budget acts as a scratchpad that allows the visible output to be more concise and direct.

For a tool-calling flow specifically, thinking helps the model commit quickly to a tool call rather than reasoning verbosely through its chain-of-thought in the completion.

---

## Conclusion

| Change | Effect | Decision |
|---|---|---|
| `addParams: thinking: {type: "disabled"}` | Slower by ~685ms, more output tokens | **Reverted** |
| `customParams: reasoningFormat: disabled` | Correct — prevents LibreChat from adding `reasoning_effort` to requests | **Kept** |
| `showProcessingSteps: false` | Hides thinking content in UI | **Kept** |

**The configuration is correct as-is.** Thinking runs at the model level (helping it be efficient), but the reasoning chain is neither displayed in the UI nor sent as a LibreChat reasoning parameter.

The ~11s total latency is the genuine floor for this query type on `deepseek-v4-flash`:
- LLM call #1 (decide to call tool): ~1.2–2s
- MCP `search_catalog` call: ~480ms
- MCP `render_product_results` call: ~10ms  
- LLM call #2 (synthesise results + generate answer): ~7–8s

The second LLM call dominates. It is slow because the context by that point includes the full tool results payload (product catalog data from the MCP server), which is large. That is the real optimisation target.

---

## Next Optimisation Direction

The bottleneck is LLM call #2 processing a large tool-result payload. Possible levers:

- **Reduce catalog response size** — return fewer fields or fewer products per `search_catalog` call from the MCP server
- **Limit output length** — prompt the model to respond with a concise summary rather than a full product listing
- **Streaming feels faster** — since `showProcessingSteps: false` hides all intermediate output, the user sees nothing for the full 11s then gets the complete answer. Re-enabling streaming visibility would make the same latency feel like 3–4s
- **Try `deepseek-v4-pro`** — the pro variant may have different latency characteristics; worth a direct comparison using the same measurement method above
