-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Simulated CPQ backend: conversations + messages (memory), quotes (cart), orders.
-- This matches lib/supabase.ts exactly.

create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,                  -- Supabase Auth user id
  session_id  text,                           -- Anthropic Managed Agents session id (null until first chat turn)
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_conversations_user on conversations (user_id, updated_at desc);

create table if not exists messages (
  id              bigserial primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null default '',
  products        jsonb not null default '[]'::jsonb,   -- cards shown with the message
  created_at      timestamptz not null default now()
);
create index if not exists idx_messages_conversation on messages (conversation_id, created_at);

-- One quote (cart) per conversation. All line items live in the `items` JSONB
-- array: [{line_id, product_id, product_name, quantity, unit_price, configured,
-- options, attributes}]. `checkout_done` locks the quote after finalization.
create table if not exists quotes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations(id) on delete cascade,
  items           jsonb not null default '[]'::jsonb,
  checkout_done   boolean not null default false,
  created_at      timestamptz not null default now()
);

-- One row per finalized quote. The full product list is snapshotted into
-- the `items` JSONB column, so an order is self-contained even if the quote
-- later changes.
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text not null,
  conversation_id uuid references conversations(id) on delete set null,
  user_id         text,
  items           jsonb not null default '[]'::jsonb,
  total           numeric not null default 0,
  status          text not null default 'paid',
  created_at      timestamptz not null default now()
);
create index if not exists idx_orders_user on orders (user_id, created_at desc);

-- Access is server-side only via the service_role key, so RLS is left disabled
-- for this POC. Do NOT expose the service_role key to the browser.
