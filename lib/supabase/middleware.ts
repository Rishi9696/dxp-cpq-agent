import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

// Paths a logged-in-but-not-yet-MFA-verified (AAL1) user may reach.
function isMfaPath(pathname: string): boolean {
  return (
    pathname === "/mfa" ||
    pathname.startsWith("/api/auth/mfa") ||
    pathname === "/api/auth/logout"
  );
}

/**
 * Refreshes the Supabase session cookie on every request and gates every
 * non-public route behind login. Runs before any page/API route, so
 * app/api/* handlers can trust that a logged-out request never reaches them.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail closed rather than silently letting unauthenticated traffic through.
    return NextResponse.json(
      { error: "SUPABASE_URL / SUPABASE_ANON_KEY are not set on the server." },
      { status: 500 }
    );
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // getUser() may have rotated the refresh token — any redirect we return must
  // carry the refreshed cookies or the session gets silently invalidated.
  const redirectWithCookies = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!data.user && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return redirectWithCookies(loginUrl);
  }

  if (data.user && pathname === "/login") {
    return redirectWithCookies(new URL("/", request.url));
  }

  // Enforce MFA (TOTP / Google Authenticator): every logged-in user must have a
  // verified factor AND an AAL2 session before touching anything but /mfa.
  if (data.user && !isPublicPath(pathname) && !isMfaPath(pathname)) {
    const hasVerifiedFactor = (data.user.factors ?? []).some((f) => f.status === "verified");
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsMfa = !hasVerifiedFactor || aal?.currentLevel !== "aal2";
    if (needsMfa) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "MFA required" }, { status: 401 });
      }
      const mfaUrl = new URL("/mfa", request.url);
      mfaUrl.searchParams.set("next", pathname);
      return redirectWithCookies(mfaUrl);
    }
  }

  // Fully authenticated users don't need the /mfa page.
  if (data.user && pathname === "/mfa") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const hasVerifiedFactor = (data.user.factors ?? []).some((f) => f.status === "verified");
    if (hasVerifiedFactor && aal?.currentLevel === "aal2") {
      return redirectWithCookies(new URL("/", request.url));
    }
  }

  return response;
}
