"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

type Card = { id: string; name: string; description: string };
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
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    const data = await res.json();
    if (res.ok) setConversations(data.conversations ?? []);
  }, []);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

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
    setMessages(
      (data.messages ?? []).map((m: { role: string; content: string; products?: Card[] }) => ({
        role: m.role,
        content: m.content,
        products: m.products ?? [],
      }))
    );
    setQuote(data.quote ?? []);
    setCheckoutDone(Boolean(data.checkoutDone));
    setLastOrder(data.order ?? null);
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const quoteTotal = quote.reduce((s, li) => s + li.unit_price * li.quantity, 0);

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
                      <div className="product-grid">
                        {m.products.map((p) => (
                          <div key={p.id} className="product-card">
                            <strong>{p.name}</strong>
                            <div className="product-card-desc">{p.description}</div>
                          </div>
                        ))}
                      </div>
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

      {/* Quote / cart panel */}
      <aside className="quote-panel">
        <div className="quote-header">
          <CartIcon />
          <h2>Quote</h2>
          {quote.length > 0 && <span className="quote-count">{quote.length}</span>}
        </div>

        {checkoutDone && (
          <div className="success-card">
            <div className="success-card-title">
              <CheckIcon /> Checked out
            </div>
            {lastOrder && (
              <div className="success-card-detail">
                Order {lastOrder.order_number} · ${lastOrder.total}
              </div>
            )}
            <div className="success-card-hint">
              This quote is locked. Start a <strong>New chat</strong> to add more products.
            </div>
          </div>
        )}

        <div className="quote-body">
          {quote.length === 0 && (
            <div className="quote-empty">
              <CartIcon size={26} />
              Your cart is empty.
            </div>
          )}
          {quote.map((li) => (
            <div key={li.line_id} className="line-item-card">
              <div className="line-item-top">
                <strong>{li.product_name}</strong>
                <span>${li.unit_price * li.quantity}</span>
              </div>
              <div className="line-item-meta">
                Qty {li.quantity} · ${li.unit_price} ea{li.configured ? " · configured" : ""}
              </div>
              {li.options && li.options.length > 0 && (
                <div className="line-item-meta">{li.options.map((o) => o.name).join(", ")}</div>
              )}
              {li.attributes && Object.keys(li.attributes).length > 0 && (
                <div className="line-item-meta">
                  {Object.entries(li.attributes).map(([k, v]) => `${k}: ${v}`).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>

        {quote.length > 0 && (
          <div className="quote-footer">
            <div className="quote-total-row">
              <span>Total</span>
              <strong>${quoteTotal}</strong>
            </div>
            {activeId && !checkoutDone && (
              <a href={`/checkout?c=${encodeURIComponent(activeId)}`} className="checkout-btn">
                Checkout <ArrowRightIcon />
              </a>
            )}
          </div>
        )}
      </aside>
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
function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
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
