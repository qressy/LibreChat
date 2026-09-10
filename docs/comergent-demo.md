# Comergent Demo Setup

This branch turns LibreChat into a narrow demo client for the local Comergent MCP server.

## What this branch changes

- `librechat.yaml` hides most of the general-purpose UI
- `librechat.yaml` registers the local Comergent MCP server at `http://host.docker.internal:8787/mcp`
- `docker-compose.override.yaml` mounts that config into the default Docker stack

## Required local `.env`

Start from the upstream example:

```bash
cp .env.example .env
```

Then set these values in `.env`:

```dotenv
ENDPOINTS=openAI
OPENAI_API_KEY=your_key_here
OPENAI_MODELS=gpt-4.1-mini

ALLOW_REGISTRATION=true
ALLOW_EMAIL_LOGIN=true

ADMIN_PANEL_SESSION_SECRET=generate_a_real_secret
```

Generate the admin-panel secret with:

```bash
openssl rand -hex 32
```

Keep the rest of `.env.example` as-is unless you already have local overrides.

## Run order

1. Start the Comergent MCP server in `/Users/abu/Code/comergent/shopify-catalog-mcp`.

```bash
bun run dev
```

2. Start LibreChat in this repo.

```bash
docker compose up -d
```

3. Open LibreChat at [http://localhost:3080](http://localhost:3080).

4. Create one demo user from the login screen.

5. After the first demo user exists, lock registration back down for the shared demo flow:

```dotenv
ALLOW_REGISTRATION=false
```

Then restart the stack:

```bash
docker compose up -d
```

## Expected local topology

- Browser -> `http://localhost:3080`
- LibreChat API container -> `http://host.docker.internal:8787/mcp`
- Comergent MCP server -> local host process in the sibling repo

## First checks

- `curl http://localhost:8787/` returns the Comergent landing page
- LibreChat loads without YAML config errors
- A new chat can call the Comergent MCP tools
