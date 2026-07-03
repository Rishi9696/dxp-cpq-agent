import { getConversation, getMessages, getQuoteId, getLineItems } from "@/lib/supabase";

export const runtime = "nodejs";

// Load one conversation's messages + quote (used when reopening from the sidebar).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const conversation = await getConversation(id);
    if (!conversation) return Response.json({ error: "not found" }, { status: 404 });
    const messages = await getMessages(id);
    const quoteId = await getQuoteId(id);
    const quote = await getLineItems(quoteId);
    return Response.json({ conversation, messages, quote });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: m }, { status: 500 });
  }
}
