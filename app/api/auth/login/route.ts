import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Signup is closed — this only signs in users that already exist in
// Supabase Auth (created via `npm run create-user`). On success it sets the
// session cookie that middleware.ts reads on every subsequent request.
export async function POST(req: Request) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return Response.json({ error: "SUPABASE_URL / SUPABASE_ANON_KEY are not set." }, { status: 500 });
  }

  // Blunt brute-forcing: 8 attempts per IP per 5 minutes.
  const rl = checkRateLimit(`login:${getClientIp(req)}`, 8, 5 * 60_000);
  if (!rl.ok) {
    return Response.json(
      { error: "Too many login attempts. Try again in a few minutes." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  let email: string;
  let password: string;
  try {
    const body = await req.json();
    // Accept a username or an email. Bare usernames (e.g. "rishi") map to the
    // internal domain the accounts were provisioned under.
    email = String(body?.email ?? body?.username ?? "").trim().toLowerCase();
    if (email && !email.includes("@")) email = `${email}@dxp.local`;
    password = String(body?.password ?? "");
    if (!email || !password) throw new Error("username and password are required");
  } catch (e) {
    const m = e instanceof Error ? e.message : "bad body";
    return Response.json({ error: m }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return Response.json({ error: "Invalid username or password." }, { status: 401 });
  }

  // MFA is enforced: report whether the user must enroll (first login) or
  // verify a TOTP code (returning user) so the client can route to /mfa.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasVerifiedFactor = (factors?.totp ?? []).some((f) => f.status === "verified");
  return Response.json({ ok: true, mfa: hasVerifiedFactor ? "verify" : "enroll" });
}
