// /src/lib/time.ts
// Path: src/lib/time.ts

/** Zero-pad helpers */
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const pad3 = (n: number) => (n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`);

/** Clamp to an integer in a range, with default */
export function clampInt(val: string | number | null, min: number, max: number, def: number): number {
  const n = typeof val === "string" ? parseInt(val, 10) : typeof val === "number" ? Math.floor(val) : NaN;
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/** Format a Date to Toast ISO with explicit offset (e.g. 2025-10-10T07:00:00.000-0400) */
export function toToastIso(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const MM = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const HH = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  const SSS = pad3(d.getUTCMilliseconds());
  // Force +0000; callers can pre-convert for local offsets before calling if needed
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.${SSS}+0000`;
}

/** Now in UTC as Toast ISO */
export function nowToastIsoUtc(): string {
  return toToastIso(new Date());
}

/** Subtract N minutes from an ISO (or now) and return Toast ISO */
export function minusMinutesToastIsoUtc(minutes: number, endISO?: string): string {
  const base = endISO ? new Date(endISO.replace(/(\+|\-)\d{4}$/, "Z")) : new Date();
  const startMs = base.getTime() - minutes * 60_000;
  return toToastIso(new Date(startMs));
}

/**
 * Build slices between two ISO strings, ensuring each slice is <= maxWindowMinutes (default 60).
 * Returns array of { startISO, endISO } in Toast ISO format.
 */
export function buildIsoWindowSlices(startISO: string, endISO: string, maxWindowMinutes = 60): Array<{ startISO: string; endISO: string }> {
  const start = new Date(startISO.replace(/(\+|\-)\d{4}$/, "Z")).getTime();
  const end = new Date(endISO.replace(/(\+|\-)\d{4}$/, "Z")).getTime();
  if (!(end > start)) return [];

  const out: Array<{ startISO: string; endISO: string }> = [];
  const step = maxWindowMinutes * 60_000;
  let cur = start;
  while (cur < end) {
    const next = Math.min(cur + step, end);
    out.push({ startISO: toToastIso(new Date(cur)), endISO: toToastIso(new Date(next)) });
    cur = next;
  }
  return out;
}

/**
 * Build hour-aligned slices within a specific local day using a numeric offset like "-0400" or "+0530".
 * startHour inclusive, endHour exclusive (e.g., 6..8 yields [06:00-07:00], [07:00-08:00]).
 */
export function buildLocalHourSlicesWithinDay(
  day: string,           // "YYYY-MM-DD"
  tzOffset: string,      // e.g. "-0400" or "+0000"
  startHour: number,
  endHour: number
): Array<{ startISO: string; endISO: string }> {
  const norm = (h: number) => Math.min(Math.max(h, 0), 24);
  const sH = norm(startHour);
  const eH = norm(endHour);
  if (!(eH > sH)) return [];

  const offset = tzOffset.match(/^([+-])(\d{2})(\d{2})$/);
  const sign = offset?.[1] === "-" ? -1 : 1;
  const offH = offset ? parseInt(offset[2], 10) : 0;
  const offM = offset ? parseInt(offset[3], 10) : 0;
  const offsetMinutes = sign * (offH * 60 + offM);

  const toUtcDate = (localHour: number, localMin = 0, localSec = 0, localMs = 0) => {
    // Construct a date at local wall time, then convert to UTC by subtracting offset minutes
    const [Y, M, D] = day.split("-").map((s) => parseInt(s, 10));
    const local = new Date(Date.UTC(Y, M - 1, D, localHour, localMin, localSec, localMs));
    const utcMs = local.getTime() - offsetMinutes * 60_000;
    return new Date(utcMs);
  };

  const slices: Array<{ startISO: string; endISO: string }> = [];
  for (let h = sH; h < eH; h++) {
    const startUtc = toUtcDate(h, 0, 0, 0);
    const endUtc = toUtcDate(h + 1, 0, 0, 0);
    slices.push({ startISO: toToastIso(startUtc), endISO: toToastIso(endUtc) });
  }
  return slices;
}

/** Back-compat: some routes may still import this name */
export const buildDaySlicesWithOffset = buildLocalHourSlicesWithinDay;
