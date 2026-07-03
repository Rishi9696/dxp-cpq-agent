// Simulated catalog — stands in for the genesis getCatalogProducts / getAvailableConfiguration.
// Configurable products carry option groups (like Salesforce itemTypes/options) and
// attributes (like line attributes). Non-configurable products are added directly.

export type CatalogOption = { id: string; name: string; price_delta: number };
export type OptionGroup = {
  group: string;
  label: string;
  min: number;
  max: number;
  options: CatalogOption[];
};
export type CatalogAttribute = { name: string; label: string; choices: string[] };

export type Product = {
  id: string;
  name: string;
  description: string;
  base_price: number;
  configurable: boolean;
  option_groups?: OptionGroup[];
  attributes?: CatalogAttribute[];
};

export const PRODUCTS: Product[] = [
  {
    id: "macbook-pro",
    name: "MacBook Pro 14”",
    description:
      "Powerful laptop with the M-series chip for coding, video editing, and heavy multitasking.",
    base_price: 1999,
    configurable: true,
    option_groups: [
      {
        group: "memory",
        label: "Memory",
        min: 1,
        max: 1,
        options: [
          { id: "ram-16", name: "16GB RAM", price_delta: 0 },
          { id: "ram-32", name: "32GB RAM", price_delta: 400 },
          { id: "ram-64", name: "64GB RAM", price_delta: 800 },
        ],
      },
      {
        group: "storage",
        label: "Storage",
        min: 1,
        max: 1,
        options: [
          { id: "ssd-512", name: "512GB SSD", price_delta: 0 },
          { id: "ssd-1tb", name: "1TB SSD", price_delta: 200 },
          { id: "ssd-2tb", name: "2TB SSD", price_delta: 600 },
        ],
      },
    ],
    attributes: [
      { name: "color", label: "Color", choices: ["Space Black", "Silver"] },
    ],
  },
  {
    id: "city-bicycle",
    name: "City Commuter Bicycle",
    description:
      "Lightweight bike for commuting to work without a car. Comfortable, eco-friendly, easy to park.",
    base_price: 450,
    configurable: true,
    option_groups: [
      {
        group: "accessories",
        label: "Accessories",
        min: 0,
        max: 3,
        options: [
          { id: "acc-lights", name: "LED Lights", price_delta: 25 },
          { id: "acc-lock", name: "U-Lock", price_delta: 30 },
          { id: "acc-basket", name: "Front Basket", price_delta: 40 },
        ],
      },
    ],
    attributes: [
      { name: "frame_size", label: "Frame size", choices: ["S", "M", "L"] },
      { name: "color", label: "Color", choices: ["Black", "Blue", "Red"] },
    ],
  },
  {
    id: "running-shoes",
    name: "Running Shoes",
    description:
      "Cushioned athletic shoes for jogging, running, and the gym. Breathable and lightweight.",
    base_price: 120,
    configurable: true,
    attributes: [
      { name: "size", label: "Size (US)", choices: ["8", "9", "10", "11", "12"] },
      { name: "color", label: "Color", choices: ["Black", "White", "Neon"] },
    ],
  },
  {
    id: "graphite-pencil",
    name: "Graphite Pencil (Pack of 12)",
    description: "Classic wooden pencils for writing, sketching, and taking notes.",
    base_price: 8,
    configurable: false,
  },
  {
    id: "notebook",
    name: "A5 Hardcover Notebook",
    description: "Dotted hardcover notebook for journaling, writing notes, and sketching ideas.",
    base_price: 15,
    configurable: false,
  },
  {
    id: "novel-book",
    name: "Bestselling Novel",
    description: "An award-winning paperback novel — a great gift and a relaxing weekend read.",
    base_price: 18,
    configurable: false,
  },
  {
    id: "laptop-backpack",
    name: "Laptop Backpack",
    description:
      "Durable backpack with a padded sleeve to carry a laptop, books, and daily essentials.",
    base_price: 70,
    configurable: false,
  },
  {
    id: "water-bottle",
    name: "Insulated Water Bottle",
    description: "Stainless steel bottle that keeps drinks cold for 24 hours.",
    base_price: 30,
    configurable: false,
  },
  {
    id: "wireless-headphones",
    name: "Wireless Noise-Cancelling Headphones",
    description: "Over-ear Bluetooth headphones with noise cancellation for music, calls, and focus.",
    base_price: 250,
    configurable: false,
  },
  {
    id: "desk-lamp",
    name: "LED Desk Lamp",
    description: "Adjustable desk lamp with warm and cool light modes for reading and studying.",
    base_price: 45,
    configurable: false,
  },
];

export function getProduct(productId: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === productId);
}

/**
 * Simulated getCatalogProducts. Case-insensitive term match on name+description;
 * falls back to the whole catalog so the agent always has something to reason about.
 * Returns lightweight rows including the is-configurable flag.
 */
export function searchProducts(query: string) {
  const q = (query ?? "").trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const pool =
    terms.length === 0
      ? PRODUCTS
      : PRODUCTS.filter((p) => {
          const hay = `${p.name} ${p.description}`.toLowerCase();
          return terms.some((t) => hay.includes(t));
        });
  const results = (pool.length > 0 ? pool : PRODUCTS).map((p) => ({
    product_id: p.id,
    name: p.name,
    description: p.description,
    base_price: p.base_price,
    is_configurable: p.configurable,
  }));
  return results;
}

/** Simulated getAvailableConfiguration — the option/attribute schema for one product. */
export function getConfiguration(productId: string) {
  const p = getProduct(productId);
  if (!p) return { error: `Unknown product_id: ${productId}` };
  return {
    product_id: p.id,
    product_name: p.name,
    base_price: p.base_price,
    is_configurable: p.configurable,
    option_groups: p.option_groups ?? [],
    attributes: p.attributes ?? [],
  };
}

/** Resolve selected option ids to option objects + compute the unit price. */
export function buildLineItem(
  productId: string,
  selectedOptionIds: string[] = []
): { name: string; unit_price: number; options: CatalogOption[]; configured: boolean } | null {
  const p = getProduct(productId);
  if (!p) return null;
  const allOptions = (p.option_groups ?? []).flatMap((g) => g.options);
  const options = selectedOptionIds
    .map((id) => allOptions.find((o) => o.id === id))
    .filter((o): o is CatalogOption => Boolean(o));
  const unit_price = p.base_price + options.reduce((s, o) => s + o.price_delta, 0);
  return { name: p.name, unit_price, options, configured: p.configurable };
}
