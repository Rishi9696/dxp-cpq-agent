import { describe, it, expect, beforeEach, vi } from "vitest";
import type { QuoteItem, Quote } from "./supabase";

// In-memory fake for lib/supabase.ts so quote.ts's mutation logic can be
// tested without a real Supabase project. Keyed by conversationId.
const store = new Map<string, Quote>();

function seed(conversationId: string, items: QuoteItem[] = [], checkout_done = false) {
  store.set(conversationId, { id: "q1", conversation_id: conversationId, items, checkout_done });
}

vi.mock("./supabase", () => ({
  getQuote: vi.fn(async (conversationId: string) => {
    const q = store.get(conversationId);
    if (!q) throw new Error(`No quote seeded for ${conversationId}`);
    // Return a shallow copy so callers mutating .items don't corrupt the "DB" until saveQuoteItems.
    return { ...q, items: q.items.map((it) => ({ ...it })) };
  }),
  saveQuoteItems: vi.fn(async (conversationId: string, items: QuoteItem[]) => {
    const q = store.get(conversationId);
    if (!q) throw new Error(`No quote seeded for ${conversationId}`);
    store.set(conversationId, { ...q, items });
  }),
}));

const { addToQuote, removeFromQuote, setLineQuantity } = await import("./quote");

const CONV = "conv-1";

beforeEach(() => {
  store.clear();
  seed(CONV);
});

describe("addToQuote", () => {
  it("adds a non-configurable product as a new line", async () => {
    const result = await addToQuote(CONV, "notebook", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      product_id: "notebook",
      product_name: "A5 Hardcover Notebook",
      quantity: 1,
      unit_price: 15,
      configured: false,
    });
    expect(result.items[0].line_id).toHaveLength(8);
  });

  it("merges identical lines (same product, options, attributes) by summing quantity", async () => {
    await addToQuote(CONV, "macbook-pro", 1, ["ram-32", "ssd-1tb"], { color: "Space Black" });
    const result = await addToQuote(CONV, "macbook-pro", 2, ["ram-32", "ssd-1tb"], { color: "Space Black" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(3);
  });

  it("merges lines when option order or attribute key order differs", async () => {
    await addToQuote(CONV, "macbook-pro", 1, ["ram-32", "ssd-1tb"], { color: "Space Black" });
    const result = await addToQuote(CONV, "macbook-pro", 1, ["ssd-1tb", "ram-32"], { color: "Space Black" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(2);
  });

  it("keeps distinct lines when options differ", async () => {
    await addToQuote(CONV, "macbook-pro", 1, ["ram-16"]);
    const result = await addToQuote(CONV, "macbook-pro", 1, ["ram-32"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(2);
  });

  it("computes unit_price as base_price + sum of option price_deltas", async () => {
    const result = await addToQuote(CONV, "macbook-pro", 1, ["ram-32", "ssd-1tb"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // base 1999 + ram-32 (400) + ssd-1tb (200)
    expect(result.items[0].unit_price).toBe(2599);
  });

  it("rejects an unknown product_id", async () => {
    const result = await addToQuote(CONV, "does-not-exist", 1);
    expect(result.ok).toBe(false);
  });

  it("clamps quantity to a minimum of 1", async () => {
    const result = await addToQuote(CONV, "notebook", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].quantity).toBe(1);
  });

  it("refuses to mutate a checked-out quote", async () => {
    seed(CONV, [], true);
    const result = await addToQuote(CONV, "notebook", 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/locked/i);
  });
});

describe("removeFromQuote", () => {
  it("removes a line by line_id", async () => {
    const added = await addToQuote(CONV, "notebook", 1);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const lineId = added.items[0].line_id;

    const result = await removeFromQuote(CONV, { lineId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(0);
    expect(result.removed_count).toBe(1);
  });

  it("falls back to removing by product_id when no line_id matches", async () => {
    await addToQuote(CONV, "notebook", 1);
    const result = await removeFromQuote(CONV, { productId: "notebook" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(0);
  });

  it("is a no-op when nothing matches", async () => {
    await addToQuote(CONV, "notebook", 1);
    const result = await removeFromQuote(CONV, { lineId: "nonexistent" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.removed_count).toBe(0);
  });

  it("refuses to mutate a checked-out quote", async () => {
    seed(CONV, [], true);
    const result = await removeFromQuote(CONV, { productId: "notebook" });
    expect(result.ok).toBe(false);
  });
});

describe("setLineQuantity", () => {
  it("updates an existing line's quantity", async () => {
    const added = await addToQuote(CONV, "notebook", 1);
    if (!added.ok) return;
    const lineId = added.items[0].line_id;

    const result = await setLineQuantity(CONV, lineId, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].quantity).toBe(5);
  });

  it("removes the line when quantity is set to 0", async () => {
    const added = await addToQuote(CONV, "notebook", 1);
    if (!added.ok) return;
    const lineId = added.items[0].line_id;

    const result = await setLineQuantity(CONV, lineId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(0);
  });

  it("errors on an unknown line_id", async () => {
    const result = await setLineQuantity(CONV, "nonexistent", 3);
    expect(result.ok).toBe(false);
  });

  it("refuses to mutate a checked-out quote", async () => {
    seed(CONV, [], true);
    const result = await setLineQuantity(CONV, "any", 1);
    expect(result.ok).toBe(false);
  });
});
