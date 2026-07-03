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

-- Access is server-side only via the service_role key, so RLS is left disabled
-- for this POC. Do NOT expose the service_role key to the browser.
