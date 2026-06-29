// One-time setup for the Managed Agents version.
// Creates an Environment + an Agent (with the search_products custom tool) and
// prints their IDs. Run once, then put the IDs in .env.local and Vercel:
//
//   node --env-file=.env.local scripts/setup-agent.mjs
//
// Re-running creates NEW resources — only run when you need fresh IDs.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM = `You are a friendly shopping assistant for a small store.
When the user describes what they need, call the search_products tool to find
relevant items, then recommend the best 1-3 products and briefly explain why
each fits. Keep replies short and conversational. Only recommend products
returned by the tool — never invent products.`;

async function main() {
  const environment = await client.beta.environments.create({
    name: `dxp-poc-env-${Math.floor(Number(process.env.STAMP) || 1)}`,
    config: { type: "cloud", networking: { type: "unrestricted" } },
  });
  console.log("Environment created:", environment.id);

  const agent = await client.beta.agents.create({
    name: "DXP Product Recommender",
    model: "claude-opus-4-8",
    system: SYSTEM,
    tools: [
      {
        type: "custom",
        name: "search_products",
        description:
          "Search the product catalog for items relevant to the user's intent. Call this whenever you need to find products to recommend.",
        input_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Keywords describing what the user wants, e.g. 'commute to work' or 'write notes'",
            },
          },
          required: ["query"],
        },
      },
    ],
  });
  console.log("Agent created:", agent.id, "version:", agent.version);

  console.log("\n--- Add these to .env.local and Vercel env vars ---");
  console.log(`DXP_AGENT_ID=${agent.id}`);
  console.log(`DXP_ENVIRONMENT_ID=${environment.id}`);
}

main().catch((e) => {
  console.error("Setup failed:", e?.status, e?.message);
  process.exit(1);
});
