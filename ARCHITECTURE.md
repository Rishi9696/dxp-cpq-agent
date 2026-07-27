# DXP CPQ Agent — Architecture & Design Document

**Project:** `dxp-cpq-agent` v0.1.0
**Last updated:** 2026-07-27
**Status:** Proof of Concept

---

## 1. Overview

A **CPQ-style (Configure-Price-Quote) shopping agent**. Users chat with a Claude **Managed Agent** that searches a product catalog, configures products, and builds a persisted quote/cart, ending in a dummy checkout that records an order.

This project is a deliberately simplified stand-in for the production agent **`dxp_leader_agent_ecs`**. The real Salesforce/AWS backend is simulated in TypeScript + Supabase — same tool shapes and conversational flow, no real Salesforce.

### Mapping to production (`dxp_leader_agent_ecs`)

| Production (genesis) | This project |
|---|---|
| `search_product` (getCatalogProducts) | `search_products` tool → `lib/catalog.ts` |
| `configure_product` (getAvailableConfiguration) | `configure_product` tool → simulated schema |
| `add_non_configurable` / `maintainQuoteConfiguration` | `add_to_quote` tool → Supabase |
| DynamoDB conversation history | Supabase `conversations` + `messages` |
| Salesforce Quote Line Items | Supabase `quotes.items` (JSONB) |
| Leader prompt (execution vs discovery) | Ported into agent system prompt |

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | ^15.1.0 |
| UI | React / react-dom | ^19.0.0 |
| Language | TypeScript (strict) | ^5.7.0 |
| Agent | `@anthropic-ai/sdk` — beta Managed Agents API (`client.beta.agents/environments/sessions`) | ^0.107.0 |
| Database | Supabase (Postgres) via `@supabase/supabase-js` | ^2.110.0 |
| Auth/SSR | `@supabase/ssr` (cookie-based sessions) | ^0.12.0 |
| Agent model | `claude-opus-4-8` (titles: `claude-haiku-4-5`) | — |
| Deployment | Vercel (zero-config Next.js) | — |

All API routes run on `runtime = "nodejs"`. No ORM, no UI component library, no markdown library — zero UI deps beyond React; icons are inline SVGs.

---

## 3. High-Level Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                         Browser (React 19)                    │
│  ChatClient.tsx — sidebar / chat (SSE) / product panel        │
│  Pages: / /login /mfa /cart /quote                            │
└───────────────┬───────────────────────────────────────────────┘
                │ HTTPS
