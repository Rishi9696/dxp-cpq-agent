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

export type LineItem = {
  id: number;
  quote_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  configured: boolean;
  options: unknown[];
  attributes: Record<string, unknown>;
  created_at: string;
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

export async function getQuoteId(conversationId: string): Promise<string> {
  const { data, error } = await supabase()
    .from("quotes")
    .select("id")
    .eq("conversation_id", conversationId)
    .single();
  if (error) throw new Error(`getQuoteId: ${error.message}`);
  return (data as { id: string }).id;
}

export async function getLineItems(quoteId: string): Promise<LineItem[]> {
  const { data, error } = await supabase()
    .from("quote_line_items")
    .select()
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getLineItems: ${error.message}`);
  return (data as LineItem[]) ?? [];
}

export async function addLineItem(
  quoteId: string,
  item: {
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    configured: boolean;
    options: unknown[];
    attributes: Record<string, unknown>;
  }
): Promise<LineItem> {
  const { data, error } = await supabase()
    .from("quote_line_items")
    .insert({ quote_id: quoteId, ...item })
    .select()
    .single();
  if (error) throw new Error(`addLineItem: ${error.message}`);
  return data as LineItem;
}

/** Remove line item(s) from a quote by row id, or by product_id if id is absent. */
export async function removeLineItem(
  quoteId: string,
  opts: { lineItemId?: number; productId?: string }
): Promise<number> {
  let q = supabase().from("quote_line_items").delete().eq("quote_id", quoteId);
  if (opts.lineItemId != null) q = q.eq("id", opts.lineItemId);
  else if (opts.productId) q = q.eq("product_id", opts.productId);
  else return 0;
  const { data, error } = await q.select();
  if (error) throw new Error(`removeLineItem: ${error.message}`);
  return (data as unknown[])?.length ?? 0;
}
