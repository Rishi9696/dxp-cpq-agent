import { createSession, runAgentTurn } from "@/lib/agent";
import {
  createConversation,
  getConversation,
  getQuote,
  saveMessage,
  touchConversation,
} from "@/lib/supabase";

// Managed Agents flow can take a while (session provisioning + agent loop).
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  }
  if (!process.env.DXP_AGENT_ID || !process.env.DXP_ENVIRONMENT_ID) {
    return Response.json(
      { error: "DXP_AGENT_ID / DXP_ENVIRONMENT_ID are not set. Run scripts/setup-agent.mjs." },
      { status: 500 }
    );
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. See supabase/schema.sql and README." },
      { status: 500 }
    );
  }

  let message: string;
  let conversationId: string | undefined;
  let clientId: string;
  try {
    const body = await req.json();
    message = String(body?.message ?? "").trim();
    conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
    clientId = String(body?.clientId ?? "").trim();
    if (!message) throw new Error("message is required");
    if (!clientId) throw new Error("clientId is required");
  } catch (e) {
    const m = e instanceof Error ? e.message : "bad body";
    return Response.json({ error: `Invalid request body: ${m}` }, { status: 400 });
  }

  try {
    let conversation = conversationId ? await getConversation(conversationId) : null;
    if (!conversation) {
      const sessionId = await createSession();
      conversation = await createConversation(clientId, sessionId, message);
    }
    const sessionId = conversation.session_id;
    if (!sessionId) throw new Error("conversation has no session");

    await saveMessage(conversation.id, "user", message);
    const { reply, products } = await runAgentTurn(sessionId, message, conversation.id);
    await saveMessage(conversation.id, "assistant", reply, products);
    await touchConversation(conversation.id);

    const quote = await getQuote(conversation.id);
    return Response.json({
      conversationId: conversation.id,
      reply,
      products,
      quote: quote.items,
      checkoutDone: quote.checkout_done,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Agent failed: ${m}` }, { status: 500 });
  }
}
