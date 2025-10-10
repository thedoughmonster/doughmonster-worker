// /src/lib/toastApi.ts
// Path: src/lib/toastApi.ts

import { getAccessToken } from "./toastAuth";

export interface EnvDeps {
  TOAST_API_BASE: string;
  TOAST_AUTH_URL: string;
  TOAST_CLIENT_ID: string;
  TOAST_CLIENT_SECRET: string;
  TOAST_RESTAURANT_GUID: string;
  TOKEN_KV: KVNamespace;
}

/**
 * Pure helper to call Toast API with an auto-fetched Bearer token.
 * Adds required `Toast-Restaurant-External-ID` header.
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
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Toast GET ${url.pathname} failed: ${res.status}${body ? ` - ${body}` : ""}`
    );
  }

  return res.json<T>();
}
