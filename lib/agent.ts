import Anthropic from "@anthropic-ai/sdk";
import { PRODUCTS, searchProducts, getConfiguration, buildLineItem } from "./catalog";
import { addLineItem, getLineItems, removeLineItem } from "./supabase";

// Anthropic Managed Agents. The Agent (model, system prompt, custom tools) and
// the Environment are created once by scripts/setup-agent.mjs. Here we create/
// reuse a Session, stream events, answer the custom tools (search_products,
// configure_product, add_to_quote), and read the final agent message.
const client = new Anthropic();

export type Card = { id: string; name: string; description: string };
export type TurnResult = { reply: string; products: Card[] };

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

// Execute a custom tool call client-side. Returns the JSON string result.
async function runTool(
  name: string,
  input: Record<string, unknown>,
  quoteId: string
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
    const li = buildLineItem(productId, optionIds);
    if (!li) return JSON.stringify({ error: `Unknown product_id: ${productId}` });
    await addLineItem(quoteId, {
      product_id: productId,
      product_name: li.name,
      quantity,
      unit_price: li.unit_price,
      configured: li.configured,
      options: li.options,
      attributes,
    });
    const quote = await getLineItems(quoteId);
    return JSON.stringify({ added: li.name, quote });
  }
  if (name === "remove_from_quote") {
    const lineItemId =
      input.line_item_id != null ? Number(input.line_item_id) : undefined;
    const productId = input.product_id ? String(input.product_id) : undefined;
    const removed = await removeLineItem(quoteId, { lineItemId, productId });
    const quote = await getLineItems(quoteId);
    return JSON.stringify({ removed_count: removed, quote });
  }
  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

/**
 * Run one user turn on an existing session, scoped to a quote. Injects the
 * current quote as context (like the genesis quote_markdown), streams events,
 * answers custom tools inline, and returns the final agent text + product cards.
 */
export async function runAgentTurn(
  sessionId: string,
  userText: string,
  quoteId: string
): Promise<TurnResult> {
  // Inject current quote state so the agent knows what's already in the cart.
  const items = await getLineItems(quoteId);
  const quoteContext = items.length
    ? "Current quote/cart:\n" +
      items
        .map(
          (li) =>
            `- [line_item_id ${li.id}] ${li.quantity}x ${li.product_name} — $${li.unit_price}${
              li.configured ? " (configured)" : ""
            }`
        )
        .join("\n")
    : "The quote/cart is currently empty.";

  let reply = "";
  let toolUses = 0;

  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: `[${quoteContext}]\n\nUser: ${userText}` }],
      },
    ],
  });

  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content) {
        if (block.type === "text") reply += block.text;
      }
    } else if (event.type === "agent.custom_tool_use") {
      reply = ""; // keep only the final message emitted after the last tool result
      if (++toolUses > 12) break; // safety against loops
      const result = await runTool(
        event.name,
        (event.input as Record<string, unknown>) ?? {},
        quoteId
      );
      await client.beta.sessions.events.send(sessionId, {
        events: [
          {
            type: "user.custom_tool_result",
            custom_tool_use_id: event.id,
            content: [{ type: "text", text: result }],
          },
        ],
      });
    } else if (event.type === "session.error") {
      throw new Error(
        "Session error: " + JSON.stringify((event as { error?: unknown }).error ?? event)
      );
    } else if (event.type === "session.status_idle") {
      const reason = (event as { stop_reason?: { type?: string } }).stop_reason;
      if (reason?.type !== "requires_action") break;
    } else if (event.type === "session.status_terminated") {
      break;
    }
  }

  // Cards = catalog products the agent named in its reply.
  const replyLower = reply.toLowerCase();
  const products: Card[] = PRODUCTS.filter((p) =>
    replyLower.includes(p.name.toLowerCase())
  ).map((p) => ({ id: p.id, name: p.name, description: p.description }));

  return { reply: reply.trim(), products };
}
