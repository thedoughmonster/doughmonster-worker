// /src/lib/toastApi.ts
// Path: src/lib/toastApi.ts

import { getAccessToken } from "./toastAuth";
import { setRateLimited } from "./rateLimit";

export interface EnvDeps {
  TOAST_API_BASE: string;
  TOAST_AUTH_URL: string;
  TOAST_CLIENT_ID: string;
  TOAST_CLIENT_SECRET: string;
  TOAST_RESTAURANT_GUID: string;
  TOKEN_KV: KVNamespace;
  CACHE_KV: KVNamespace;
}

/**
 * Toast GET with auth, restaurant header, and 429 handling.
 */
export async function toastGet<T>(
  env: EnvDeps,
  path: string,
  query: Record<string, string> = {}
): Promise<T> {
  const accessToken = await getAccessToken({
    clientId: env.TOAST_CLIENT_ID,
    clientSecret: env.TOAST_CLIENT_SECRET,
    authUrl: env.TOAST_AUTH_URL,
    kv: env.TOKEN_KV,
  });

  const url = new URL(path, env.TOAST_API_BASE);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
      Accept: "application/json",
      "User-Agent": "doughmonster-worker/1.0 (+workers)",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // If rate-limited, set a cooldown based on Retry-After (default 60s)
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After")) || 60;
      await setRateLimited(env.CACHE_KV, retryAfter);
    }
    throw new Error(`Toast GET ${url.pathname} failed: ${res.status}${text ? ` - ${text}` : ""}`);
  }

  return res.json<T>();
}
