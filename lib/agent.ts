import Anthropic from "@anthropic-ai/sdk";
import {
  PRODUCTS,
  searchProducts,
  getConfiguration,
  type OptionGroup,
  type CatalogAttribute,
} from "./catalog";
import { getQuote, type QuoteItem } from "./supabase";
import { addToQuote, removeFromQuote } from "./quote";

// Anthropic Managed Agents. The Agent (model, system prompt, custom tools) and
// the Environment are created once by scripts/setup-agent.mjs. Here we create/
// reuse a Session, stream events, answer the custom tools (search_products,
// configure_product, add_to_quote, remove_from_quote), and read the final message.
const client = new Anthropic();

export type Card = {
  id: string;
  name: string;
  description: string;
  base_price: number;
  configurable: boolean;
  option_groups?: OptionGroup[];
  attributes?: CatalogAttribute[];
};
export type TurnResult = { reply: string; products: Card[] };

/** Products the agent's reply mentioned by name — with full pricing + config info for the UI. */
function matchProducts(replyLower: string): Card[] {
  return PRODUCTS.filter((p) => replyLower.includes(p.name.toLowerCase())).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    base_price: p.base_price,
    configurable: p.configurable,
    option_groups: p.option_groups,
    attributes: p.attributes,
  }));
}

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

/** Create a fresh Managed Agents session and return its id. */
export async function createSession(): Promise<string> {
  const { agentId, environmentId } = requireIds();
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: "DXP product chat",
  });
  return session.id;
}

// Execute a custom tool call client-side. All quote items live in quotes.items.
// Cart mutations go through lib/quote.ts — the same code path the UI uses.
async function runTool(
  name: string,
  input: Record<string, unknown>,
  conversationId: string
): Promise<string> {
  if (name === "search_products") {
    return JSON.stringify(searchProducts(String(input.query ?? "")));
  }
  if (name === "configure_product") {
    return JSON.stringify(getConfiguration(String(input.product_id ?? "")));
  }

  if (name === "add_to_quote") {
    const productId = String(input.product_id ?? "");
    const quantity = Math.max(1, Number(input.quantity ?? 1) || 1);
    const optionIds = Array.isArray(input.selected_option_ids)
      ? (input.selected_option_ids as unknown[]).map(String)
      : [];
    const attributes =
      input.attributes && typeof input.attributes === "object"
        ? (input.attributes as Record<string, unknown>)
        : {};
    const result = await addToQuote(conversationId, productId, quantity, optionIds, attributes);
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify({ added: result.added, quote: result.items });
  }

  if (name === "remove_from_quote") {
    const lineId = input.line_id != null ? String(input.line_id) : undefined;
    const productId = input.product_id ? String(input.product_id) : undefined;
    const result = await removeFromQuote(conversationId, { lineId, productId });
    if (!result.ok) return JSON.stringify({ error: result.error });
    return JSON.stringify({ removed_count: result.removed_count, quote: result.items });
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

/**
 * Run one user turn on an existing session, scoped to a conversation's quote.
 * Injects the current quote (and lock state) as context, streams events,
 * answers custom tools inline, and returns the final agent text + product cards.
 */
export async function runAgentTurn(
  sessionId: string,
  userText: string,
  conversationId: string
): Promise<TurnResult> {
  const quote = await getQuote(conversationId);
  let quoteContext: string;
  if (quote.checkout_done) {
    quoteContext =
      "This quote has already been CHECKED OUT and is locked — do NOT add or remove products. Tell the user to start a New chat to build a new quote.";
  } else if (quote.items.length) {
    quoteContext =
      "Current quote/cart:\n" +
      quote.items
        .map(
          (it: QuoteItem) =>
            `- [line_id ${it.line_id}] ${it.quantity}x ${it.product_name} — $${it.unit_price}${
              it.configured ? " (configured)" : ""
            }`
        )
        .join("\n");
  } else {
    quoteContext = "The quote/cart is currently empty.";
  }

  let reply = "";
  let toolUses = 0;

  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [
      { type: "user.message", content: [{ type: "text", text: `[${quoteContext}]\n\nUser: ${userText}` }] },
    ],
  });

  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content) {
        if (block.type === "text") reply += block.text;
      }
    } else if (event.type === "agent.custom_tool_use") {
      reply = "";
      if (++toolUses > 12) break;
      // Always answer the tool call — an unanswered one leaves the session
      // stuck in requires_action and hangs the next turn.
      const result = await runTool(
        event.name,
        (event.input as Record<string, unknown>) ?? {},
        conversationId
      ).catch((e: unknown) =>
        JSON.stringify({ error: e instanceof Error ? e.message : "Tool execution failed" })
      );
      await client.beta.sessions.events.send(sessionId, {
        events: [
          { type: "user.custom_tool_result", custom_tool_use_id: event.id, content: [{ type: "text", text: result }] },
        ],
      });
    } else if (event.type === "session.error") {
      throw new Error("Session error: " + JSON.stringify((event as { error?: unknown }).error ?? event));
    } else if (event.type === "session.status_idle") {
      const reason = (event as { stop_reason?: { type?: string } }).stop_reason;
      if (reason?.type !== "requires_action") break;
    } else if (event.type === "session.status_terminated") {
      break;
    }
  }

  const replyLower = reply.toLowerCase();
  const products: Card[] = matchProducts(replyLower);
  return { reply: reply.trim(), products };
}

