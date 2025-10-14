// /src/lib/pacer.ts
// Path: src/lib/pacer.ts
// Purpose: lightweight per-scope pacing to avoid Toast per-second limits.
// Notes:
// - Uses in-memory state (per isolate). Good enough for our current usage.
// - Honors Retry-After when provided.
// - Adds tiny jitter to reduce thundering herd in multi-request bursts.

type Scope = "global" | "menu" | "orders";

const lastCallAt = new Map<Scope, number>();

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Pace a Toast API call:
 * - If `retryAfterHeader` present, wait that many seconds (+ jitter).
 * - Else, ensure at least `minGapMs` since the last call for this scope.
 */
export async function pace(
  scope: Scope,
  minGapMs: number,
  retryAfterHeader?: string | null
): Promise<void> {
  // Honor Retry-After if present (seconds; may be int or HTTP date).
  if (retryAfterHeader) {
    let waitMs = 0;
    const seconds = Number(retryAfterHeader);
    if (!Number.isNaN(seconds)) {
      waitMs = Math.max(0, Math.floor(seconds * 1000));
    } else {
      const asDate = Date.parse(retryAfterHeader);
      if (!Number.isNaN(asDate)) {
        waitMs = Math.max(0, asDate - Date.now());
      }
    }
    // add small jitter (0–120ms)
    waitMs += Math.floor(Math.random() * 120);
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt.set(scope, Date.now());
    return;
  }

  const now = Date.now();
  const last = lastCallAt.get(scope) ?? 0;
  const since = now - last;
  const needed = minGapMs - since;

  if (needed > 0) {
    // add tiny jitter (0–60ms) to spread parallel calls
    await sleep(needed + Math.floor(Math.random() * 60));
  }

  lastCallAt.set(scope, Date.now());
}

/**
 * Back-compat alias used by some files.
 * Equivalent to: await pace(scope, minGapMs, retryAfterHeader)
 */
export async function paceBeforeToastCall(
  scope: Scope,
  minGapMs: number,
  retryAfterHeader?: string | null
): Promise<void> {
  return pace(scope, minGapMs, retryAfterHeader);
}
