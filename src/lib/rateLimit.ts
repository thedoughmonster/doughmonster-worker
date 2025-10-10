// /src/lib/rateLimit.ts
// Path: src/lib/rateLimit.ts

const RL_KEY = "toast_rate_limited_until"; // epoch ms
const LOCK_KEY = "menu_singleflight_lock"; // value: epoch ms deadline

export async function getRateLimitedUntil(kv: KVNamespace): Promise<number> {
  const v = await kv.get(RL_KEY);
  return v ? Number(v) : 0;
}

export async function setRateLimited(kv: KVNamespace, seconds: number): Promise<void> {
  const until = Date.now() + Math.max(1, seconds) * 1000;
  // store a small TTL just over the window
  await kv.put(RL_KEY, String(until), { expirationTtl: Math.min(seconds + 5, 300) });
}

export async function acquireSingleFlight(kv: KVNamespace, ttlSec = 10): Promise<boolean> {
  // best-effort: if key exists (someone else fetching), return false
  const existing = await kv.get(LOCK_KEY);
  if (existing) return false;
  await kv.put(LOCK_KEY, String(Date.now() + ttlSec * 1000), { expirationTtl: ttlSec });
  return true;
}

export async function releaseSingleFlight(kv: KVNamespace): Promise<void> {
  // KV has no delete TTL-less here; overwrite with short-past value
  await kv.put(LOCK_KEY, "", { expirationTtl: 1 });
}