const TOOL_STATUS: Record<string, string> = {
  search_products: "Searching the catalog…",
  configure_product: "Checking configuration options…",
  add_to_quote: "Adding to your quote…",
  remove_from_quote: "Updating your quote…",
};

export type StreamEvent =
  | { type: "status"; text: string }
  | { type: "reset" }
  | { type: "text"; text: string };

/**
 * Streaming variant: same turn as runAgentTurn, but invokes `onEvent` as the
 * managed instance emits events — tool-activity status and message text — so
 * the UI can show progress live. Returns the final reply + product cards.
 */
export async function runAgentTurnStreaming(
  sessionId: string,
  userText: string,
  conversationId: string,
  onEvent: (e: StreamEvent) => void
): Promise<TurnResult> {
  const quote = await getQuote(conversationId);
  let quoteContext: string;
  if (quote.checkout_done) {
    quoteContext =
      "This quote has already been CHECKED OUT and is locked — do NOT add or remove products. Tell the user to start a New chat to build a new quote.";
  } else if (quote.items.length) {
    quoteContext =
      "Current quote/cart:\n" +
      quote.items
        .map(
          (it: QuoteItem) =>
            `- [line_id ${it.line_id}] ${it.quantity}x ${it.product_name} — $${it.unit_price}${
              it.configured ? " (configured)" : ""
            }`
        )
        .join("\n");
  } else {
    quoteContext = "The quote/cart is currently empty.";
  }

  let reply = "";
  let toolUses = 0;

  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [
      { type: "user.message", content: [{ type: "text", text: `[${quoteContext}]\n\nUser: ${userText}` }] },
    ],
  });

  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content) {
        if (block.type === "text") {
          reply += block.text;
          onEvent({ type: "text", text: block.text });
        }
      }
    } else if (event.type === "agent.custom_tool_use") {
      // A tool call means any streamed text so far was preamble — clear it,
      // show what the agent is doing, then run the tool.
      reply = "";
      onEvent({ type: "reset" });
      onEvent({ type: "status", text: TOOL_STATUS[event.name] ?? "Working…" });
      if (++toolUses > 12) break;
      // Always answer the tool call — an unanswered one leaves the session
      // stuck in requires_action and hangs the next turn.
      const result = await runTool(
        event.name,
        (event.input as Record<string, unknown>) ?? {},
        conversationId
      ).catch((e: unknown) =>
        JSON.stringify({ error: e instanceof Error ? e.message : "Tool execution failed" })
      );
      await client.beta.sessions.events.send(sessionId, {
        events: [
          { type: "user.custom_tool_result", custom_tool_use_id: event.id, content: [{ type: "text", text: result }] },
        ],
      });
    } else if (event.type === "session.error") {
      throw new Error("Session error: " + JSON.stringify((event as { error?: unknown }).error ?? event));
    } else if (event.type === "session.status_idle") {
      const reason = (event as { stop_reason?: { type?: string } }).stop_reason;
      if (reason?.type !== "requires_action") break;
    } else if (event.type === "session.status_terminated") {
      break;
    }
  }

  const replyLower = reply.toLowerCase();
  const products: Card[] = matchProducts(replyLower);
  return { reply: reply.trim(), products };
}

/**
 * Generate a short chat title from the first exchange (auto-rename based on
 * the conversation). Uses a small, fast model; failure is non-fatal.
 */
export async function generateTitle(userText: string, reply: string): Promise<string | null> {
  try {
    const r = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 24,
      system:
        "Write a 3-5 word title summarizing this shopping conversation. Reply with ONLY the title — no quotes, no trailing punctuation.",
      messages: [{ role: "user", content: `User: ${userText}\nAssistant: ${reply}` }],
    });
    const t = r.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim()
      .replace(/^["']|["']$/g, "");
    return t || null;
  } catch {
    return null;
  }
}
