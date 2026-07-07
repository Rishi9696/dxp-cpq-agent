import { getConversation, getQuote, createOrder, markCheckoutDone } from "@/lib/supabase";
import { requireSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Records one order (one row per checkout) from the conversation's quote items,
// then locks the quote (checkout_done) so it can't be checked out again.
export async function POST(req: Request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set." },
      { status: 500 }
    );
  }

  const user = await requireSessionUser().catch(() => null);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  let conversationId: string;
  try {
    const body = await req.json();
    conversationId = String(body?.conversationId ?? "").trim();
    if (!conversationId) throw new Error("conversationId is required");
  } catch (e) {
    const m = e instanceof Error ? e.message : "bad body";
    return Response.json({ error: `Invalid request body: ${m}` }, { status: 400 });
  }

  try {
    const conversation = await getConversation(conversationId);
    if (!conversation || conversation.user_id !== user.id) {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    const quote = await getQuote(conversationId);
    if (quote.checkout_done) {
      return Response.json(
        { error: "This quote is already checked out. Start a new chat to build a new quote." },
        { status: 409 }
      );
    }
    if (quote.items.length === 0) {
      return Response.json({ error: "Quote is empty — nothing to check out." }, { status: 400 });
    }
    const total = quote.items.reduce((s, li) => s + li.unit_price * li.quantity, 0);
    const order = await createOrder(conversationId, user.id, quote.items, total);
    await markCheckoutDone(conversationId);
    return Response.json({
      order_number: order.order_number,
      total: order.total,
      items: order.items,
      created_at: order.created_at,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Checkout failed: ${m}` }, { status: 500 });
  }
}
