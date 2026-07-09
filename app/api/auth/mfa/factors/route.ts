import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// What state is this user's MFA in? Drives the /mfa page (enroll vs. verify).
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const verified = (factors?.totp ?? []).find((f) => f.status === "verified");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  return Response.json({
    enrolled: Boolean(verified),
    factorId: verified?.id ?? null,
    currentLevel: aal?.currentLevel ?? null,
  });
}
