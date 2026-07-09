"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { OptionGroup, CatalogAttribute } from "@/lib/catalog";

type Card = {
  id: string;
  name: string;
  description: string;
  base_price?: number;
  configurable?: boolean;
  option_groups?: OptionGroup[];
  attributes?: CatalogAttribute[];
};
type Message = { role: "user" | "assistant"; content: string; products?: Card[] };
type LineItem = {
  line_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  configured: boolean;
  options?: { id: string; name: string; price_delta: number }[];
  attributes?: Record<string, unknown>;
};
type Conversation = { id: string; title: string; updated_at: string };
type Order = { order_number: string; total: number; created_at?: string };

const SUGGESTIONS = [
  "Add a MacBook Pro with 32GB RAM to my cart",
  "Show me laptops under $2,000",
  "Configure a Dell XPS 15",
  "What accessories go with an iPad Pro?",
];

function initials(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function ChatClient({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [quote, setQuote] = useState<LineItem[]>([]);
  const [checkoutDone, setCheckoutDone] = useState(false);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Card[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [recommended, setRecommended] = useState<Card[]>([]);
  const [showAll, setShowAll] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Serialize cart adds and track the live conversation id so two quick adds
  // (before the first one creates a conversation) can't split into two carts.
  const activeIdRef = useRef<string | null>(null);
  const addChainRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    const data = await res.json();
    if (res.ok) setConversations(data.conversations ?? []);
  }, []);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // Load the full catalog once — the panel shows everything until the agent recommends.
  const loadCatalog = useCallback(async () => {
    setCatalogError(false);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load catalog");
      setCatalog(data.products ?? []);
    } catch {
      setCatalogError(true);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setQuote([]);
    setCheckoutDone(false);
    setLastOrder(null);
    setError(null);
    setRecommended([]);
    setShowAll(true);
  }

  function goToCart() {
    router.push(activeId ? `/cart?c=${encodeURIComponent(activeId)}` : "/cart");
  }

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function openConversation(id: string) {
    setError(null);
    setActiveId(id);
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error ?? "Failed to load conversation");
      return;
    }
    const loadedMessages = (data.messages ?? []).map(
      (m: { role: string; content: string; products?: Card[] }) => ({
        role: m.role,
        content: m.content,
        products: m.products ?? [],
      })
    );
    setMessages(loadedMessages);
    setQuote(data.quote ?? []);
    setCheckoutDone(Boolean(data.checkoutDone));
    setLastOrder(data.order ?? null);
    const lastWithProducts = [...loadedMessages].reverse().find((m) => m.products && m.products.length > 0);
    const rec = lastWithProducts?.products ?? [];
    setRecommended(rec);
    setShowAll(rec.length === 0);
  }

  async function send(text?: string) {
    const value = (text ?? input).trim();
    if (!value || loading) return;
    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: value }]);
    setLoading(true);
    setStreamingText("");
    setStatus(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: value, conversationId: activeId }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `Request failed: ${res.status}`);
      }

      // Read the Server-Sent Events stream from the managed agent.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let doneEvent: { reply?: string; products?: Card[]; quote?: LineItem[]; checkoutDone?: boolean } | null = null;

      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const ev = JSON.parse(dataLine.slice(6));
          if (ev.type === "meta") {
            setActiveId(ev.conversationId);
          } else if (ev.type === "status") {
            setStatus(ev.text);
          } else if (ev.type === "reset") {
            assistantText = "";
            setStreamingText("");
          } else if (ev.type === "text") {
            assistantText += ev.text;
            setStreamingText(assistantText);
            setStatus(null);
          } else if (ev.type === "done") {
            doneEvent = ev;
          } else if (ev.type === "error") {
            throw new Error(ev.error);
          }
        }
      }

      if (doneEvent) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: doneEvent!.reply ?? assistantText, products: doneEvent!.products },
        ]);
        setQuote(doneEvent.quote ?? []);
        setCheckoutDone(Boolean(doneEvent.checkoutDone));
        if (doneEvent.products && doneEvent.products.length > 0) {
          setRecommended(doneEvent.products);
          setShowAll(false);
        }
        refreshConversations();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
      setStreamingText("");
      setStatus(null);
    }
  }

  // Add a configured product to the cart from the UI (same path the agent uses).
  // Adds are chained so concurrent clicks reuse one conversation/cart.
  function addToCart(
    productId: string,
    quantity: number,
    optionIds: string[],
    attributes: Record<string, unknown>
  ): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            conversationId: activeIdRef.current,
            productId,
            quantity,
            optionIds,
            attributes,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to add to cart");
        if (!activeIdRef.current && data.conversationId) {
          activeIdRef.current = data.conversationId;
          setActiveId(data.conversationId);
          refreshConversations();
        }
        setQuote(data.items ?? []);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        return false;
      }
    };
    const p = addChainRef.current.then(run, run);
    addChainRef.current = p;
    return p;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const cartCount = quote.reduce((s, li) => s + li.quantity, 0);
  const hasRecommendations = recommended.length > 0;
  const displayedProducts = hasRecommendations && !showAll ? recommended : catalog;

  return (
    <div className="app">
      {/* Sidebar: conversation memory */}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <SparkIcon />
          </span>
          DXP CPQ Agent
        </div>

        <button onClick={newChat} className="new-chat-btn">
          <PlusIcon />
          New chat
        </button>

        <div className="sidebar-label">Recent</div>
        <div className="conversation-list">
          {conversations.length === 0 && <p className="conversation-empty">No saved chats yet.</p>}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={`conversation-item${c.id === activeId ? " active" : ""}`}
              title={c.title}
            >
              <ChatIcon />
              {c.title}
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="avatar-chip">{initials(userEmail)}</span>
          <span className="sidebar-footer-email">{userEmail}</span>
          <button
            onClick={signOut}
            disabled={signingOut}
            className="logout-btn"
            title="Log out"
            aria-label="Log out"
          >
            <LogoutIcon />
          </button>
        </div>
      </aside>

      {/* Chat */}
      <main className="main">
        <div className="main-header">
          <div>
            <p className="main-header-title">DXP CPQ Agent</p>
            <p className="main-header-subtitle">Search, configure, and add products to your quote.</p>
          </div>
          <button className="cart-btn" onClick={goToCart} title="View cart" aria-label="View cart">
            <CartIcon />
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
        </div>

        {messages.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-mark">
              <SparkIcon />
            </span>
            <h1 className="empty-state-title">What do you need?</h1>
            <p className="empty-state-subtitle">
              Ask me to find, configure, or add products to your quote — I&apos;ll remember the conversation.
            </p>
            <div className="suggestion-grid">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion-card" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-scroll">
            <div className="chat-inner">
              {messages.map((m, i) => (
                <div key={i} className={`msg-row ${m.role}`}>
                  {m.role === "assistant" && (
                    <span className="msg-avatar">
                      <SparkIcon small />
                    </span>
                  )}
                  <div className="msg-content-col">
                    <div className="msg-bubble">{m.content}</div>
                    {m.products && m.products.length > 0 && (
                      <button
                        className="product-pointer"
                        onClick={() => {
                          setRecommended(m.products!);
                          setShowAll(false);
                        }}
                      >
                        <SparkIcon small /> {m.products.length === 1 ? "1 product" : `${m.products.length} products`} shown on the right
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="msg-row assistant">
                  <span className="msg-avatar">
                    <SparkIcon small />
                  </span>
                  <div className="msg-content-col">
                    {streamingText ? (
                      <div className="msg-bubble">{streamingText}</div>
                    ) : status ? (
                      <div className="msg-bubble msg-status">{status}</div>
                    ) : (
                      <div className="typing-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>
        )}

        {error && <div className="error-banner">Error: {error}</div>}
        {checkoutDone && (
          <div className="sent-banner">
            <CheckIcon /> Quote sent{lastOrder ? ` — ${lastOrder.order_number} · $${lastOrder.total}` : ""}.{" "}
            {activeId && (
              <a href={`/quote?c=${encodeURIComponent(activeId)}`} className="sent-banner-link">
                View quote
              </a>
            )}
          </div>
        )}

        <div className="composer-wrap">
          <div className="composer">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message the CPQ agent…"
              disabled={loading}
              rows={1}
            />
            <button onClick={() => send()} disabled={loading || !input.trim()} className="send-btn">
              <SendIcon />
            </button>
          </div>
          <p className="composer-hint">Press Enter to send, Shift+Enter for a new line.</p>
        </div>
      </main>

      {/* Product panel: full catalog by default, filtered to recommendations */}
      <aside className="product-panel">
        <div className="product-panel-header">
          <SparkIcon small />
          <h2>{hasRecommendations && !showAll ? "Recommended" : "Products"}</h2>
          <span className="quote-count">{displayedProducts.length}</span>
        </div>

        {hasRecommendations && (
          <div className="panel-toggle-row">
            <button
              className={`panel-toggle${!showAll ? " active" : ""}`}
              onClick={() => setShowAll(false)}
            >
              Recommended ({recommended.length})
            </button>
            <button
              className={`panel-toggle${showAll ? " active" : ""}`}
              onClick={() => setShowAll(true)}
            >
              All products ({catalog.length})
            </button>
          </div>
        )}

        <div className="product-panel-body">
          {displayedProducts.length === 0 && (
            <div className="quote-empty">
              <SparkIcon />
              {catalogError ? (
                <>
                  Couldn&apos;t load the catalog.
                  <button className="panel-toggle" onClick={loadCatalog}>
                    Retry
                  </button>
                </>
              ) : (
                "Loading the catalog…"
              )}
            </div>
          )}
          {displayedProducts.map((p) => (
            <ProductCard key={p.id} product={p} disabled={checkoutDone} onAdd={addToCart} />
          ))}
        </div>
      </aside>
    </div>
  );
}

/**
 * One product in the right panel. Click to expand, pick options/attributes/
 * quantity, and add to the cart — the same quote the agent writes to.
 */
function ProductCard({
  product,
  disabled,
  onAdd,
}: {
  product: Card;
  disabled: boolean;
  onAdd: (
    productId: string,
    quantity: number,
    optionIds: string[],
    attributes: Record<string, unknown>
  ) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Record<string, string[]>>({}); // group -> option ids
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const groups = product.option_groups ?? [];
  const attributes = product.attributes ?? [];

  // Default single-select groups to their first (included) option.
  useEffect(() => {
    const init: Record<string, string[]> = {};
    for (const g of groups) {
      if (g.min >= 1 && g.options.length > 0) init[g.group] = [g.options[0].id];
    }
    setSelected(init);
    const initAttrs: Record<string, string> = {};
    for (const a of attributes) {
      if (a.choices.length > 0) initAttrs[a.name] = a.choices[0];
    }
    setAttrs(initAttrs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  function toggleOption(group: OptionGroup, optionId: string) {
    setSelected((prev) => {
      const current = prev[group.group] ?? [];
      const single = group.max <= 1;
      if (single) return { ...prev, [group.group]: [optionId] };
      if (current.includes(optionId)) {
        const next = current.filter((id) => id !== optionId);
        if (next.length < group.min) return prev; // keep minimum selections
        return { ...prev, [group.group]: next };
      }
      if (current.length >= group.max) return prev; // at max
      return { ...prev, [group.group]: [...current, optionId] };
    });
  }

  const optionIds = Object.values(selected).flat();
  const allOptions = groups.flatMap((g) => g.options);
  const unitPrice =
    (product.base_price ?? 0) +
    optionIds.reduce((s, id) => s + (allOptions.find((o) => o.id === id)?.price_delta ?? 0), 0);

  async function handleAdd() {
    if (adding || disabled) return;
    setAdding(true);
    const ok = await onAdd(product.id, qty, optionIds, attrs);
    setAdding(false);
    if (ok) {
      setAdded(true);
      setTimeout(() => setAdded(false), 1600);
    }
  }

  return (
    <div className={`product-detail-card clickable${expanded ? " expanded" : ""}`}>
      <button className="product-card-head" onClick={() => setExpanded((v) => !v)}>
        <div className="product-detail-top">
          <strong>{product.name}</strong>
          {typeof product.base_price === "number" && (
            <span className="product-detail-price">
              {product.configurable ? "From " : ""}${product.base_price}
            </span>
          )}
        </div>
        <div className="product-card-desc">{product.description}</div>
      </button>

      {expanded && (
        <div className="product-configurator">
          {groups.map((g) => (
            <div key={g.group} className="product-config-group">
              <div className="product-config-label">
                {g.label}
                {g.max > 1 ? ` (up to ${g.max})` : ""}
              </div>
              <div className="product-config-options">
                {g.options.map((o) => {
                  const isSel = (selected[g.group] ?? []).includes(o.id);
                  return (
                    <button
                      key={o.id}
                      className={`option-chip selectable${isSel ? " selected" : ""}`}
                      onClick={() => toggleOption(g, o.id)}
                    >
                      {o.name}
                      {o.price_delta > 0 ? ` (+$${o.price_delta})` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {attributes.map((a) => (
            <div key={a.name} className="product-config-group">
              <div className="product-config-label">{a.label}</div>
              <div className="product-config-options">
                {a.choices.map((c) => (
                  <button
                    key={c}
                    className={`option-chip selectable${attrs[a.name] === c ? " selected" : ""}`}
                    onClick={() => setAttrs((prev) => ({ ...prev, [a.name]: c }))}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="product-add-row">
            <div className="qty-stepper">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
                −
              </button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="Increase quantity">
                +
              </button>
            </div>
            <button
              className={`add-to-cart-btn${added ? " added" : ""}`}
              onClick={handleAdd}
              disabled={adding || disabled}
              title={disabled ? "Quote is locked — start a new chat" : "Add to cart"}
            >
              {added ? (
                <>
                  <CheckIcon /> Added
                </>
              ) : adding ? (
                "Adding…"
              ) : (
                `Add to cart · $${unitPrice * qty}`
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- tiny inline icons (no extra deps) ---
function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function CartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-secondary)", flexShrink: 0 }}>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
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
function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
function SparkIcon({ small }: { small?: boolean }) {
  const s = small ? 14 : 18;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="white">
      <path d="M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
    </svg>
  );
}
