"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type LineItem = {
  line_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  configured: boolean;
  options?: { id: string; name: string; price_delta: number }[];
  attributes?: Record<string, unknown>;
};

function CartPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("c") ?? "";

  const [quote, setQuote] = useState<LineItem[]>([]);
  const [checkoutDone, setCheckoutDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load your cart");
      setQuote(data.quote ?? []);
      setCheckoutDone(Boolean(data.checkoutDone));
      // Already finalized — this cart lives on the quote page now.
      if (data.checkoutDone) {
        router.replace(`/quote?c=${encodeURIComponent(conversationId)}`);
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [conversationId, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeQty(lineId: string, quantity: number) {
    if (busyLine) return;
    setBusyLine(lineId);
    setError(null);
    try {
      const res = await fetch("/api/quote", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, lineId, quantity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to update quantity");
      setQuote(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusyLine(null);
    }
  }

  async function removeLine(lineId: string) {
    if (busyLine) return;
    setBusyLine(lineId);
    setError(null);
    try {
      const res = await fetch("/api/quote", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, lineId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to remove item");
      setQuote(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusyLine(null);
    }
  }

  async function finalize() {
    if (!conversationId || finalizing) return;
    setFinalizing(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to finalize the quote");
      router.push(`/quote?c=${encodeURIComponent(conversationId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setFinalizing(false);
    }
  }

  const itemCount = quote.reduce((s, li) => s + li.quantity, 0);
  const subtotal = quote.reduce((s, li) => s + li.unit_price * li.quantity, 0);

  return (
    <div className="cart-shell">
      <div className="cart-topbar">
        <a href="/" className="back-link">
          <BackIcon /> Back to chat
        </a>
        <h1>
          <CartIcon /> Your cart
        </h1>
      </div>

      <div className="cart-body">
        {loading ? (
          <p style={{ color: "var(--text-muted)", padding: "24px" }}>Loading your cart…</p>
        ) : !conversationId || quote.length === 0 ? (
          <div className="cart-empty">
            <CartIcon size={40} />
            <p className="cart-empty-title">Your cart is empty</p>
            <p>Add a product from the panel or ask the agent, then it&apos;ll show up here.</p>
            <a href="/" className="back-link">
              <BackIcon /> Back to chat
            </a>
          </div>
        ) : (
          <>
            <div className="cart-list">
              {error && <div className="error-banner">Error: {error}</div>}
              {quote.map((li) => (
                <div key={li.line_id} className="cart-row">
                  <span className="cart-row-thumb">
                    <BoxIcon />
                  </span>
                  <div className="cart-row-info">
                    <span className="cart-row-title">{li.product_name}</span>
                    {li.options && li.options.length > 0 && (
                      <span className="cart-row-meta">{li.options.map((o) => o.name).join(", ")}</span>
                    )}
                    {li.attributes && Object.keys(li.attributes).length > 0 && (
                      <span className="cart-row-meta">
                        {Object.entries(li.attributes)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(", ")}
                      </span>
                    )}
                    {!checkoutDone && (
                      <div className="cart-row-actions">
                        <div className="qty-stepper">
                          <button
                            onClick={() => changeQty(li.line_id, li.quantity - 1)}
                            disabled={busyLine === li.line_id || li.quantity <= 1}
                            aria-label="Decrease quantity"
                          >
                            −
                          </button>
                          <span>{li.quantity}</span>
                          <button
                            onClick={() => changeQty(li.line_id, li.quantity + 1)}
                            disabled={busyLine === li.line_id}
                            aria-label="Increase quantity"
                          >
                            +
                          </button>
                        </div>
                        <button
                          className="cart-remove-btn"
                          onClick={() => removeLine(li.line_id)}
                          disabled={busyLine === li.line_id}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="cart-row-price">
                    <span className="cart-row-total">${li.unit_price * li.quantity}</span>
                    <span className="cart-row-unit">${li.unit_price} ea</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-summary">
              <div className="cart-summary-row">
                <span>Items</span>
                <span>{itemCount}</span>
              </div>
              <div className="cart-summary-total">
                <span>Total</span>
                <strong>${subtotal}</strong>
              </div>
              <button className="checkout-btn" onClick={finalize} disabled={finalizing || quote.length === 0}>
                {finalizing ? "Finalizing…" : "Finalize & create quote"}
              </button>
              <p className="cart-summary-hint">
                Finalizing locks this cart and generates your quote.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CartPage() {
  return (
    <Suspense>
      <CartPageInner />
    </Suspense>
  );
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}
function CartIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ verticalAlign: "-2px", marginRight: 4 }}
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}
