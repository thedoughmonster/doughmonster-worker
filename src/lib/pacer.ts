// /src/lib/pacer.ts
// Path: src/lib/pacer.ts

/**
 * Scoped upstream pacing for Toast calls.
 * - Each `scope` has its own lock and "last call at" timestamp.
 * - Use scope "menus" to enforce 1 rps for the /menus endpoint.
 * - Use scope "global" (default) for everything else.
 */

const MIN_TTL = 60;

function lockKey(scope: string) {
  return `toast_pacer_lock_${scope}`;
}
function lastKey(scope: string) {
  return `toast_pacer_last_${scope}`;
}

async function acquireLock(kv: KVNamespace, scope: string, ttlSec = MIN_TTL): Promise<boolean> {
  const key = lockKey(scope);
  const existing = await kv.get(key);
  if (existing) return false;
  const ttl = Math.max(MIN_TTL, ttlSec);
  await kv.put(key, String(Date.now() + ttl * 1000), { expirationTtl: ttl });
  return true;
}

async function releaseLock(kv: KVNamespace, scope: string): Promise<void> {
  await kv.delete(lockKey(scope));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ensures at least `minGapMs` has elapsed since the last Toast call in this scope.
 * Call this RIGHT BEFORE any upstream Toast fetch.
 */
export async function paceBeforeToastCall(
  kv: KVNamespace,
  minGapMs = 600,
  scope = "global"
): Promise<void> {
  // Try to coordinate pacing decisions per-scope
  const iHold = await acquireLock(kv, scope, 60);
  if (!iHold) {
    // Someone else is pacing this scope; wait a touch and let them handle spacing.
    await sleep(200);
    return;
  }

  try {
    const key = lastKey(scope);
    const now = Date.now();
    const last = Number((await kv.get(key)) || "0");
    const elapsed = now - last;

    if (last > 0 && elapsed < minGapMs) {
      await sleep(minGapMs - elapsed);
    }

    // Mark this scope's latest call
    await kv.put(key, String(Date.now()), { expirationTtl: 24 * 60 * 60 });
  } finally {
    await releaseLock(kv, scope);
  }
}
