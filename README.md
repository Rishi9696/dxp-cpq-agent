# vercel-dxp-poc

A minimal proof-of-concept of a DXP "leader agent": you chat in plain language and a **Claude-managed agent** recommends products from a small catalog. Built with Next.js (App Router) and deployable to Vercel with zero config.

It's a deliberately stripped-down version of the production DXP agent — keeping only the core pattern: **Claude reads intent → calls a `search_products` tool → we query the catalog → Claude recommends with reasoning.**

## How it works

- **Frontend** ([app/page.tsx](app/page.tsx)) — a chat interface. Sends the conversation to the backend each turn.
- **Backend** ([app/api/chat/route.ts](app/api/chat/route.ts)) — a serverless route that runs the agent. The API key stays server-side.
- **Agent** ([lib/agent.ts](lib/agent.ts)) — uses the Anthropic SDK **Tool Runner** (`betaZodTool` + `client.beta.messages.toolRunner`). Claude decides when to call `search_products`; the SDK executes the tool, feeds results back, and loops until Claude produces a final recommendation. Model: `claude-opus-4-8`.
- **"DB"** ([lib/products.ts](lib/products.ts)) — ~10 everyday products + a simple keyword search. Swap for a real database later.

## Run locally

```bash
npm install
cp .env.example .env.local   # then put your real key in .env.local
npm run dev
```

Set `ANTHROPIC_API_KEY` in `.env.local` (the Anthropic SDK reads it automatically). Open http://localhost:3000 and try:

- “I need something to commute to work without a car” → bicycle
- “something to carry my laptop in” → backpack

Or hit the API directly:

```bash
curl -s -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"something to write notes in"}]}'
```

## Deploy to Vercel

Push to GitHub, import the repo at https://vercel.com/new, and add `ANTHROPIC_API_KEY` under the project's Environment Variables. Next.js is auto-detected and deploys with zero config.
