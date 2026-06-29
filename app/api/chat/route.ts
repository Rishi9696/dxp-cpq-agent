import { chat } from "@/lib/agent";

// Managed Agents flow can take a while (session provisioning + agent loop), so
// run on the Node runtime with a generous duration.
export const runtime = "nodejs";
export const maxDuration = 300;

// Backend: drives one turn of the Managed Agents session. The API key and
// agent/environment IDs stay server-side.
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 }
    );
  }
  if (!process.env.DXP_AGENT_ID || !process.env.DXP_ENVIRONMENT_ID) {
    return Response.json(
      {
        error:
          "DXP_AGENT_ID / DXP_ENVIRONMENT_ID are not set. Run scripts/setup-agent.mjs and add them as env vars.",
      },
      { status: 500 }
    );
  }

  let message: string;
  let sessionId: string | undefined;
  try {
    const body = await req.json();
    message = String(body?.message ?? "").trim();
    sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;
    if (!message) throw new Error("message is required");
  } catch {
    return Response.json(
      { error: "Invalid request body. Expected { message, sessionId? }." },
      { status: 400 }
    );
  }

  try {
    const result = await chat(message, sessionId);
    return Response.json(result);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Agent failed: ${m}` }, { status: 500 });
  }
}
