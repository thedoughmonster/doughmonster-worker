// /src/lib/time.ts
// Path: src/lib/time.ts

/**
 * Toast requires: yyyy-MM-dd'T'HH:mm:ss.SSSZ (e.g., 2016-01-01T14:13:12.000+0400)
 * We'll emit UTC with +0000.
 */

export function nowToastIsoUtc(): string {
  return toToastIsoUtc(new Date());
}

export function minusMinutesToastIsoUtc(isoLike: string, minutes: number): string {
  const d = new Date(isoLike);
  d.setUTCMinutes(d.getUTCMinutes() - minutes);
  return toToastIsoUtc(d);
}

function toToastIsoUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.000+0000`;
}
