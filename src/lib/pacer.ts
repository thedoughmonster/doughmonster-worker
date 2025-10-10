// /src/lib/pacer.ts
// Path: src/lib/pacer.ts

/** In-memory per-request pacing with 429 handling. Pure helpers + a module-level timestamp map. */
const lastCallAt = new Map<string, number>();

const JITTER_MS = 40; // small jitter to avoid burst alignment

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Enforce a minimum gap between calls per `scope`.
 * If `retryAfterHeader` is provided (429), we wait that instead.
 */
export async function pace(scope: string, minGapMs: number, retryAfterHeader?: string | null) {
  const now = Date.now();

  // Respect Retry-After header first (seconds or HTTP-date; Toast uses seconds)
  if (retryAfterHeader) {
    const sec = parseInt(retryAfterHeader, 10);
    if (Number.isFinite(sec) && sec > 0) {
      await sleep(sec * 1000);
      // Reset last-call so we don't immediately fire again
      lastCallAt.set(scope, Date.now());
      return;
    }
  }

  const last = lastCallAt.get(scope) ?? 0;
  const elapsed = now - last;
  const need = minGapMs + Math.floor(Math.random() * JITTER_MS) - elapsed;
  if (need > 0) {
    await sleep(need);
  }
  lastCallAt.set(scope, Date.now());
}
