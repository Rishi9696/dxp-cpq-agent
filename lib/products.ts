// The "database": a tiny in-repo product catalog. Swap for a real DB later.
export type Product = {
  id: string;
  name: string;
  description: string;
};

export const PRODUCTS: Product[] = [
  {
    id: "macbook-pro",
    name: "MacBook Pro 14”",
    description:
      "Powerful laptop with the M-series chip for coding, video editing, and heavy multitasking. Great for professionals and developers.",
  },
  {
    id: "city-bicycle",
    name: "City Commuter Bicycle",
    description:
      "Lightweight bike for commuting to work without a car. Comfortable, eco-friendly, and easy to park.",
  },
  {
    id: "graphite-pencil",
    name: "Graphite Pencil (Pack of 12)",
    description:
      "Classic wooden pencils for writing, sketching, and taking notes. Cheap and reliable.",
  },
  {
    id: "notebook",
    name: "A5 Hardcover Notebook",
    description:
      "Dotted hardcover notebook for journaling, writing notes, and sketching ideas on the go.",
  },
  {
    id: "novel-book",
    name: "Bestselling Novel",
    description:
      "An award-winning paperback novel — a great gift and a relaxing read for the weekend.",
  },
  {
    id: "running-shoes",
    name: "Running Shoes",
    description:
      "Cushioned athletic shoes for jogging, running, and the gym. Breathable and lightweight.",
  },
  {
    id: "laptop-backpack",
    name: "Laptop Backpack",
    description:
      "Durable backpack with a padded sleeve to carry a laptop, books, and daily essentials. Good for commuting and travel.",
  },
  {
    id: "water-bottle",
    name: "Insulated Water Bottle",
    description:
      "Stainless steel bottle that keeps drinks cold for 24 hours. Perfect for the gym, hiking, and the office.",
  },
  {
    id: "wireless-headphones",
    name: "Wireless Noise-Cancelling Headphones",
    description:
      "Over-ear Bluetooth headphones with noise cancellation for music, calls, and focused work.",
  },
  {
    id: "desk-lamp",
    name: "LED Desk Lamp",
    description:
      "Adjustable desk lamp with warm and cool light modes for reading, studying, and working at night.",
  },
];

/**
 * Pure, synchronous catalog search. Case-insensitive substring match on the
 * product name + description. Falls back to the whole catalog when nothing
 * matches, so Claude always has something to reason about.
 */
export function searchProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return PRODUCTS;

  const terms = q.split(/\s+/);
  const matches = PRODUCTS.filter((p) => {
    const haystack = `${p.name} ${p.description}`.toLowerCase();
    return terms.some((t) => haystack.includes(t));
  });

  return matches.length > 0 ? matches : PRODUCTS;
}
