import { getSessionUser } from "@/lib/supabase/server";
import ChatClient from "./ChatClient";

// middleware.ts already redirects logged-out requests to /login before this
// ever renders, so `user` should always be set here — this is just a
// friendly fallback rather than a second auth gate.
export default async function Home() {
  const user = await getSessionUser();
  return <ChatClient userEmail={user?.email ?? "signed in"} />;
}
