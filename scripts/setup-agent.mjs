// One-time setup for the Managed Agents version.
// Creates an Environment + an Agent (search_products, configure_product,
// add_to_quote custom tools) and prints their IDs. Run once, then put the IDs
// in .env.local and Vercel:
//
//   node --env-file=.env.local scripts/setup-agent.mjs
//
// Re-running creates NEW resources — run it when you change the tools/prompt,
// then update DXP_AGENT_ID (and DXP_ENVIRONMENT_ID) in your env.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM = `You are an expert shopping/CPQ assistant that helps a sales rep build a quote.

Tools:
- search_products(query): find catalog products for the user's intent. Each result has an "is_configurable" flag.
- configure_product(product_id): get the available option groups and attributes for a configurable product.
- add_to_quote(product_id, quantity?, selected_option_ids?, attributes?): add a line item to the quote/cart.

Intent detection:
- EXECUTION intent (add/build the quote): "add", "include", "put on the quote", "I need", "wants", "requires", concrete requests. Default to execution when the requirement is concrete.
- DISCOVERY intent (just show options): "recommend", "suggest", "compare", "what do you have", "show me". Only show results; do NOT add anything.

Rules for execution intent (do NOT ask for confirmation when intent is clear):
- For each product: if is_configurable is true, call configure_product to see options/attributes, choose sensible selections based on the user's request (e.g. "32GB RAM" -> the matching option id), then call add_to_quote with selected_option_ids and any attributes. If is_configurable is false, call add_to_quote directly.
- After acting, briefly tell the user what you added (name the products) and the running quote.

For discovery intent: name the relevant products so they appear as cards; do not add them.
The current quote/cart is provided in brackets at the start of each user message for context. Only reference products returned by the tools — never invent products.`;

const TOOLS = [
  {
    type: "custom",
    name: "search_products",
    description:
      "Search the product catalog for items relevant to the user's intent. Returns products with an is_configurable flag. Call this whenever you need to find products.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords describing what the user wants, e.g. 'laptop for video editing'",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "custom",
    name: "configure_product",
    description:
      "Get the available option groups and attributes for a configurable product, so you can choose selections before adding it to the quote.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The product_id from search_products" },
      },
      required: ["product_id"],
    },
  },
  {
    type: "custom",
    name: "add_to_quote",
    description:
      "Add a product to the quote/cart. For configurable products, pass the chosen selected_option_ids (from configure_product) and any attributes.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The product_id to add" },
        quantity: { type: "integer", description: "Quantity (default 1)" },
        selected_option_ids: {
          type: "array",
          items: { type: "string" },
          description: "Chosen option ids from configure_product (configurable products only)",
        },
        attributes: {
          type: "object",
          description: "Attribute name -> value, e.g. { \"color\": \"Space Black\" }",
          additionalProperties: true,
        },
      },
      required: ["product_id"],
    },
  },
];

async function main() {
  const environment = await client.beta.environments.create({
    name: `dxp-poc-env-${Math.floor(Number(process.env.STAMP) || 2)}`,
    config: { type: "cloud", networking: { type: "unrestricted" } },
  });
  console.log("Environment created:", environment.id);

  const agent = await client.beta.agents.create({
    name: "DXP CPQ Agent",
    model: "claude-opus-4-8",
    system: SYSTEM,
    tools: TOOLS,
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
