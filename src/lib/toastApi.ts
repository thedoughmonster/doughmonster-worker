// /src/lib/toastApi.ts
// Path: src/lib/toastApi.ts
// Low-level Toast fetch helpers with pacing and structured errors.

import type { ToastApiEnv } from "./env";
import { paceBeforeToastCall } from "./pacer";

type Query = Record<string, string | number | boolean | null | undefined>;

export interface FetchOpts {
  headers?: Record<string, string>;
  query?: Query;
  scope?: "global" | "menu" | "orders";
  minGapMs?: number;
}

function buildUrl(base: string, route: string, query?: Query): string {
  const u = new URL(route.startsWith("http") ? route : `${base.replace(/\/$/, "")}/${route.replace(/^\//, "")}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined) continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

export async function toastGet<T = unknown>(
  env: ToastApiEnv,
  route: string,
  query?: Query,
  opts: FetchOpts = {}
): Promise<T> {
  const url = buildUrl(env.TOAST_API_BASE, route, query);

  // Pace before hitting Toast to respect per-scope rate limits.
  await paceBeforeToastCall(opts.scope ?? "global", opts.minGapMs ?? 600);

  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${await (await import("./toastAuth")).getAccessToken(env)}`,
    "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
    ...(opts.headers ?? {}),
  };

  const resp = await fetch(url, { method: "GET", headers });
  const raw = await resp.text();

  if (!resp.ok) {
    const snippet = raw.slice(0, 512);
    throw new Error(`Toast error ${resp.status} on ${route}: ${snippet}`);
  }

  if (!raw) {
    return undefined as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Toast response was not JSON for ${route}`);
  }
}
