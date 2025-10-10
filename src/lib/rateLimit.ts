// /src/lib/rateLimit.ts
// Path: src/lib/rateLimit.ts

/** Simple KV-backed rate-limit cool-down + single-flight helpers. */

const RL_KEY = "toast_rl_until_ms";
const SF_KEY = "toast_single_flight_menu";
const MIN_TTL = 60;

/** Set a cool-down window based on seconds (from now) with a tiny jitter to avoid thundering herds. */
export async function setRateLimited(kv: KVNamespace, retryAfterSeconds: number): Promise<void> {
  // cap excessive Retry-After; add 0–2s jitter
  const base = Math.max(5, Math.min(retryAfterSeconds || 10, 60));
  const jitter = Math.floor(Math.random() * 3);
  const until = Date.now() + (base + jitter) * 1000;
  await kv.put(RL_KEY, String(until), { expirationTtl: Math.max(MIN_TTL, base + 5) });
}

/** Read the current 'retry after' deadline (ms epoch) if set. */
export async function getRateLimitedUntil(kv: KVNamespace): Promise<number | null> {
  const raw = await kv.get(RL_KEY);
  return raw ? Number(raw) : null;
}

/** Clear the cool-down (owner-only use). */
export async function clearRateLimited(kv: KVNamespace): Promise<void> {
  await kv.delete(RL_KEY);
}

/** Acquire a coarse single-flight lock (returns true iff you hold the lock). */
export async function acquireSingleFlight(kv: KVNamespace, ttlSec = 60): Promise<boolean> {
  const existing = await kv.get(SF_KEY);
  if (existing) return false;
  await kv.put(SF_KEY, String(Date.now()), { expirationTtl: Math.max(MIN_TTL, ttlSec) });
  return true;
}

/** Release single-flight lock. */
export async function releaseSingleFlight(kv: KVNamespace): Promise<void> {
  await kv.delete(SF_KEY);
}
