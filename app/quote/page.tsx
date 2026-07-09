"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

type LineItem = {
  line_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  configured: boolean;
  options?: { id: string; name: string; price_delta: number }[];
  attributes?: Record<string, unknown>;
};
type Order = { order_number: string; total: number; created_at?: string };

function QuotePageInner() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("c") ?? "";

  const [items, setItems] = useState<LineItem[]>([]);
  const [checkoutDone, setCheckoutDone] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/conversations/${conversationId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load the quote");
      setItems(data.order?.items ?? data.quote ?? []);
      setCheckoutDone(Boolean(data.checkoutDone));
      setOrder(data.order ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  const total = order?.total ?? items.reduce((s, li) => s + li.unit_price * li.quantity, 0);
  const itemCount = items.reduce((s, li) => s + li.quantity, 0);

  return (
    <div className="cart-shell">
      <div className="cart-topbar">
        <a href="/" className="back-link">
          <BackIcon /> Back to chat
        </a>
        <h1>
          <DocIcon /> Quote
        </h1>
      </div>

      <div className="cart-body">
        {loading ? (
          <p style={{ color: "var(--text-muted)", padding: "24px" }}>Loading your quote…</p>
        ) : error ? (
          <div className="error-banner" style={{ margin: 24 }}>
            Error: {error}
          </div>
        ) : !conversationId || !checkoutDone ? (
          <div className="cart-empty">
            <DocIcon size={40} />
            <p className="cart-empty-title">No finalized quote yet</p>
            <p>Finalize your cart first, then your quote will appear here.</p>
            <a href={conversationId ? `/cart?c=${encodeURIComponent(conversationId)}` : "/"} className="back-link">
              <BackIcon /> {conversationId ? "Go to cart" : "Back to chat"}
            </a>
          </div>
        ) : (
          <>
            <div className="cart-list">
              <div className="quote-doc-header">
                <div className="success-card" style={{ margin: 0 }}>
                  <div className="success-card-title">
                    <CheckIcon /> Quote finalized
                  </div>
                  {order && (
                    <div className="success-card-detail">
                      {order.order_number}
                      {order.created_at ? ` · ${new Date(order.created_at).toLocaleString()}` : ""}
                    </div>
                  )}
                  <div className="success-card-hint">
                    This quote is locked. Start a <strong>New chat</strong> to build another one.
                  </div>
                </div>
              </div>

              {items.map((li) => (
                <div key={li.line_id} className="cart-row">
                  <span className="cart-row-thumb">
                    <BoxIcon />
                  </span>
                  <div className="cart-row-info">
                    <span className="cart-row-title">{li.product_name}</span>
                    <span className="cart-row-meta">
                      Qty {li.quantity}
                      {li.configured ? " · configured" : ""}
                    </span>
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
                  </div>
                  <div className="cart-row-price">
                    <span className="cart-row-total">${li.unit_price * li.quantity}</span>
                    <span className="cart-row-unit">${li.unit_price} ea</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-summary">
              {order && (
                <div className="cart-summary-row">
                  <span>Quote #</span>
                  <span>{order.order_number}</span>
                </div>
              )}
              <div className="cart-summary-row">
                <span>Items</span>
                <span>{itemCount}</span>
              </div>
              <div className="cart-summary-total">
                <span>Total</span>
                <strong>${total}</strong>
              </div>
              <a href="/" className="checkout-btn">
                Start a new chat
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function QuotePage() {
  return (
    <Suspense>
      <QuotePageInner />
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
function DocIcon({ size = 15 }: { size?: number }) {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8M16 17H8M10 9H8" />
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
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
