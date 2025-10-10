// /src/lib/toastApi.ts
// Path: src/lib/toastApi.ts

import { pace } from "./pacer";
import { getAccessToken } from "./toastAuth";

export interface EnvDeps {
  TOAST_API_BASE: string;
  TOAST_AUTH_URL: string;
  TOAST_RESTAURANT_GUID: string;
  TOAST_CLIENT_ID: string;
  TOAST_CLIENT_SECRET: string;
  TOKEN_KV: KVNamespace;
  CACHE_KV: KVNamespace;
}

type FetchOpts = {
  scope?: "global" | "menu" | "orders";
  minGapMs?: number;
  query?: Record<string, string | number | boolean | undefined | null>;
  method?: "GET" | "POST";
  body?: unknown;
};

/** Builds a URL with query params. Pure. */
function buildUrl(base: string, path: string, query?: FetchOpts["query"]: string) {
  const u = new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : base + "/");
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

/**
 * Toast GET with pacing + 429 handling + auth token.
 * Caller may set scope & minGapMs; we default conservatively.
 */
export async function toastGet<T>(
  env: EnvDeps,
  path: string,
  query?: FetchOpts["query"],
  opts?: Omit<FetchOpts, "query" | "method" | "body">
): Promise<T> {
  const scope = opts?.scope ?? "global";
  // Defaults tuned to earlier findings:
  // - Menus: 1 req/sec hard limit → 1100ms
  // - Orders: global limit ~2 req/sec → 800ms is safer
  const minGapMs =
    opts?.minGapMs ??
    (scope === "menu" ? 1100 : scope === "orders" ? 800 : 750);

  // Pace BEFORE the request to avoid tripping the per-second caps.
  await pace(scope, minGapMs);

  const accessToken = await getAccessToken(env);

  const url = buildUrl(env.TOAST_API_BASE, path, query);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
    },
  });

  // If we got throttled, honor Retry-After and retry once.
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    await pace(scope, minGapMs, retryAfter);
    const res2 = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
      },
    });
    if (!res2.ok) {
      const body2 = await res2.text();
      throw new Error(`Toast ${res2.status} after retry: ${body2}`);
    }
    return (await res2.json()) as T;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Toast ${res.status}: ${body}`);
  }

  return (await res.json()) as T;
}
