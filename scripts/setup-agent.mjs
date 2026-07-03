// Setup / update for the Managed Agents version.
//   node --env-file=.env.local scripts/setup-agent.mjs
//
// - If DXP_AGENT_ID is set, the agent is UPDATED IN PLACE (same id) with the
//   current tools + prompt. If not, a new agent is created.
// - If DXP_ENVIRONMENT_ID is set, that environment is reused; otherwise a new
//   one is created.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM = `You are an expert shopping/CPQ assistant that helps a sales rep build a quote.

Tools:
- search_products(query): find catalog products. Each result has an "is_configurable" flag.
- configure_product(product_id): get the option groups and attributes for a configurable product.
- add_to_quote(product_id, quantity?, selected_option_ids?, attributes?): add a line item to the quote.
- remove_from_quote(line_item_id?, product_id?): remove a line item. Prefer line_item_id (shown in the current quote context as [line_item_id N]); fall back to product_id.

Intent detection:
- EXECUTION intent (add/remove/build the quote): "add", "include", "put on the quote", "remove", "delete", "take off", "I need", concrete requests. Default to execution when the requirement is concrete.
- DISCOVERY intent (just show options): "recommend", "suggest", "compare", "what do you have", "show me". Only show results; do NOT change the quote.

Rules for execution intent (do NOT ask for confirmation when intent is clear):
- Adding: if is_configurable is true, call configure_product, choose sensible selections from the user's request (e.g. "32GB RAM" -> the matching option id), then call add_to_quote with selected_option_ids and any attributes. If is_configurable is false, call add_to_quote directly.
- Removing: use the line_item_id from the current quote context; if the user names a product, match it to that line and remove_from_quote.
- After acting, briefly tell the user what changed and the running quote.

For discovery intent: name the relevant products so they appear as cards; do not change the quote.
The current quote/cart is provided in brackets at the start of each user message for context. Only reference products returned by the tools — never invent products.`;

const TOOLS = [
  {
    type: "custom",
    name: "search_products",
    description:
      "Search the product catalog for items relevant to the user's intent. Returns products with an is_configurable flag.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords, e.g. 'laptop for video editing'" },
      },
      required: ["query"],
    },
  },
  {
    type: "custom",
    name: "configure_product",
    description:
      "Get the available option groups and attributes for a configurable product, so you can choose selections before adding it.",
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
      "Add a product to the quote/cart. For configurable products, pass chosen selected_option_ids (from configure_product) and any attributes.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The product_id to add" },
        quantity: { type: "integer", description: "Quantity (default 1)" },
        selected_option_ids: {
          type: "array",
          items: { type: "string" },
          description: "Chosen option ids from configure_product",
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
  {
    type: "custom",
    name: "remove_from_quote",
    description:
      "Remove a line item from the quote. Prefer line_item_id (from the current quote context [line_item_id N]); otherwise pass product_id to remove matching items.",
    input_schema: {
      type: "object",
      properties: {
        line_item_id: { type: "integer", description: "The line_item_id shown in the quote context" },
        product_id: { type: "string", description: "Fallback: remove items with this product_id" },
      },
    },
  },
];

async function main() {
  // Environment: reuse if provided, else create.
  let environmentId = process.env.DXP_ENVIRONMENT_ID;
  if (environmentId) {
    console.log("Reusing environment:", environmentId);
  } else {
    const environment = await client.beta.environments.create({
      name: `dxp-poc-env-${Math.floor(Number(process.env.STAMP) || 3)}`,
      config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    environmentId = environment.id;
    console.log("Environment created:", environmentId);
  }

  // Agent: update in place if provided, else create.
  let agent;
  if (process.env.DXP_AGENT_ID) {
    const current = await client.beta.agents.retrieve(process.env.DXP_AGENT_ID);
    agent = await client.beta.agents.update(process.env.DXP_AGENT_ID, {
      version: current.version,
      system: SYSTEM,
      tools: TOOLS,
    });
    console.log("Agent UPDATED in place:", agent.id, "-> version", agent.version);
  } else {
    agent = await client.beta.agents.create({
      name: "DXP CPQ Agent",
      model: "claude-opus-4-8",
      system: SYSTEM,
      tools: TOOLS,
    });
    console.log("Agent created:", agent.id, "version:", agent.version);
  }

  console.log("\n--- Ensure these are in .env.local and Vercel env vars ---");
  console.log(`DXP_AGENT_ID=${agent.id}`);
  console.log(`DXP_ENVIRONMENT_ID=${environmentId}`);
}

main().catch((e) => {
  console.error("Setup failed:", e?.status, e?.message);
  process.exit(1);
});
