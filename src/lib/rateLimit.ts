// /src/lib/rateLimit.ts
// Path: src/lib/rateLimit.ts

const RL_KEY = "toast_rate_limited_until"; // epoch ms
const LOCK_KEY = "menu_singleflight_lock"; // value: epoch ms deadline

const MIN_TTL = 60; // Workers KV minimum TTL is 60 seconds

export async function getRateLimitedUntil(kv: KVNamespace): Promise<number> {
  const v = await kv.get(RL_KEY);
  return v ? Number(v) : 0;
}

export async function setRateLimited(kv: KVNamespace, seconds: number): Promise<void> {
  const ttl = Math.max(MIN_TTL, Math.ceil(seconds + 5));
  const until = Date.now() + ttl * 1000;
  await kv.put(RL_KEY, String(until), { expirationTtl: ttl });
}

export async function acquireSingleFlight(kv: KVNamespace, ttlSec = MIN_TTL): Promise<boolean> {
  // Best-effort single-flight: if key exists, someone else is fetching
  const existing = await kv.get(LOCK_KEY);
  if (existing) return false;
  const ttl = Math.max(MIN_TTL, ttlSec);
  await kv.put(LOCK_KEY, String(Date.now() + ttl * 1000), { expirationTtl: ttl });
  return true;
}

export async function releaseSingleFlight(kv: KVNamespace): Promise<void> {
  await kv.delete(LOCK_KEY);
}
