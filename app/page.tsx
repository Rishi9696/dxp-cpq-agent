"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type Card = { id: string; name: string; description: string };
type Message = { role: "user" | "assistant"; content: string; products?: Card[] };
type LineItem = {
  id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  configured: boolean;
  options?: { id: string; name: string; price_delta: number }[];
  attributes?: Record<string, unknown>;
};
type Conversation = { id: string; title: string; updated_at: string };

function getClientId(): string {
  const KEY = "dxp_client_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export default function Home() {
  const [clientId, setClientId] = useState<string>("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [quote, setQuote] = useState<LineItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async (cid: string) => {
    const res = await fetch(`/api/conversations?clientId=${encodeURIComponent(cid)}`);
    const data = await res.json();
    if (res.ok) setConversations(data.conversations ?? []);
  }, []);

  useEffect(() => {
    const cid = getClientId();
    setClientId(cid);
    refreshConversations(cid);
  }, [refreshConversations]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setQuote([]);
    setError(null);
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
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: activeId, clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed: ${res.status}`);
      setActiveId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, products: data.products },
      ]);
      setQuote(data.quote ?? []);
      refreshConversations(clientId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const quoteTotal = quote.reduce((s, li) => s + li.unit_price * li.quantity, 0);

  return (
    <div style={{ display: "flex", gap: 16, maxWidth: 1200, margin: "0 auto", height: "88vh" }}>
      {/* Sidebar: conversation memory */}
      <aside style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={newChat} style={btn("#6366f1")}>+ New chat</button>
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {conversations.length === 0 && (
            <p style={{ color: "#6b6b75", fontSize: "0.85rem" }}>No saved chats yet.</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              style={{
                ...pill(),
                background: c.id === activeId ? "#26262e" : "#16161c",
                borderColor: c.id === activeId ? "#6366f1" : "#2e2e38",
              }}
              title={c.title}
            >
              {c.title}
            </button>
          ))}
        </div>
      </aside>

      {/* Chat */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <h1 style={{ margin: "0 0 4px" }}>DXP CPQ Agent</h1>
        <p style={{ color: "#a1a1aa", margin: "0 0 8px", fontSize: "0.9rem" }}>
          Search, configure, and add products to your quote. Memory is saved to Supabase.
        </p>
        <div style={chatBox()}>
          {messages.length === 0 && (
            <p style={{ color: "#6b6b75", margin: "auto", textAlign: "center" }}>
              e.g. “add a MacBook Pro with 32GB RAM to my cart”
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
              <div
                style={{
                  padding: "0.6rem 0.85rem",
                  borderRadius: 12,
                  whiteSpace: "pre-wrap",
                  background: m.role === "user" ? "#6366f1" : "#26262e",
                  color: "white",
                }}
              >
                {m.content}
              </div>
              {m.products && m.products.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  {m.products.map((p) => (
                    <div key={p.id} style={card()}>
                      <strong>{p.name}</strong>
                      <div style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>{p.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && <div style={{ color: "#a1a1aa" }}>Thinking…</div>}
          <div ref={endRef} />
        </div>

        {error && <p style={{ color: "#f87171" }}>Error: {error}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="What do you need?"
            disabled={loading}
            style={{
              flex: 1,
              padding: "0.6rem 0.85rem",
              fontSize: "1rem",
              borderRadius: 8,
              border: "1px solid #2e2e38",
              background: "#0f0f14",
              color: "#e8e8ea",
            }}
          />
          <button onClick={send} disabled={loading || !input.trim()} style={btn("#6366f1")}>Send</button>
        </div>
      </main>

      {/* Quote / cart panel */}
      <aside style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.1rem" }}>Quote</h2>
        <div style={{ ...chatBox(), minHeight: 0, flex: 1 }}>
          {quote.length === 0 && <p style={{ color: "#6b6b75" }}>Cart is empty.</p>}
          {quote.map((li) => (
            <div key={li.id} style={card()}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{li.product_name}</strong>
                <span>${li.unit_price * li.quantity}</span>
              </div>
              <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>
                Qty {li.quantity} · ${li.unit_price} ea{li.configured ? " · configured" : ""}
              </div>
              {li.options && li.options.length > 0 && (
                <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>
                  {li.options.map((o) => o.name).join(", ")}
                </div>
              )}
              {li.attributes && Object.keys(li.attributes).length > 0 && (
                <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>
                  {Object.entries(li.attributes).map(([k, v]) => `${k}: ${v}`).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
        {quote.length > 0 && (
          <div style={{ marginTop: 8, textAlign: "right", fontWeight: 600 }}>Total: ${quoteTotal}</div>
        )}
      </aside>
    </div>
  );
}

// --- tiny style helpers ---
function btn(bg: string): React.CSSProperties {
  return {
    padding: "0.6rem 1.1rem",
    fontSize: "1rem",
    borderRadius: 8,
    border: "none",
    background: bg,
    color: "white",
    cursor: "pointer",
  };
}
function pill(): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "0.5rem 0.6rem",
    borderRadius: 8,
    border: "1px solid #2e2e38",
    background: "#16161c",
    color: "#e8e8ea",
    cursor: "pointer",
    fontSize: "0.85rem",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}
function chatBox(): React.CSSProperties {
  return {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "1rem",
    background: "#16161c",
    borderRadius: 10,
    marginBottom: 12,
  };
}
function card(): React.CSSProperties {
  return {
    padding: "0.6rem 0.75rem",
    background: "#1d1d24",
    border: "1px solid #2e2e38",
    borderRadius: 8,
  };
}
