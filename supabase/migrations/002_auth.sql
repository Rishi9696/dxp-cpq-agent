-- Adds real Supabase Auth (email/password) ownership on top of the POC
-- schema in supabase/schema.sql. Run this in the Supabase SQL editor
-- AFTER schema.sql has already been applied once.
--
-- Signup is closed — users are created out-of-band with
-- `npm run create-user -- <email> <password>` (scripts/create-user.mjs),
-- which uses the service_role key. There is no public /signup route.

-- 1. Wipe the old anonymous (client_id-only) data. These rows have no real
--    owner and were only ever keyed off a random localStorage id, so they
--    can't be attributed to a user post-auth.
truncate table orders;
delete from conversations; -- cascades to messages and quotes

-- 2. Add real ownership columns.
alter table conversations
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table conversations
  alter column client_id drop not null;

alter table orders
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_conversations_user on conversations (user_id, updated_at desc);
create index if not exists idx_orders_user on orders (user_id, created_at desc);

-- 3. Going forward, conversations/orders are owned by user_id (set by the
--    server from the authenticated session — never trust a client-supplied
--    id). client_id is kept around, nullable, purely as a legacy column.
--
-- Access is still server-side only via the service_role key (RLS stays
-- disabled), but every API route now derives the caller's identity from
-- the Supabase session cookie via middleware, not from request input.
