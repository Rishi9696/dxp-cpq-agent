"use client";

import { useEffect, useState } from "react";

type LineItem = { line_id: string; product_name: string; quantity: number; unit_price: number };

export default function Payment() {
  const [conversationId, setConversationId] = useState<string>("");
  const [quote, setQuote] = useState<LineItem[]>([]);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c") ?? "";
    setConversationId(c);
    if (c) {
      fetch(`/api/conversations/${c}`)
        .then((r) => r.json())
        .then((d) => setQuote(d.quote ?? []));
    }
  }, []);

  const total = quote.reduce((s, li) => s + li.unit_price * li.quantity, 0);

  async function pay() {
    setPaying(true);
    setError(null);
    // Dummy payment — no real charge — but we DO record a real order row.
    try {
      const clientId = localStorage.getItem("dxp_client_id") ?? "";
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Checkout failed: ${res.status}`);
      setOrderId(data.order_number);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setPaying(false);
    }
  }

  if (done) {
    return (
      <main style={{ maxWidth: 520, margin: "0 auto", textAlign: "center", paddingTop: "3rem" }}>
        <div style={{ fontSize: "3rem" }}>✅</div>
        <h1>Payment Successful!</h1>
        <p style={{ color: "#a1a1aa" }}>
          Thanks — your order <strong>{orderId}</strong> for <strong>${total}</strong> is confirmed.
        </p>
        <a href="/" style={{ color: "#818cf8" }}>← Back to chat</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto" }}>
      <a href={`/checkout?c=${encodeURIComponent(conversationId)}`} style={{ color: "#818cf8" }}>
        ← Back to checkout
      </a>
      <h1>Payment</h1>
      <p style={{ color: "#a1a1aa", marginTop: 0 }}>
        This is a <strong>dummy</strong> payment page — no real card is charged.
      </p>

      <div style={{ background: "#16161c", borderRadius: 10, padding: "1rem", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
          <span>Amount due</span>
          <span>${total}</span>
        </div>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Card number</span>
          <input defaultValue="4242 4242 4242 4242" style={field()} />
        </label>
        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, flex: 1 }}>
            <span style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Expiry</span>
            <input defaultValue="12/34" style={field()} />
          </label>
          <label style={{ display: "grid", gap: 4, flex: 1 }}>
            <span style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>CVC</span>
            <input defaultValue="123" style={field()} />
          </label>
        </div>
        <button
          onClick={pay}
          disabled={paying || total === 0}
          style={{
            padding: "0.7rem 1.4rem",
            background: paying ? "#4b4b7a" : "#22c55e",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: "1rem",
            cursor: paying ? "default" : "pointer",
          }}
        >
          {paying ? "Processing…" : `Complete Payment ($${total})`}
        </button>
        {error && <p style={{ color: "#f87171", margin: 0 }}>Error: {error}</p>}
      </div>
    </main>
  );
}

function field(): React.CSSProperties {
  return {
    padding: "0.55rem 0.75rem",
    borderRadius: 8,
    border: "1px solid #2e2e38",
    background: "#0f0f14",
    color: "#e8e8ea",
    fontSize: "1rem",
  };
}
