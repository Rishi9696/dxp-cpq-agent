-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Simulated CPQ backend: conversations + messages (memory) and quotes + line items.

create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null,                 -- browser-local id (no auth in this POC)
  session_id  text,                          -- Anthropic Managed Agents session id
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_conversations_client on conversations (client_id, updated_at desc);

create table if not exists messages (
  id              bigserial primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null default '',
  products        jsonb not null default '[]'::jsonb,   -- cards shown with the message
  created_at      timestamptz not null default now()
);
create index if not exists idx_messages_conversation on messages (conversation_id, created_at);

create table if not exists quotes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create table if not exists quote_line_items (
  id           bigserial primary key,
  quote_id     uuid not null references quotes(id) on delete cascade,
  product_id   text not null,
  product_name text not null,
  quantity     int not null default 1,
  unit_price   numeric not null default 0,
  configured   boolean not null default false,
  options      jsonb not null default '[]'::jsonb,      -- [{id,name,price_delta}]
  attributes   jsonb not null default '{}'::jsonb,      -- {name: value}
  created_at   timestamptz not null default now()
);
create index if not exists idx_qli_quote on quote_line_items (quote_id, created_at);

-- One row per completed checkout. The full product list is snapshotted into
-- the `items` JSONB column, so an order is self-contained even if the quote
-- later changes.
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text not null,
  conversation_id uuid references conversations(id) on delete set null,
  client_id       text,
  items           jsonb not null default '[]'::jsonb,   -- [{product_name, quantity, unit_price, options, attributes}]
  total           numeric not null default 0,
  status          text not null default 'paid',
  created_at      timestamptz not null default now()
);
create index if not exists idx_orders_client on orders (client_id, created_at desc);

-- Access is server-side only via the service_role key, so RLS is left disabled
-- for this POC. Do NOT expose the service_role key to the browser.
