// /src/lib/time.ts
// Path: src/lib/time.ts
// (Replace with this complete file so we centralize small helpers)

export function nowToastIsoUtc(): string {
  return toToastIsoUtc(new Date());
}

export function minusMinutesToastIsoUtc(isoLike: string, minutes: number): string {
  const d = new Date(isoLike);
  d.setUTCMinutes(d.getUTCMinutes() - minutes);
  return toToastIsoUtc(d);
}

export function toastsUtcAddMinutes(isoLike: string, minutes: number): string {
  const d = new Date(isoLike);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return toToastIsoUtc(d);
}

export function clampInt(raw: string | null, min: number, max: number, dflt: number): number {
  const n = Number(raw ?? dflt);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Toast requires yyyy-MM-dd'T'HH:mm:ss.SSSZ, we emit UTC with +0000 and .000 ms */
function toToastIsoUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.000+0000`;
}
