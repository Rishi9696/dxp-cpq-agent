# vercel-dxp-poc

A minimal proof-of-concept of a DXP "leader agent": you chat in plain language and the agent recommends products from a small catalog. Built with Next.js (App Router) on Vercel.

This version uses **Anthropic Managed Agents** — Anthropic hosts the agent loop and a per-session container. You define a persisted **Agent** (model, system prompt, the `search_products` tool) and an **Environment** once; each chat turn runs in a **Session** that streams events, and the app answers the `search_products` tool client-side from the local catalog.

> Note: this is the real Managed Agents product (`client.beta.agents` / `environments` / `sessions`), not just the Claude Messages API. It requires Managed Agents beta access on your Anthropic account.

## Architecture

- **Agent + Environment** ([scripts/setup-agent.mjs](scripts/setup-agent.mjs)) — created **once**; their IDs go in env vars. The agent declares a `search_products` **custom tool** (executed by us, not in the container).
- **Backend** ([app/api/chat/route.ts](app/api/chat/route.ts)) — one HTTP call per turn; creates/reuses a session.
- **Agent loop** ([lib/agent.ts](lib/agent.ts)) — opens the session event stream, sends the user message, and when Claude emits `agent.custom_tool_use` it runs the catalog search and replies with `user.custom_tool_result`, until the session goes idle. Model: `claude-opus-4-8`.
- **"DB"** ([lib/products.ts](lib/products.ts)) — ~10 everyday products + keyword search.
- **Frontend** ([app/page.tsx](app/page.tsx)) — a chat UI that holds the `sessionId` for multi-turn memory.

## Setup (one time)

```bash
npm install
cp .env.example .env.local        # set ANTHROPIC_API_KEY in .env.local
npm run setup                     # creates the Agent + Environment, prints their IDs
```

Add the printed `DXP_AGENT_ID` and `DXP_ENVIRONMENT_ID` to `.env.local`. You now have three vars set: `ANTHROPIC_API_KEY`, `DXP_AGENT_ID`, `DXP_ENVIRONMENT_ID`.

## Run locally

```bash
npm run dev
```

Open http://localhost:3000 and try:

- “I need something to commute to work without a car” → bicycle
- follow up “something to carry my laptop in” → backpack (reuses the session)

Or hit the API directly (`sessionId` is optional; pass the one returned to continue a conversation):

```bash
curl -s -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"something to write notes in"}'
```

## Deploy to Vercel

Push to GitHub, import the repo at https://vercel.com/new, and add **all three** env vars (`ANTHROPIC_API_KEY`, `DXP_AGENT_ID`, `DXP_ENVIRONMENT_ID`) under the project's Environment Variables, then redeploy. The same agent/environment are reused across local and production.
