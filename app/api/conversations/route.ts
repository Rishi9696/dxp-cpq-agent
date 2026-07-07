import { listConversations } from "@/lib/supabase";
import { requireSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// List the signed-in user's past conversations (the "memory" sidebar).
export async function GET() {
  const user = await requireSessionUser().catch(() => null);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const conversations = await listConversations(user.id);
    return Response.json({ conversations });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: m }, { status: 500 });
  }
}
