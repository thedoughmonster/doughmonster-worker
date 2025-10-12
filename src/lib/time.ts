// /src/lib/time.ts
// Path: src/lib/time.ts

/** Clamp a possibly-nullish string number into [min,max], with a default fallback. */
export function clampInt(
  value: string | null,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Ensure a ±HHmm offset string (e.g. -0400, +0000, +0530). Throws on invalid. */
export function toToastOffset(offset: string): string {
  if (!/^[+-]\d{4}$/.test(offset)) {
    throw new Error(`Invalid tz offset: ${offset} (expected ±HHmm)`);
  }
  return offset;
}

/** Convert a JS ISO (YYYY-MM-DDTHH:mm:ss.SSSZ or ±HH:MM) to Toast ISO (±HHmm, or +0000). */
function toToastIso(iso: string): string {
  if (iso.endsWith("Z")) return iso.replace("Z", "+0000"); // Z → +0000
  return iso.replace(/([+-]\d{2}):(\d{2})$/, "$1$2");       // ±HH:MM → ±HHMM
}

/** Convert a Toast ISO (±HHmm) to a JS-compatible ISO (±HH:MM). */
function toJsIso(iso: string): string {
  return iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

/** Now, as Toast ISO in UTC (YYYY-MM-DDTHH:mm:ss.SSS+0000). */
export function nowToastIsoUtc(): string {
  return toToastIso(new Date().toISOString());
}

/** (from || now) minus N minutes, returned as Toast ISO in UTC. */
export function minusMinutesToastIsoUtc(minutes: number, from?: string): string {
  const base = from ? new Date(toJsIso(from)) : new Date();
  const d = new Date(base.getTime() - minutes * 60_000);
  return toToastIso(d.toISOString());
}

/**
 * Build 60-minute toast-formatted slices for a local day window.
 * Inputs: date "YYYY-MM-DD", tzOffset "±HHmm", startHour [0..23], endHour [1..24], stepMinutes (default 60)
 * Returns: toast-formatted strings "YYYY-MM-DDTHH:mm:ss.SSS±HHmm"
 */
export function buildLocalHourSlicesWithinDay(
  date: string,
  tzOffset: string,
  startHour: number,
  endHour: number,
  stepMinutes = 60
): {
  startToast: string;
  endToast: string;
  slices: [string, string][];
} {
  const off = toToastOffset(tzOffset);

  const mk = (h: number, m: number, s: number, ms: number) =>
    `${date}T${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}${off}`;

  const startToast = mk(startHour, 0, 0, 0);
  const endToast = mk(endHour - 1, 59, 59, 0);

  const slices: [string, string][] = [];
  let h = startHour;
  while (h < endHour) {
    const sliceStart = mk(h, 0, 0, 0);
    const nextH = Math.min(h + Math.ceil(stepMinutes / 60), endHour);
    const isFullHour = stepMinutes >= 60;
    const endMin = isFullHour ? 59 : ((stepMinutes % 60) || 60) - 1; // 59 for full hour
    const sliceEnd =
      nextH > h + 1 || isFullHour
        ? mk(h, 59, 59, 0)
        : `${date}T${pad2(h)}:${pad2(endMin)}:59.000${off}`;

    slices.push([sliceStart, sliceEnd]);
    h = nextH;
  }

  return { startToast, endToast, slices };
}

/**
 * Slice an arbitrary ISO start/end (with offsets) into ≤60-minute windows.
 * Examples:
 *   start = "2025-10-10T06:00:00.000-0400"
 *   end   = "2025-10-10T07:59:59.000-0400"
 *
 * Returns [{ start, end }], preserving original offsets and subtracting 1s from each slice end.
 */
export function buildIsoWindowSlices(
  startISO: string,
  endISO: string,
  stepMinutes = 60
): Array<{ start: string; end: string }> {
  const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/;
  if (!isoRe.test(startISO) || !isoRe.test(endISO)) {
    throw new Error(
      `Invalid ISO inputs. Expect "YYYY-MM-DDTHH:mm:ss.SSS±HHmm". start=${startISO} end=${endISO}`
    );
  }

  const start = new Date(toJsIso(startISO));
  const end = new Date(toJsIso(endISO));
  if (!(start.getTime() < end.getTime())) return [];

  const out: Array<{ start: string; end: string }> = [];
  const stepMs = stepMinutes * 60 * 1000;

  let sliceStart = new Date(start.getTime());
  while (sliceStart < end) {
    const sliceEnd = new Date(Math.min(sliceStart.getTime() + stepMs - 1000, end.getTime())); // -1s for Toast
    out.push({
      start: toToastIso(sliceStart.toISOString()),
      end: toToastIso(sliceEnd.toISOString()),
    });
    const next = new Date(sliceEnd.getTime() + 1000);
    if (next >= end) break;
    sliceStart = next;
  }

  return out;
}

// ---- tiny helpers ----
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function pad3(n: number) {
  return String(n).padStart(3, "0");
}
