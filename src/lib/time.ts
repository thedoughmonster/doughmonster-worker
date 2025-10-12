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

  // Build Date objects in the provided local offset by constructing ISO with that offset.
  // Example: 2025-10-10T06:00:00.000-0400
  const mk = (h: number, m: number, s: number, ms: number) =>
    `${date}T${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}${off}`;

  const startToast = mk(startHour, 0, 0, 0);
  const endToast = mk(endHour - 1, 59, 59, 0);

  // Generate hourly (or stepMinutes) slices fully within [startHour, endHour)
  const slices: [string, string][] = [];
  let h = startHour;
  while (h < endHour) {
    const sliceStart = mk(h, 0, 0, 0);
    // cap each slice to stepMinutes; subtract 1s to keep Toast inclusive edges happy
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
 * Input examples:
 *   start = "2025-10-10T06:00:00.000-0400"
 *   end   = "2025-10-10T07:59:59.000-0400"
 *
 * Returns an array of { start, end } strings formatted for Toast (preserving the original offsets).
 * The last slice end is clamped to the given end.
 */
export function buildIsoWindowSlices(
  startISO: string,
  endISO: string,
  stepMinutes = 60
): Array<{ start: string; end: string }> {
  // Basic validation — both must look like ISO with offset ±HHmm
  const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/;
  if (!isoRe.test(startISO) || !isoRe.test(endISO)) {
    throw new Error(
      `Invalid ISO inputs. Expect "YYYY-MM-DDTHH:mm:ss.SSS±HHmm". start=${startISO} end=${endISO}`
    );
  }

  // Convert to a Date by transforming ±HHmm to ±HH:MM (JS Date requirement)
  const toJsIso = (s: string) => s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const toToastIso = (s: string) => s.replace(/([+-]\d{2}):(\d{2})$/, "$1$2");

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
    // next slice starts exactly at previous end + 1s
    const next = new Date(sliceEnd.getTime() + 1000);
    if (next >= end) break;
    sliceStart = next;
  }

  return out;
}

// ---- small format helpers ----
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function pad3(n: number) {
  return String(n).padStart(3, "0");
}
