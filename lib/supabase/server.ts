import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";

// Session-aware Supabase client for Server Components / Route Handlers.
// Uses the anon key + the request's auth cookies — this is how we find out
// *who* is calling, as opposed to lib/supabase.ts's service_role client,
// which is how we actually read/write data once we know who they are.
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY are not set. See .env.example.");
  }
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component render — middleware already
          // refreshes the session cookie on every request, so this is safe
          // to ignore here.
        }
      },
    },
  });
}

/** The authenticated user for this request, or null if not logged in. */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

/** Same as getSessionUser but throws — for API routes that require auth. */
export async function requireSessionUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new AuthRequiredError();
  return user;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "AuthRequiredError";
  }
}
