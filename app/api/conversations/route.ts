import { listConversations } from "@/lib/supabase";

export const runtime = "nodejs";

// List a client's past conversations (the "memory" sidebar).
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId")?.trim();
  if (!clientId) {
    return Response.json({ error: "clientId query param is required" }, { status: 400 });
  }
  try {
    const conversations = await listConversations(clientId);
    return Response.json({ conversations });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: m }, { status: 500 });
  }
}
