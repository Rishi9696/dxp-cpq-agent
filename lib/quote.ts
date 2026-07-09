import { randomUUID } from "node:crypto";
import { buildLineItem } from "./catalog";
import { getQuote, saveQuoteItems, type QuoteItem } from "./supabase";

// Shared quote/cart operations used by BOTH the agent's custom tools and the
// UI's /api/quote route, so items added from either place behave identically.

const optSig = (ids: string[]) => ids.slice().sort().join(",");

// Key-order-independent attribute signature so the agent's {size, color} and
// the UI's {color, size} merge into the same line.
const attrSig = (attrs: Record<string, unknown>) =>
  JSON.stringify(
    Object.keys(attrs)
      .sort()
      .map((k) => [k, attrs[k]])
  );

export type QuoteOpResult =
  | { ok: true; items: QuoteItem[]; added?: string; removed_count?: number }
  | { ok: false; error: string };

const LOCKED_MSG =
  "This quote is already checked out and locked. Start a new chat to build a new quote.";

/** Add a product (with options/attributes/quantity), merging identical lines. */
export async function addToQuote(
  conversationId: string,
  productId: string,
  quantity = 1,
  optionIds: string[] = [],
  attributes: Record<string, unknown> = {}
): Promise<QuoteOpResult> {
  const quote = await getQuote(conversationId);
  if (quote.checkout_done) return { ok: false, error: LOCKED_MSG };

  const qty = Math.max(1, Number(quantity) || 1);
  const li = buildLineItem(productId, optionIds);
  if (!li) return { ok: false, error: `Unknown product_id: ${productId}` };

  const items = quote.items;
  const match = items.find(
    (it) =>
      it.product_id === productId &&
      optSig(it.options.map((o) => o.id)) === optSig(optionIds) &&
      attrSig(it.attributes) === attrSig(attributes)
  );
  if (match) match.quantity += qty;
  else
    items.push({
      line_id: randomUUID().slice(0, 8),
      product_id: productId,
      product_name: li.name,
      quantity: qty,
      unit_price: li.unit_price,
      configured: li.configured,
      options: li.options,
      attributes,
    });
  await saveQuoteItems(conversationId, items);
  return { ok: true, items, added: li.name };
}

/** Remove lines by line_id or product_id. */
export async function removeFromQuote(
  conversationId: string,
  opts: { lineId?: string; productId?: string }
): Promise<QuoteOpResult> {
  const quote = await getQuote(conversationId);
  if (quote.checkout_done) return { ok: false, error: LOCKED_MSG };
  const before = quote.items.length;
  const items = quote.items.filter((it) =>
    opts.lineId ? it.line_id !== opts.lineId : opts.productId ? it.product_id !== opts.productId : true
  );
  await saveQuoteItems(conversationId, items);
  return { ok: true, items, removed_count: before - items.length };
}

/** Set an existing line's quantity; 0 removes the line. */
export async function setLineQuantity(
  conversationId: string,
  lineId: string,
  quantity: number
): Promise<QuoteOpResult> {
  const quote = await getQuote(conversationId);
  if (quote.checkout_done) return { ok: false, error: LOCKED_MSG };
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  let items = quote.items;
  const line = items.find((it) => it.line_id === lineId);
  if (!line) return { ok: false, error: `Unknown line_id: ${lineId}` };
  if (qty === 0) items = items.filter((it) => it.line_id !== lineId);
  else line.quantity = qty;
  await saveQuoteItems(conversationId, items);
  return { ok: true, items };
}
