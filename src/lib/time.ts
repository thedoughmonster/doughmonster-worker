// /src/lib/time.ts
// Path: src/lib/time.ts

/** ISO like 2025-10-10T23:25:00Z (no millis) */
export function nowUtcIso(): string {
  return toIsoNoMs(new Date());
}

/** Subtract hours from an ISO string (UTC) and return ISO (UTC, no ms). */
export function isoMinusHours(iso: string, hours: number): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() - hours);
  return toIsoNoMs(d);
}

function toIsoNoMs(d: Date): string {
  // Ensure trailing 'Z' and strip milliseconds
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds()
  )).toISOString().replace(/\.\d{3}Z$/, "Z");
}
