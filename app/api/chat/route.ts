import { recommend, type ChatMessage } from "@/lib/agent";

// Backend: the Claude-managed agent endpoint. Runs server-side as a Vercel
// serverless function, so the API key never reaches the browser.
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  let messages: ChatMessage[];
  try {
    const body = await req.json();
    messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages must be a non-empty array");
    }
  } catch {
    return Response.json(
      { error: "Invalid request body. Expected { messages: [...] }." },
      { status: 400 }
    );
  }

  try {
    const { reply, products } = await recommend(messages);
    return Response.json({ reply, products });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Agent failed: ${message}` }, { status: 500 });
  }
}
