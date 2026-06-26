# Comergent Fork — Maintenance Guide

## Fork Lineage

This repository is a **product fork** of [LibreChat](https://github.com/danny-avila/LibreChat) maintained by Comergent for the agentic-commerce product.

```
upstream/main          ← official LibreChat releases
      │
upstream/dev           ← active LibreChat development branch
      │
upstream/feat/mcp-apps-support  ← PR branch (not yet merged into dev as of fork date)
      │
origin/feat/comergent-branding  ← THIS branch (our working fork base)
```

**Critical**: This fork was cut from `feat/mcp-apps-support`, which is an **unmerged PR targeting `dev`** (not `main`). That branch contains MCP application-widget support that upstream has not shipped yet. This means:

- We are ahead of `upstream/dev` on MCP app features.
- When `feat/mcp-apps-support` merges into `upstream/dev`, we must rebase/merge from `upstream/dev` carefully — most of our MCP changes will already be present upstream, so do **not** simply accept "ours" or "theirs" wholesale.
- When `upstream/dev` eventually merges to `upstream/main` (a new LibreChat release), rebase again from `upstream/main`.

---

## Sync Strategy

### Adding the upstream remote (one-time)

```bash
git remote add upstream https://github.com/danny-avila/LibreChat.git
git fetch upstream
```

### Priority order for pulling upstream changes

```bash
# Step 1 — When feat/mcp-apps-support lands in upstream/dev:
git fetch upstream
git merge upstream/dev
# Resolve conflicts using the table below; favour upstream for shared logic,
# keep our additions for Comergent-specific behaviour.

# Step 2 — When upstream/dev ships to upstream/main (new release):
git fetch upstream
git merge upstream/main
```

### Expected merge conflicts

The table below lists every file we have modified and the expected conflict risk at merge time.

| File | Our change | Upstream conflict risk |
|---|---|---|
| `.gitignore` | Un-ignores `librechat.yaml` and `docker-compose.override.yaml` | Low — different patterns |
| `librechat.yaml` | Comergent runtime config (tracked, not ignored) | None — upstream ignores this file |
| `docker-compose.override.yaml` | Comergent deployment overrides (tracked) | None — upstream ignores this file |
| `package.json` | Added `playwright` dev dependency | Medium — upstream may change root deps |
| `packages/data-provider/src/config.ts` | Added `showProcessingSteps` field to `interfaceSchema` | Medium — interface schema grows often |
| `packages/data-provider/src/types.ts` | Added `locale` field to `TPayload` | Low |
| `packages/data-provider/src/createPayload.ts` | Sends `locale` with each request | Low |
| `packages/data-schemas/src/app/interface.ts` | Passes `showProcessingSteps` through `loadDefaultInterface` | Low |
| `packages/api/src/types/http.ts` | Added `locale` to `RequestBody` | Low |
| `packages/api/src/utils/env.ts` | Added `locale` and `timezone` to `ALLOWED_BODY_FIELDS` | Low |
| `packages/api/src/mcp/utils.ts` | Added `TIMEZONE`/`LOCALE` BODY placeholder mappings | Medium — MCP utils evolve with upstream |
| `packages/api/src/mcp/MCPManager.ts` | Adds `x-buyer-timezone`/`x-buyer-locale` headers; timing log | High — MCPManager is actively developed upstream |
| `packages/api/src/agents/initialize.ts` | Appends buyer locale/timezone to agent instructions | Medium |
| `api/server/controllers/agents/client.js` | Forwards `timezone`/`locale` from request body to MCP context | Medium |
| `client/.../ModelSelector.tsx` | `ModelSelectorBranding` component shown when `modelSelect: false` | Medium — menu components change |
| `client/.../Part.tsx` | Respects `showProcessingSteps` to hide thinking/tool parts | Medium |
| `client/.../ContentParts.tsx` | Restores loading cursor when processing steps are hidden | Medium |

---

## Our Custom Features

### 1. `showProcessingSteps` config flag

Controls whether thinking blocks, tool-call pills, and MCP app widgets appear in chat messages.

- **Config**: `interface.showProcessingSteps: false` in `librechat.yaml`
- **Schema**: `packages/data-provider/src/config.ts` → `interfaceSchema`
- **Frontend gate**: `Part.tsx` skips rendering `THINK` and `TOOL_CALL` parts; `ContentParts.tsx` keeps the streaming-cursor visible until the first real text lands so the UI does not appear frozen while the model works.

### 2. Buyer locale and timezone forwarding to MCP

The browser's BCP-47 locale (e.g. `en-IN`) and IANA timezone are sent on every request and forwarded to MCP tool calls, letting region-aware services scope results (prices in local currency, local store availability, etc.).

- **Frontend sends**: `createPayload.ts` reads `navigator.language` → `locale` payload field
- **Placeholder syntax for MCP server config**: `{{LIBRECHAT_BODY_LOCALE}}` / `{{LIBRECHAT_BODY_TIMEZONE}}`
- **HTTP headers injected on MCP calls**: `x-buyer-locale`, `x-buyer-timezone`
- **Agent system prompt**: `initialize.ts` appends `Buyer context — locale: X, timezone: Y` to agent instructions

### 3. ModelSelector branding when `modelSelect: false`

When the operator disables model selection, the selector area still renders the current model's icon and display name instead of disappearing, preserving visual context for the user.

- **Component**: `ModelSelectorBranding` in `client/src/components/Chat/Menus/Endpoints/ModelSelector.tsx`
- **Trigger**: `interface.modelSelect: false` in `librechat.yaml`

---

## Comergent Runtime Config

`librechat.yaml` and `docker-compose.override.yaml` are **tracked in this fork** (upstream ignores them via `.gitignore`). They contain Comergent-specific deployment settings and must not be removed from version control.

Keep secrets out of these files — place API keys in `.env` (which remains git-ignored) and reference them via `${ENV_VAR}` syntax in `librechat.yaml`.

---

## Branch Naming Convention

| Branch | Purpose |
|---|---|
| `feat/comergent-branding` | Primary Comergent fork branch |
| `feat/*` | Feature branches cut from the fork base |

When pulling patches from upstream LibreChat, merge into `feat/comergent-branding` and resolve conflicts file-by-file using the conflict-risk table above as a guide.
