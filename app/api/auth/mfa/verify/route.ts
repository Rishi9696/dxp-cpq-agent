import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Verify a 6-digit TOTP code. Used both to complete enrollment and to step the
// session up to AAL2 on each login. On success the session cookie is upgraded.
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  let factorId: string;
  let code: string;
  try {
    const body = await req.json();
    factorId = String(body?.factorId ?? "");
    code = String(body?.code ?? "").replace(/\s/g, "");
    if (!factorId || !/^\d{6}$/.test(code)) throw new Error("factorId and a 6-digit code are required");
  } catch (e) {
    const m = e instanceof Error ? e.message : "bad body";
    return Response.json({ error: m }, { status: 400 });
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) {
    return Response.json({ error: challengeError?.message ?? "Challenge failed" }, { status: 500 });
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) {
    return Response.json({ error: "Invalid code. Check your authenticator app and try again." }, { status: 401 });
  }
  return Response.json({ ok: true });
}
