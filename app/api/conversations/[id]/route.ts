import { getConversation, getMessages, getQuote, getLatestOrder } from "@/lib/supabase";
import { requireSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Load one conversation's messages, quote, checkout state, and last order —
// only if it belongs to the signed-in user.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await requireSessionUser().catch(() => null);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const conversation = await getConversation(id);
    if (!conversation || conversation.user_id !== user.id) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const messages = await getMessages(id);
    const quote = await getQuote(id);
    const order = await getLatestOrder(id);
    return Response.json({
      conversation,
      messages,
      quote: quote.items,
      checkoutDone: quote.checkout_done,
      order,
    });
  } catch (e) {
    console.error("Failed to load conversation:", e);
    return Response.json({ error: "Failed to load conversation." }, { status: 500 });
  }
}
