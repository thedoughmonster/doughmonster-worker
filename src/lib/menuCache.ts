// /src/lib/menuCache.ts
// Path: src/lib/menuCache.ts

/**
 * Small helpers to cache full menu payloads and a revision string derived from metadata.
 * CACHE_KV keys:
 *  - "menu_body_json"  -> stringified JSON of the last full menus response
 *  - "menu_rev"        -> revision hash derived from metadata
 */

const MENU_BODY_KEY = "menu_body_json";
const MENU_REV_KEY = "menu_rev";

/** Return the cached full menu body (string) if present. */
export async function getCachedMenuBody(kv: KVNamespace): Promise<string | null> {
  return kv.get(MENU_BODY_KEY);
}

/** Cache the full menu body for `ttlSeconds`. */
export async function setCachedMenuBody(
  kv: KVNamespace,
  body: string,
  ttlSeconds: number
): Promise<void> {
  await kv.put(MENU_BODY_KEY, body, { expirationTtl: Math.max(60, ttlSeconds) });
}

/** Get the cached metadata revision string, if any. */
export async function getCachedRevision(kv: KVNamespace): Promise<string | null> {
  return kv.get(MENU_REV_KEY);
}

/** Set the metadata revision string. */
export async function setCachedRevision(kv: KVNamespace, rev: string): Promise<void> {
  await kv.put(MENU_REV_KEY, rev, { expirationTtl: 7 * 24 * 60 * 60 }); // keep a week
}

/**
 * Compute a stable revision hash from metadata JSON.
 * Uses SHA-256 over JSON.stringify(metadata).
 */
export async function computeRevision(metadata: unknown): Promise<string> {
  const text = typeof metadata === "string" ? metadata : JSON.stringify(metadata ?? {});
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, "0");
    out += h;
  }
  return out;
}
