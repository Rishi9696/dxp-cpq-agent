// Minimal in-memory rate limiter (fixed window). Good enough to blunt casual
// abuse/brute-forcing on a single-instance deploy, but it does NOT share state
// across serverless invocations/regions — on Vercel, each warm lambda instance
// tracks its own counters. For real multi-instance production traffic, swap
// this for a shared store (Upstash Redis / Vercel KV) behind the same
// `checkRateLimit` signature; callers don't need to change.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Periodically drop expired buckets so this doesn't grow unbounded.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Fixed-window rate limit. `key` should identify the caller (user id, IP,
 * or a combination), `limit` is the max requests allowed per `windowMs`.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true };
}

/** Best-effort client IP from standard proxy headers (Vercel sets x-forwarded-for). */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
