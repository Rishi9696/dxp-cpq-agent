import { getProduct } from "@/lib/catalog";
import { addToQuote, removeFromQuote, setLineQuantity } from "@/lib/quote";
import { createConversation, getConversation } from "@/lib/supabase";
import { requireSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// UI-driven cart operations. The agent's add_to_quote / remove_from_quote
// tools share the same logic (lib/quote.ts) so both stay in sync.

async function resolveConversation(conversationId: string, userId: string) {
  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.user_id !== userId) return null;
  return conversation;
}

/** Add a product to the cart. Creates a conversation (without an agent session yet) if needed. */
export async function POST(req: Request) {
  const user = await requireSessionUser().catch(() => null);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const productId = String(body.productId ?? "").trim();
  const product = getProduct(productId);
  if (!product) return Response.json({ error: `Unknown product: ${productId}` }, { status: 400 });

  const quantity = Math.max(1, Number(body.quantity ?? 1) || 1);
  const optionIds = Array.isArray(body.optionIds) ? (body.optionIds as unknown[]).map(String) : [];
  const attributes =
    body.attributes && typeof body.attributes === "object"
      ? (body.attributes as Record<string, unknown>)
      : {};

  try {
    let conversationId =
      typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null;

    if (conversationId) {
      const conv = await resolveConversation(conversationId, user.id);
      if (!conv) return Response.json({ error: "Not found" }, { status: 404 });
    } else {
      // No chat yet — start a conversation for this cart. The agent session is
      // created lazily by /api/chat on the first message.
      const conv = await createConversation(user.id, null, `Cart — ${product.name}`);
      conversationId = conv.id;
    }

    const result = await addToQuote(conversationId, productId, quantity, optionIds, attributes);
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ conversationId, items: result.items, added: result.added });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: m }, { status: 500 });
  }
}

/** Update a line's quantity (0 removes it). */
export async function PATCH(req: Request) {
  const user = await requireSessionUser().catch(() => null);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await req.json();
    const conversationId = String(body?.conversationId ?? "");
    const lineId = String(body?.lineId ?? "");
    const quantity = Number(body?.quantity);
    if (!conversationId || !lineId || Number.isNaN(quantity)) {
      return Response.json({ error: "conversationId, lineId, quantity are required" }, { status: 400 });
    }
    const conv = await resolveConversation(conversationId, user.id);
    if (!conv) return Response.json({ error: "Not found" }, { status: 404 });

    const result = await setLineQuantity(conversationId, lineId, quantity);
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ items: result.items });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: m }, { status: 500 });
  }
}

/** Remove a line from the cart. */
export async function DELETE(req: Request) {
  const user = await requireSessionUser().catch(() => null);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await req.json();
    const conversationId = String(body?.conversationId ?? "");
    const lineId = String(body?.lineId ?? "");
    if (!conversationId || !lineId) {
      return Response.json({ error: "conversationId and lineId are required" }, { status: 400 });
    }
    const conv = await resolveConversation(conversationId, user.id);
    if (!conv) return Response.json({ error: "Not found" }, { status: 404 });

    const result = await removeFromQuote(conversationId, { lineId });
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ items: result.items });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: m }, { status: 500 });
  }
}
