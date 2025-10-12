// /src/lib/time.ts
// Path: src/lib/time.ts

/** Format a Date into Toast ISO with explicit offset, e.g. "YYYY-MM-DDTHH:mm:ss.SSS+0000" */
export function toToastIso(d: Date, offset: string = "+0000"): string {
  // We always compute in UTC and stamp +0000 unless told otherwise
  // ISO: 2025-10-10T12:34:56.789Z -> 2025-10-10T12:34:56.789+0000
  return d.toISOString().replace("Z", offset);
}

/** Clamp an integer-like input to a range, with default fallback. Pure. */
export function clampInt(
  v: string | number | null,
  min: number,
  max: number,
  fallback: number
): number {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Return current time as a Toast ISO string in UTC (+0000). Pure. */
export function nowToastIsoUtc(): string {
  return toToastIso(new Date(), "+0000");
}

/**
 * Return (endISO - minutes) as Toast ISO string in UTC (+0000).
 * If endISO omitted, uses now.
 * Pure (doesn’t mutate inputs).
 */
export function minusMinutesToastIsoUtc(minutes: number, endISO?: string): string {
  const endMs = endISO ? Date.parse(endISO.replace(/([+-]\d{4})$/, "Z")) : Date.now();
  const start = new Date(endMs - minutes * 60_000);
  return toToastIso(start, "+0000");
}

/**
 * Build contiguous hour-sized slices within an ISO window (Toast ISO strings).
 * The Toast Orders v2 API limits each request to ≤1 hour.
 * Returns an array of { startISO, endISO } (Toast ISO strings).
 * Pure.
 */
export function buildIsoWindowSlices(startISO: string, endISO: string): Array<{ startISO: string; endISO: string }> {
  const startMs = Date.parse(startISO.replace(/([+-]\d{4})$/, "Z"));
  const endMs = Date.parse(endISO.replace(/([+-]\d{4})$/, "Z"));
  if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs)) {
    throw new Error(`Invalid ISO window: start=${startISO} end=${endISO}`);
  }

  const slices: Array<{ startISO: string; endISO: string }> = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const next = Math.min(cursor + 60 * 60 * 1000, endMs); // cap at 1 hour per request
    const s = toToastIso(new Date(cursor), "+0000");
    const e = toToastIso(new Date(next), "+0000");
    slices.push({ startISO: s, endISO: e });
    cursor = next;
  }
  return slices;
}
