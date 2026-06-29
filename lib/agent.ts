import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { Product, searchProducts } from "./products";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are a friendly shopping assistant for a small store.
When the user describes what they need, use the search_products tool to find
relevant items in the catalog, then recommend the best 1-3 products and briefly
explain why each fits. Keep replies short and conversational. Only recommend
products returned by the tool — never invent products.`;

/**
 * Runs the Claude-managed agent loop via the SDK Tool Runner. Claude decides
 * when to call search_products; the SDK executes the tool, feeds the result
 * back, and loops until Claude produces a final answer.
 */
export async function recommend(
  messages: ChatMessage[]
): Promise<{ reply: string; products: Product[] }> {
  const client = new Anthropic();

  // Collect every product the agent surfaced this turn, for the UI cards.
  const found = new Map<string, Product>();

  const searchTool = betaZodTool({
    name: "search_products",
    description:
      "Search the product catalog for items relevant to the user's intent. Call this whenever you need to find products to recommend.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Keywords describing what the user wants, e.g. 'commute to work' or 'write notes'"
        ),
    }),
    run: async ({ query }) => {
      const results = searchProducts(query);
      results.forEach((p) => found.set(p.id, p));
      return JSON.stringify(results);
    },
  });

  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    system: SYSTEM,
    tools: [searchTool],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const reply = finalMessage.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // Show cards only for the products Claude actually named in its reply,
  // not every product the search surfaced.
  const replyLower = reply.toLowerCase();
  const products = [...found.values()].filter((p) =>
    replyLower.includes(p.name.toLowerCase())
  );

  return { reply, products };
}
