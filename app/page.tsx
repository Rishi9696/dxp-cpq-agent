"use client";

import { useState, useRef, useEffect } from "react";

type Product = { id: string; name: string; description: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  products?: Product[];
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setInput("");
    const history: Message[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed: ${res.status}`);
      if (data.sessionId) setSessionId(data.sessionId);
      setMessages([
        ...history,
        { role: "assistant", content: data.reply, products: data.products },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 680, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>DXP Product Recommender</h1>
      <p style={{ color: "#a1a1aa", marginTop: 0 }}>
        Tell me what you need — a Claude-managed agent searches the catalog and
        recommends products.
      </p>

      <div
        style={{
          minHeight: 320,
          maxHeight: "55vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "1rem",
          background: "#16161c",
          borderRadius: 10,
          marginBottom: 12,
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: "#6b6b75", margin: "auto", textAlign: "center" }}>
            e.g. “I need something to commute to work without a car”
          </p>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
            }}
          >
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
                  <div
                    key={p.id}
                    style={{
                      padding: "0.6rem 0.75rem",
                      background: "#1d1d24",
                      border: "1px solid #2e2e38",
                      borderRadius: 8,
                    }}
                  >
                    <strong>{p.name}</strong>
                    <div style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>
                      {p.description}
                    </div>
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
          placeholder="What are you looking for?"
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
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            padding: "0.6rem 1.1rem",
            fontSize: "1rem",
            borderRadius: 8,
            border: "none",
            background: "#6366f1",
            color: "white",
            cursor: loading ? "default" : "pointer",
          }}
        >
          Send
        </button>
      </div>
    </main>
  );
}
