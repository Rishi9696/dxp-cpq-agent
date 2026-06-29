import Anthropic from "@anthropic-ai/sdk";
import { PRODUCTS, searchProducts, type Product } from "./products";

// Anthropic Managed Agents version.
// The Agent (model, system prompt, search_products custom tool) and the
// Environment are created once by scripts/setup-agent.mjs. Here we only:
//   create/reuse a Session -> stream events -> answer the custom tool ->
//   read the final agent message.
const client = new Anthropic();

export type ChatResult = {
  reply: string;
  products: Product[];
  sessionId: string;
};

function requireIds() {
  const agentId = process.env.DXP_AGENT_ID;
  const environmentId = process.env.DXP_ENVIRONMENT_ID;
  if (!agentId || !environmentId) {
    throw new Error(
      "DXP_AGENT_ID / DXP_ENVIRONMENT_ID are not set. Run scripts/setup-agent.mjs and set them as env vars."
    );
  }
  return { agentId, environmentId };
}

// Drives one user turn on an existing session: sends the user message, then
// loops (stream -> collect text + tool calls -> answer tools) until the
// session goes idle/terminated. Returns the final agent text + products shown.
async function runTurn(
  sessionId: string,
  userText: string
): Promise<{ reply: string; products: Product[] }> {
  let reply = "";
  let toolUses = 0;

  // Stream-first: open ONE stream for the whole turn, then send the user
  // message. We keep reading the same stream across tool round-trips —
  // sending tool results inline — so we never miss the final message.
  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text: userText }] }],
  });

  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content) {
        if (block.type === "text") reply += block.text;
      }
    } else if (event.type === "agent.custom_tool_use") {
      // Run the custom tool client-side and send the result on the same stream.
      const query = String((event.input as { query?: unknown })?.query ?? "");
      reply = ""; // drop interim text; keep only the final post-tool message
      if (++toolUses > 8) break; // safety against loops
      await client.beta.sessions.events.send(sessionId, {
        events: [
          {
            type: "user.custom_tool_result",
            custom_tool_use_id: event.id,
            content: [{ type: "text", text: JSON.stringify(searchProducts(query)) }],
          },
        ],
      });
    } else if (event.type === "session.error") {
      throw new Error(
        "Session error: " + JSON.stringify((event as { error?: unknown }).error ?? event)
      );
    } else if (event.type === "session.status_idle") {
      // requires_action = waiting on a tool result we're handling; keep going.
      const reason = (event as { stop_reason?: { type?: string } }).stop_reason;
      if (reason?.type !== "requires_action") break; // end_turn / retries_exhausted
    } else if (event.type === "session.status_terminated") {
      break;
    }
  }

  // Show cards for any catalog product Claude named in its reply (works even
  // when it answers a follow-up from session memory without re-searching).
  const replyLower = reply.toLowerCase();
  const products = PRODUCTS.filter((p) =>
    replyLower.includes(p.name.toLowerCase())
  );

  return { reply: reply.trim(), products };
}

/**
 * Handle one chat turn. Reuses the given session for multi-turn memory; if
 * none is given (or the existing one fails), creates a fresh session.
 */
export async function chat(
  userText: string,
  sessionId?: string
): Promise<ChatResult> {
  const { agentId, environmentId } = requireIds();

  if (sessionId) {
    try {
      const out = await runTurn(sessionId, userText);
      return { ...out, sessionId };
    } catch {
      // Fall through and start a fresh session (loses prior context).
    }
  }

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: "DXP product chat",
  });
  const out = await runTurn(session.id, userText);
  return { ...out, sessionId: session.id };
}
