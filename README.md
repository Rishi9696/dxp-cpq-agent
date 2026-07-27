# dxp-cpq-agent

A minimal CPQ-style shopping agent: you chat, and a Claude **Managed Agent** searches a catalog, configures products, and builds a **quote** — with all conversation memory and the quote persisted in **Supabase** and shown in the UI.

It's a deliberately simplified stand-in for the production `dxp_leader_agent_ecs` agent. The Salesforce/AWS backend is **simulated in TypeScript + Supabase** (same tool shapes and flow — no real Salesforce).

## How it maps to the genesis agent
| genesis (`dxp_leader_agent_ecs`) | this project |
|---|---|
| `search_product` (getCatalogProducts) | `search_products` tool → `lib/catalog.ts` |
| `configure_product` (getAvailableConfiguration) | `configure_product` tool → simulated option/attribute schema |
| `add_non_configurable` / `maintainQuoteConfiguration` (addLines) | `add_to_quote` tool → Supabase `quotes.items` (JSONB) |
| DynamoDB conversation history / summaries | Supabase `conversations` + `messages` |
| Salesforce Quote Line Items | Supabase `quotes.items` (JSONB) |
| leader prompt (execution-vs-discovery intent) | ported into the agent system prompt |

## Architecture
- **Agent memory:** the Managed Agents *session* (hosted by Anthropic, one per conversation) is the LLM's working memory.
- **Durable / UI memory:** Supabase stores every message, the conversation list, and the quote — this is what the UI renders and what survives reloads.
- **Tools** run server-side in `lib/agent.ts` when the agent emits `agent.custom_tool_use`; `add_to_quote` writes to Supabase scoped to the conversation's quote.

## Setup

### 1. Supabase (one time)
1. Create a project at https://supabase.com (free tier).
2. **SQL Editor → New query →** paste all of [`supabase/schema.sql`](supabase/schema.sql) and **Run**. This creates `conversations`, `messages`, `quotes` (line items live in `quotes.items` JSONB), and `orders`.
3. **Project Settings → API:** copy the **Project URL**, the **`service_role`** key (secret — server-side only), and the **`anon`** key.

### 2. Env + agent
```bash
npm install
cp .env.example .env.local          # then fill in the values below
npm run setup                       # creates the Managed Agent + Environment, prints their IDs
npm run create-user -- <email> <password>   # provision a login (signup is closed)
```
Set in `.env.local`:
- `ANTHROPIC_API_KEY` — your Anthropic key
- `DXP_AGENT_ID`, `DXP_ENVIRONMENT_ID` — printed by `npm run setup`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — from step 1

### 3. Run
```bash
npm run dev
```
Open http://localhost:3000 and try:
- **Discovery:** “what laptops do you have for video editing?” → product cards, nothing added.
- **Configure + add:** “add a MacBook Pro with 32GB RAM” → the agent searches → configures → adds; the **Quote** panel updates.
- **Non-configurable:** “also add a notebook” → added directly.
- Reload the page → the conversation, messages, and quote persist; the left sidebar lists past chats. **+ New chat** starts a fresh one.

## Deploy to Vercel
Push to GitHub, import the repo, and set all six env vars in **Settings → Environment Variables** (`ANTHROPIC_API_KEY`, `DXP_AGENT_ID`, `DXP_ENVIRONMENT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`), then redeploy.

## Auth
Signup is closed — provision users with `npm run create-user -- <email> <password>`. Login accepts a bare username (mapped to `<username>@dxp.local`) and requires TOTP MFA (Google Authenticator) on first login.

## Testing
```bash
npm test        # runs the lib/quote.ts unit tests via vitest
```

## Out of scope (kept simple)
real Salesforce/AWS calls, config-rule validation, rolling-summary generation, RLS (service-role-only access by design), rate limiting, error monitoring.
