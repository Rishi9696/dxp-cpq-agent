"use client";

import { useEffect, useState } from "react";

type LineItem = {
  id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  configured: boolean;
  options?: { name: string }[];
};

export default function Checkout() {
  const [conversationId, setConversationId] = useState<string>("");
  const [quote, setQuote] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c") ?? "";
    setConversationId(c);
    if (!c) {
      setLoading(false);
      return;
    }
    fetch(`/api/conversations/${c}`)
      .then((r) => r.json())
      .then((d) => setQuote(d.quote ?? []))
      .finally(() => setLoading(false));
  }, []);

  const total = quote.reduce((s, li) => s + li.unit_price * li.quantity, 0);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto" }}>
      <a href="/" style={{ color: "#818cf8" }}>← Back to chat</a>
      <h1>Checkout</h1>

      {loading ? (
        <p style={{ color: "#a1a1aa" }}>Loading your quote…</p>
      ) : quote.length === 0 ? (
        <p style={{ color: "#a1a1aa" }}>
          Your quote is empty. Add products in the chat first.
        </p>
      ) : (
        <>
          <div style={{ background: "#16161c", borderRadius: 10, padding: "1rem", marginBottom: 16 }}>
            {quote.map((li) => (
              <div
                key={li.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "0.5rem 0",
                  borderBottom: "1px solid #2e2e38",
                }}
              >
                <div>
                  <strong>{li.product_name}</strong>
                  <div style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>
                    Qty {li.quantity} · ${li.unit_price} ea
                    {li.options && li.options.length > 0
                      ? " · " + li.options.map((o) => o.name).join(", ")
                      : ""}
                  </div>
                </div>
                <span>${li.unit_price * li.quantity}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, fontWeight: 700, fontSize: "1.1rem" }}>
              <span>Total</span>
              <span>${total}</span>
            </div>
          </div>

          <a
            href={`/payment?c=${encodeURIComponent(conversationId)}`}
            style={{
              display: "inline-block",
              padding: "0.7rem 1.4rem",
              background: "#6366f1",
              color: "white",
              borderRadius: 8,
              fontSize: "1rem",
              textDecoration: "none",
            }}
          >
            Proceed to Payment →
          </a>
        </>
      )}
    </main>
  );
}
