import { PRODUCTS } from "@/lib/catalog";
import { requireSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Full catalog for the right-hand product panel (all products browsable + configurable).
export async function GET() {
  const user = await requireSessionUser().catch(() => null);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const products = PRODUCTS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    base_price: p.base_price,
    configurable: p.configurable,
    option_groups: p.option_groups ?? [],
    attributes: p.attributes ?? [],
  }));
  return Response.json({ products });
}
