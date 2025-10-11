// /src/lib/time.ts
// Path: src/lib/time.ts

/** Return current time as Toast ISO: yyyy-MM-dd'T'HH:mm:ss.SSSZ (UTC, +0000). */
export function nowToastIsoUtc(): string {
  return toToastIsoUtc(new Date());
}

/** Subtract minutes from a Toast ISO string (or ISO-like), return Toast ISO UTC. */
export function minusMinutesToastIsoUtc(isoLike: string, minutes: number): string {
  const d = new Date(isoLike);
  d.setUTCMinutes(d.getUTCMinutes() - minutes);
  return toToastIsoUtc(d);
}

/** Add minutes to a Toast ISO string (or ISO-like), return Toast ISO UTC. */
export function toastsUtcAddMinutes(isoLike: string, minutes: number): string {
  const d = new Date(isoLike);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return toToastIsoUtc(d);
}

/** Clamp an integer-like query param. */
export function clampInt(raw: string | null, min: number, max: number, dflt: number): number {
  const n = Number(raw ?? dflt);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Coerce to number or null. */
export function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Format Date as Toast UTC ISO with +0000 offset and .000 ms. */
function toToastIsoUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.000+0000`;
}

/**
 * Build a single day window and hourly (<=sliceMinutes) slices using a fixed numeric offset like "-0400".
 * We don’t infer DST; caller must supply the correct offset for that calendar date.
 *
 * Returns Toast-format start/end and an array of [start,end] pairs covering the day.
 */
export function buildDaySlicesWithOffset(
  yyyyMmDd: string,
  tzOffset: string,
  sliceMinutes: number
): { startToast: string; endToast: string; slices: Array<[string, string]> } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) {
    throw new Error(`Invalid date '${yyyyMmDd}', expected YYYY-MM-DD`);
  }
  if (!/^[+-]\d{4}$/.test(tzOffset)) {
    throw new Error(`Invalid tzOffset '${tzOffset}', expected like -0400/-0500`);
  }

  const startToast = `${yyyyMmDd}T00:00:00.000${tzOffset}`;
  const endToast = `${yyyyMmDd}T23:59:59.000${tzOffset}`;

  const slices: Array<[string, string]> = [];
  let cursor = startToast;

  while (compareToast(cursor, endToast) < 0) {
    const next = addMinutesToastString(cursor, sliceMinutes);
    if (compareToast(next, endToast) >= 0) {
      slices.push([cursor, endToast]);
      break;
    } else {
      slices.push([cursor, next]);
      cursor = next;
    }
  }

  return { startToast, endToast, slices };
}

/**
 * Build slices **within a local-hours window** of a given day.
 * Example: startHour=6, endHour=20 creates slices from 06:00…19:59 inclusive.
 */
export function buildLocalHourSlicesWithinDay(
  yyyyMmDd: string,
  tzOffset: string,
  startHour: number,
  endHour: number,
  sliceMinutes = 60
): { startToast: string; endToast: string; slices: Array<[string, string]> } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) {
    throw new Error(`Invalid date '${yyyyMmDd}', expected YYYY-MM-DD`);
  }
  if (!/^[+-]\d{4}$/.test(tzOffset)) {
    throw new Error(`Invalid tzOffset '${tzOffset}', expected like -0400/-0500`);
  }
  if (!(Number.isInteger(startHour) && Number.isInteger(endHour))) {
    throw new Error("startHour and endHour must be integers (0–24).");
  }
  if (startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24 || endHour <= startHour) {
    throw new Error("Hour window must satisfy: 0 ≤ startHour < endHour ≤ 24.");
  }

  const HH = (h: number) => String(h).padStart(2, "0");
  const startToast = `${yyyyMmDd}T${HH(startHour)}:00:00.000${tzOffset}`;
  // Inclusive end at the last second of the previous minute of endHour
  const endToast = `${yyyyMmDd}T${HH(endHour - 1)}:59:59.000${tzOffset}`;

  const slices: Array<[string, string]> = [];
  let cursor = startToast;

  while (compareToast(cursor, endToast) < 0) {
    const next = addMinutesToastString(cursor, sliceMinutes);
    if (compareToast(next, endToast) >= 0) {
      slices.push([cursor, endToast]);
      break;
    } else {
      slices.push([cursor, next]);
      cursor = next;
    }
  }

  return { startToast, endToast, slices };
}

/** Add minutes to a Toast-format string (yyyy-MM-ddTHH:mm:ss.SSS±HHmm) preserving the same numeric offset. */
function addMinutesToastString(toastIso: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-]\d{4})$/.exec(toastIso);
  if (!m) return toastIso;

  const [, Y, Mo, D, H, Mi, S, ms, off] = m;
  const sign = off.startsWith("-") ? -1 : 1;
  const oh = Number(off.slice(1, 3));
  const om = Number(off.slice(3, 5));
  const totalOffsetMinutes = sign * (oh * 60 + om);

  // Convert to real UTC instant
  const baseUtc = Date.UTC(
    Number(Y),
    Number(Mo) - 1,
    Number(D),
    Number(H),
    Number(Mi) - totalOffsetMinutes,
    Number(S),
    Number(ms)
  );

  const d = new Date(baseUtc + minutes * 60_000);

  // Convert back to local wall clock with same offset
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours() + Math.trunc(totalOffsetMinutes / 60)).padStart(2, "0");
  const mm = String(d.getUTCMinutes() + (totalOffsetMinutes % 60)).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");

  // Normalize by re-applying offset inversion to ensure proper carry
  const back = new Date(
    Date.UTC(
      Number(yyyy),
      Number(MM) - 1,
      Number(dd),
      Number(HH),
      Number(mm) - totalOffsetMinutes,
      Number(ss),
      0
    )
  );

  const y2 = back.getUTCFullYear();
  const M2 = String(back.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(back.getUTCDate()).padStart(2, "0");
  const H2 = String(back.getUTCHours() + Math.trunc(totalOffsetMinutes / 60)).padStart(2, "0");
  const m2 = String(back.getUTCMinutes() + (totalOffsetMinutes % 60)).padStart(2, "0");
  const s2 = String(back.getUTCSeconds()).padStart(2, "0");

  return `${y2}-${M2}-${d2}T${H2}:${m2}:${s2}.000${off}`;
}

/** Compare two Toast-format timestamps by converting to epoch ms. */
function compareToast(a: string, b: string): number {
  const toMs = (x: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-]\d{4})$/.exec(x);
    if (!m) return 0;
    const [, Y, Mo, D, H, Mi, S, ms, off] = m;
    const sign = off.startsWith("-") ? -1 : 1;
    const oh = Number(off.slice(1, 3));
    const om = Number(off.slice(3, 5));
    const totalOffsetMinutes = sign * (oh * 60 + om);
    return Date.UTC(
      Number(Y),
      Number(Mo) - 1,
      Number(D),
      Number(H),
      Number(Mi) - totalOffsetMinutes,
      Number(S),
      Number(ms)
    );
  };
  const A = toMs(a), B = toMs(b);
  return A === B ? 0 : A < B ? -1 : 1;
}
