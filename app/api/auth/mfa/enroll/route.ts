import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Start TOTP enrollment (Google Authenticator). Returns a QR code + secret to
// scan; the factor becomes active once /api/auth/mfa/verify confirms a code.
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { data: factors } = await supabase.auth.mfa.listFactors();

  // Already enrolled — don't stack extra factors; verification is the only path.
  if ((factors?.totp ?? []).some((f) => f.status === "verified")) {
    return Response.json({ error: "MFA is already set up for this account." }, { status: 400 });
  }

  // Clear out stale unverified factors from abandoned enrollment attempts.
  for (const f of factors?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${Date.now()}`,
  });
  if (error || !data) {
    return Response.json({ error: error?.message ?? "Enrollment failed" }, { status: 500 });
  }
  return Response.json({
    factorId: data.id,
    qrCode: data.totp.qr_code, // SVG data URI — usable directly as <img src>
    secret: data.totp.secret,
    uri: data.totp.uri,
  });
}
