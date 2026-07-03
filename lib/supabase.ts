import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client (service_role key). NEVER import this into client
// components — the service key must not reach the browser.
let _client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. See supabase/schema.sql and the README."
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export type Conversation = {
  id: string;
  client_id: string;
  session_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: number;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  products: unknown[];
  created_at: string;
};

// A product line inside a quote. All lines for a conversation live in the
// quotes.items JSONB array (no separate quote_line_items table).
export type QuoteItem = {
  line_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  configured: boolean;
  options: { id: string; name: string; price_delta: number }[];
  attributes: Record<string, unknown>;
};

export type Quote = {
  id: string;
  conversation_id: string;
  items: QuoteItem[];
  checkout_done: boolean;
};

export async function createConversation(
  clientId: string,
  sessionId: string,
  title: string
): Promise<Conversation> {
  const { data, error } = await supabase()
    .from("conversations")
    .insert({ client_id: clientId, session_id: sessionId, title: title.slice(0, 80) })
    .select()
    .single();
  if (error) throw new Error(`createConversation: ${error.message}`);
  // Every conversation gets exactly one quote.
  const { error: qErr } = await supabase().from("quotes").insert({ conversation_id: data.id });
  if (qErr) throw new Error(`createQuote: ${qErr.message}`);
  return data as Conversation;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabase()
    .from("conversations")
    .select()
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getConversation: ${error.message}`);
  return (data as Conversation) ?? null;
}

export async function listConversations(clientId: string): Promise<Conversation[]> {
  const { data, error } = await supabase()
    .from("conversations")
    .select()
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`listConversations: ${error.message}`);
  return (data as Conversation[]) ?? [];
}

export async function touchConversation(id: string): Promise<void> {
  await supabase().from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
}

export async function saveMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  products: unknown[] = []
): Promise<void> {
  const { error } = await supabase()
    .from("messages")
    .insert({ conversation_id: conversationId, role, content, products });
  if (error) throw new Error(`saveMessage: ${error.message}`);
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase()
    .from("messages")
    .select()
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getMessages: ${error.message}`);
  return (data as Message[]) ?? [];
}

export async function getQuote(conversationId: string): Promise<Quote> {
  const { data, error } = await supabase()
    .from("quotes")
    .select("id, conversation_id, items, checkout_done")
    .eq("conversation_id", conversationId)
    .single();
  if (error) throw new Error(`getQuote: ${error.message}`);
  const q = data as { id: string; conversation_id: string; items: QuoteItem[] | null; checkout_done: boolean };
  return { id: q.id, conversation_id: q.conversation_id, items: q.items ?? [], checkout_done: q.checkout_done };
}

/** Overwrite the quote's item list (the whole cart lives in this one column). */
export async function saveQuoteItems(conversationId: string, items: QuoteItem[]): Promise<void> {
  const { error } = await supabase()
    .from("quotes")
    .update({ items })
    .eq("conversation_id", conversationId);
  if (error) throw new Error(`saveQuoteItems: ${error.message}`);
}

/** Lock the quote after checkout so it can't be modified or re-checked-out. */
export async function markCheckoutDone(conversationId: string): Promise<void> {
  const { error } = await supabase()
    .from("quotes")
    .update({ checkout_done: true })
    .eq("conversation_id", conversationId);
  if (error) throw new Error(`markCheckoutDone: ${error.message}`);
}

export type Order = {
  id: string;
  order_number: string;
  conversation_id: string | null;
  client_id: string | null;
  items: unknown[];
  total: number;
  status: string;
  created_at: string;
};

/** Record one completed checkout — the product list is snapshotted into `items`. */
export async function createOrder(
  conversationId: string,
  clientId: string,
  items: unknown[],
  total: number
): Promise<Order> {
  const order_number = "ORD-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const { data, error } = await supabase()
    .from("orders")
    .insert({ order_number, conversation_id: conversationId, client_id: clientId, items, total })
    .select()
    .single();
  if (error) throw new Error(`createOrder: ${error.message}`);
  return data as Order;
}

/** The most recent order for a conversation — used to show "last checkout". */
export async function getLatestOrder(conversationId: string): Promise<Order | null> {
  const { data, error } = await supabase()
    .from("orders")
    .select()
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestOrder: ${error.message}`);
  return (data as Order) ?? null;
}
