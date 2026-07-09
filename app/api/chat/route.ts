import { createSession, runAgentTurnStreaming, generateTitle } from "@/lib/agent";
import {
  createConversation,
  getConversation,
  getQuote,
  saveMessage,
  touchConversation,
  updateConversationSession,
  updateConversationTitle,
} from "@/lib/supabase";
import { requireSessionUser } from "@/lib/supabase/server";

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

  const user = await requireSessionUser().catch(() => null);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  let message: string;
  let conversationId: string | undefined;
  try {
    const body = await req.json();
    message = String(body?.message ?? "").trim();
    conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
    if (!message) throw new Error("message is required");
  } catch (e) {
    const m = e instanceof Error ? e.message : "bad body";
    return Response.json({ error: `Invalid request body: ${m}` }, { status: 400 });
  }

  // Resolve (or create) the conversation up front so ownership errors are plain JSON.
  let conversation = conversationId ? await getConversation(conversationId) : null;
  if (conversation && conversation.user_id !== user.id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  let isNew = false;
  if (!conversation) {
    const sessionId = await createSession();
    conversation = await createConversation(user.id, sessionId, message);
    isNew = true;
  }
  const conv = conversation;
  // Conversations started from a UI cart add have no agent session yet — create one now.
  let sessionId = conv.session_id;
  if (!sessionId) {
    sessionId = await createSession();
    await updateConversationSession(conv.id, sessionId);
  }

  // Stream the turn as Server-Sent Events.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        send({ type: "meta", conversationId: conv.id });
        await saveMessage(conv.id, "user", message);

        const { reply, products } = await runAgentTurnStreaming(sessionId, message, conv.id, (e) =>
          send(e)
        );

        await saveMessage(conv.id, "assistant", reply, products);
        await touchConversation(conv.id);

        // Auto-rename the chat from the conversation on its first turn.
        let title: string | undefined;
        if (isNew) {
          const t = await generateTitle(message, reply);
          if (t) {
            await updateConversationTitle(conv.id, t);
            title = t;
          }
        }

        const quote = await getQuote(conv.id);
        send({
          type: "done",
          conversationId: conv.id,
          reply,
          products,
          quote: quote.items,
          checkoutDone: quote.checkout_done,
          title,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : "Unknown error";
        send({ type: "error", error: `Agent failed: ${m}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