┌───────────────▼───────────────────────────────────────────────┐
│                    Next.js on Vercel                          │
│                                                               │
│  middleware.ts ── Supabase session refresh + auth/MFA gate    │
│       │                                                       │
│  API routes (app/api/*)                                       │
│   chat · conversations · products · quote · checkout · auth   │
│       │                                                       │
│  lib/agent.ts ──── Managed Agent session loop + tool exec     │
│  lib/quote.ts ──── shared cart mutation core                  │
│  lib/catalog.ts ── simulated catalog (10 products)            │
│  lib/supabase.ts ─ all DB access (service-role)               │
└───────┬───────────────────────────────┬───────────────────────┘
        │                               │
┌───────▼─────────────┐        ┌────────▼────────────────────┐
│ Anthropic Managed   │        │ Supabase (Postgres + Auth)  │
│ Agents (sessions =  │        │ conversations · messages ·  │
│ agent memory, tools │        │ quotes · orders; TOTP MFA   │
│ executed app-side)  │        │ (RLS disabled by design)    │
└─────────────────────┘        └─────────────────────────────┘
```

---

## 4. Repository Structure

```
dxp-cpq-agent/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout, metadata
│   ├── globals.css               # Single stylesheet (CSS variables)
│   ├── page.tsx                  # Home (server) → ChatClient
│   ├── ChatClient.tsx            # Main chat UI (~780 lines) + ProductCard
│   ├── login/page.tsx            # Login form
│   ├── mfa/page.tsx              # TOTP enroll/verify
│   ├── cart/page.tsx             # Cart: qty edit, remove, finalize
│   ├── quote/page.tsx            # Finalized/locked quote view
│   └── api/
│       ├── chat/route.ts                       # SSE agent turn
│       ├── conversations/route.ts              # List
│       ├── conversations/[id]/route.ts         # Load one
│       ├── products/route.ts                   # Catalog
│       ├── quote/route.ts                      # POST/PATCH/DELETE cart
│       ├── checkout/route.ts                   # Create order, lock quote
│       └── auth/{login,logout,mfa/{enroll,factors,verify}}/route.ts
├── lib/
│   ├── agent.ts                  # Managed-Agent orchestration
│   ├── catalog.ts                # Product catalog + search/config
│   ├── quote.ts                  # Cart mutation core
│   ├── quote.test.ts             # Unit tests for quote.ts (vitest)
│   ├── supabase.ts               # Service-role client + all DB functions
│   └── supabase/
│       ├── server.ts             # SSR client + auth helpers
│       └── middleware.ts         # Session refresh + auth/MFA gate
├── middleware.ts                 # Entry → updateSession
├── scripts/
│   ├── setup-agent.mjs           # Creates/updates agent + environment
│   └── create-user.mjs           # Provisions allow-listed users
├── supabase/
│   └── schema.sql                # 4 tables — single source of truth, no separate migrations
├── .github/workflows/ci.yml      # Test + typecheck + build on push/PR
├── package.json · tsconfig.json · next.config.mjs (empty) · .env.example
```

Unit tests (`vitest`) cover `lib/quote.ts`; CI runs them plus a type check and build on every push/PR. No monorepo, no feature flags, no e2e tests.

The legacy `/checkout` and `/payment` pages (superseded by `/cart`'s "Finalize" flow, which calls `/api/checkout` directly) have been removed as dead code.

---

## 5. Pages & API Surface

**Pages:** `/` (chat), `/login`, `/mfa`, `/cart`, `/quote`. Cart/quote take conversation id via `?c=<id>`.

### API endpoints

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/chat` | Main agent turn. Streams SSE events: `meta`, `status`, `reset`, `text`, `done`, `error`. Creates conversation + agent session if needed, persists messages, auto-titles first turn. `maxDuration = 300`. |
| GET | `/api/conversations` | User's conversations (sidebar), limit 50 |
| GET | `/api/conversations/[id]` | Messages, quote items, checkout state, latest order (ownership-checked) |
| GET | `/api/products` | Full catalog for product panel |
| POST | `/api/quote` | UI add-to-cart (creates sessionless conversation if none) |
| PATCH | `/api/quote` | Set line quantity (0 removes) |
| DELETE | `/api/quote` | Remove line by `lineId` |
| POST | `/api/checkout` | Create order from quote, lock quote (`checkout_done`); 409 if already done |
| POST | `/api/auth/login` | Password sign-in; username → `<name>@dxp.local`; returns `mfa: "enroll" \| "verify"` |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/mfa/factors` | MFA state (enrolled, factorId, AAL) |
| POST | `/api/auth/mfa/enroll` | Start TOTP enrollment → QR + secret |
| POST | `/api/auth/mfa/verify` | Verify TOTP; steps session to AAL2 |

---

## 6. Data Model

Supabase Postgres, four tables (`supabase/schema.sql`). **RLS disabled** — all access is server-side via service-role key; ownership enforced in code by `user_id` checks.

### Tables

**`conversations`**

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | text | Supabase Auth user |
| session_id | text nullable | Anthropic session; null until first chat turn |
| title | text | Auto-generated by Haiku |
| created_at / updated_at | timestamptz | Index on `(user_id, updated_at desc)` |

**`messages`**

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| conversation_id | uuid FK cascade | |
| role | text | check: `user` / `assistant` |
| content | text | |
| products | jsonb | Product cards attached to reply |
| created_at | timestamptz | |

**`quotes`** — one per conversation

| Column | Type | Notes |
|---|---|---|
| conversation_id | uuid unique FK | |
| items | jsonb array | **Entire cart lives in this one column** |
| checkout_done | bool | Lock flag |

**`orders`**

| Column | Type | Notes |
|---|---|---|
| id, order_number | | `ORD-<6 base36 chars>` |
| conversation_id, user_id | | |
| items | jsonb | Snapshot of quote at checkout (self-contained) |
| total | numeric | |
| status | text | default `'paid'` |

### QuoteItem shape (`quotes.items[]`)

```json
{
  "line_id": "a1b2c3d4",
  "product_id": "…",
  "product_name": "…",
  "quantity": 1,
  "unit_price": 1999,
  "configured": true,
  "options": ["mem-32gb", "ssd-1tb"],
  "attributes": { "color": "space-gray" }
}
```

`line_id` = first 8 chars of a UUID. Line merging uses order-independent signatures (`optSig` = sorted option ids, `attrSig` = sorted attribute keys) so `{size,color}` and `{color,size}` merge into one line.

### Catalog (`lib/catalog.ts`)

Hardcoded 10-product array: MacBook Pro 14", City Commuter Bicycle, Running Shoes, Graphite Pencil, A5 Notebook, Bestselling Novel, Laptop Backpack, Water Bottle, Wireless Headphones, LED Desk Lamp. Configurable products carry `option_groups` (memory/storage/accessories with `min`/`max`/`price_delta`) and `attributes` (color/size/frame_size).

---

## 7. Agent Design

### Definition (`scripts/setup-agent.mjs`)

- Model: `claude-opus-4-8`; environment `{ type: "cloud", networking: { type: "unrestricted" } }`.
- One Anthropic session per conversation = the agent's working memory.
- `npm run setup` creates/updates the agent + environment and prints `DXP_AGENT_ID` / `DXP_ENVIRONMENT_ID`.

### Custom tools (executed app-side in `lib/agent.ts`)

| Tool | Purpose |
|---|---|
| `search_products` | Search the simulated catalog |
| `configure_product` | Return option groups/attributes for a product |
| `add_to_quote` | Add/merge a line into `quotes.items` |
| `remove_from_quote` | Remove by line id (falls back to `product_id`) |

### System prompt: execution vs discovery intent

- **Execution** ("add", "remove", "I need") → mutate the quote without asking confirmation.
- **Discovery** ("recommend", "show me", "compare") → name products only, no mutation.

### Turn loop (`lib/agent.ts` → `runAgentTurnStreaming`)

1. Fetch current quote; inject as bracketed context (or a "CHECKED OUT and locked" notice).
2. Open event stream, send user message.
3. Loop: `agent.message` → stream text to UI; `agent.custom_tool_use` → run tool via `runTool`, reply with `user.custom_tool_result`; handle `session.error` / `status_idle` / `status_terminated`.

**Guardrails:** every tool call is always answered (an unanswered call leaves the session stuck in `requires_action`); max **12 tool uses per turn**; streamed preamble text is cleared when a tool call begins (`reset` SSE event).

**Product cards:** surfaced by substring-matching the reply text against catalog names (`matchProducts`) — a heuristic, not structured tool output.

**Auto-titling:** `generateTitle()` calls `claude-haiku-4-5` after the first exchange; failure is non-fatal.

---

## 8. Request Flow (chat turn)

```
Browser ── POST /api/chat ──────────────────────────────────────►
   │
   ▼
middleware.ts: refresh Supabase cookie → require auth + AAL2 (MFA)
   │
   ▼
/api/chat: env checks → resolve/create conversation
           → create Anthropic session if session_id is null
           → open SSE stream → save user message
   │
   ▼
runAgentTurnStreaming:
   inject quote context → agent loop
   ├─ text deltas ──────────► SSE `text`
   ├─ tool call begins ─────► SSE `reset` + `status` ("Searching…")
   └─ tools write to quotes.items via lib/quote.ts
   │
   ▼
save assistant message + matched products → touchConversation
→ auto-title if new
   │
   ▼
SSE `done`: { reply, products, quote items, checkout state, title }
   │
   ▼
Client renders message, updates cart badge + product panel
```

### Two write paths, one core

Both agent tools and UI cart operations funnel through `lib/quote.ts` (`addToQuote`, `removeFromQuote`, `setLineQuantity`), so items behave identically regardless of origin.

### Quote locking

`checkout_done` enforced in three places: `lib/quote.ts` (mutations blocked), `lib/agent.ts` (agent told quote is locked), `/api/checkout` (409 if already done).

---

## 9. Auth & Security

- **Closed signup** — users provisioned only via `npm run create-user -- <email> <password>` (service-role admin API). Login accepts a bare username → `<username>@dxp.local`.
- **Mandatory TOTP MFA** (Google Authenticator). Session must reach AAL2.
- **Middleware gate** (`lib/supabase/middleware.ts`), runs on every request (matcher excludes `_next/static`, `_next/image`, `favicon.ico`):
  - Public: `/login`, `/api/auth/login`, static assets.
  - MFA-transit (AAL1 allowed): `/mfa`, `/api/auth/mfa/*`, `/api/auth/logout`.
  - Unauthenticated → 401 (API) or redirect to `/login?next=` (pages).
  - Authenticated but not AAL2 → redirect to `/mfa`.
  - **Fails closed** (500) if Supabase env vars missing; re-attaches rotated refresh-token cookies onto redirects.
- Helpers in `lib/supabase/server.ts`: `createSupabaseServerClient`, `getSessionUser`, `requireSessionUser` (throws `AuthRequiredError`).
- No RLS (intentional — service-role only), no rate limiting, no error monitoring.

### Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Managed Agents + Haiku titling |
| `DXP_AGENT_ID` | From `npm run setup` |
| `DXP_ENVIRONMENT_ID` | From `npm run setup` |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server data access |
| `SUPABASE_ANON_KEY` | Auth/session cookies |
| `STAMP` (optional) | Env-name suffix in `setup-agent.mjs` |

---

## 10. UI Design Notes

- `ChatClient.tsx` — three-pane layout: conversation sidebar / chat / product panel; nested `ProductCard` (expandable configurator).
- Custom lightweight markdown renderer (`MessageContent`/`renderInline`): bold, code, bullet/numbered lists. No markdown library.
- **Concurrency:** cart adds serialized via a promise chain (`addChainRef`); live conversation id tracked (`activeIdRef`) so rapid double-adds before conversation creation don't split into two carts.
- **Lazy session creation:** UI-initiated carts create a conversation with `session_id = null`; the Anthropic session is created on the first chat message.
- Two styling conventions coexist: newer pages (`ChatClient`, `cart`, `quote`) use `globals.css` CSS-variable classes; older pages (`checkout`, `payment`) use hardcoded inline dark-theme styles.

---

## 11. Build, Deploy & Ops

| Script | Command |
|---|---|
| `dev` | `next dev` |
| `build` | `next build` |
| `start` | `next start` |
| `setup` | `node --env-file=.env.local scripts/setup-agent.mjs` |
| `create-user` | `node --env-file=.env.local scripts/create-user.mjs` |

- Deploy: manual Vercel import + 5 env vars (README). No `vercel.json`, Dockerfile, CI/CD, or lint/test scripts. `package-lock.json` committed.
- `/api/chat` sets `maxDuration = 300` (5 min) for long agent loops.
- Single environment — no staging/prod split, no i18n.

---

## 12. Known Gaps & Inconsistencies

**Fixed:**

1. ~~Stale README~~ — updated to reflect username login, per-user isolation, SSE streaming, and mandatory TOTP MFA.
2. ~~Schema drift~~ — README no longer references a `quote_line_items` table; it correctly describes `quotes.items` JSONB.
3. ~~Broken fresh-install migration~~ — `supabase/migrations/002_auth.sql` (which assumed a pre-refactor schema with `client_id`) has been deleted. `supabase/schema.sql` is now the single source of truth and already includes `user_id`.
4. ~~Tool param mismatch~~ — `scripts/setup-agent.mjs`'s tool schema and system prompt now use `line_id` (string), matching what `lib/agent.ts` actually injects and reads. **Note:** if you've already run `npm run setup` against the old schema, re-run it so the live agent definition picks up the corrected tool.
6. ~~Legacy `/checkout` + `/payment` flow~~ — removed; `/api/checkout` remains, called directly by `/cart`'s "Finalize" button.
7. ~~No tests~~ — `lib/quote.ts` (the shared cart-mutation core used by both the agent and the UI) now has unit tests under `lib/quote.test.ts`, run via `npm test` and in CI (`.github/workflows/ci.yml`), which also type-checks and builds on every push/PR.

**Still open:**

- **Heuristic product cards** — `matchProducts` substring-matches reply text against catalog names; can miss or mis-attribute products. Would need the agent to return structured product references instead.
- **No monitoring or rate limiting.**
- **No RLS** — intentional; all access is server-side via the service-role key with ownership enforced in code.
- **No e2e/integration tests** — only `lib/quote.ts`'s pure mutation logic is unit-tested; API routes, auth flow, and the agent loop are untested.

---

## 13. Key Files Reference

| File | Role |
|---|---|
| `lib/agent.ts` | Agent loop, tool execution, streaming |
| `lib/quote.ts` | Shared cart mutation core |
| `lib/quote.test.ts` | Unit tests for `lib/quote.ts` |
| `lib/supabase.ts` | All DB access (13 functions) |
| `lib/supabase/middleware.ts` | Auth/MFA gate |
| `scripts/setup-agent.mjs` | Agent definition, system prompt, tool schemas |
| `supabase/schema.sql` | Data model |
| `app/api/chat/route.ts` | SSE orchestration |
| `app/ChatClient.tsx` | Main UI |
