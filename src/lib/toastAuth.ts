// /src/lib/toastAuth.ts
// Path: src/lib/toastAuth.ts

export interface ToastAuthConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  kv: KVNamespace;
}

export interface ToastToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

/**
 * Fetches and caches a Toast API access token using KV storage.
 * Caches under key "toast_access_token".
 */
export async function getAccessToken(env: ToastAuthConfig): Promise<string> {
  const cacheKey = "toast_access_token";
  const cached = await env.kv.get<ToastToken>(cacheKey, "json");

  // Reuse valid token with a 60s buffer
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const token = await fetchNewToken(env);
  // Use TTL roughly equal to remaining lifetime (cap at 24h for safety)
  const ttlSeconds = Math.max(60, Math.min(24 * 3600, Math.floor((token.expiresAt - Date.now()) / 1000)));
  await env.kv.put(cacheKey, JSON.stringify(token), { expirationTtl: ttlSeconds });

  return token.accessToken;
}

async function fetchNewToken(env: ToastAuthConfig): Promise<ToastToken> {
  const res = await fetch(env.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
  });

  if (!res.ok) {
    let errBody = "";
    try {
      errBody = await res.text();
    } catch {}
    throw new Error(`Toast auth failed: ${res.status}${errBody ? ` - ${errBody}` : ""}`);
  }

  // Response shape per docs: { token: { tokenType, accessToken, expiresIn, ... }, status }
  const data = await res.json<{
    token: { tokenType: string; accessToken: string; expiresIn: number };
    status: string;
  }>();

  if (!data?.token?.accessToken || !data?.token?.expiresIn) {
    throw new Error("Toast auth: missing accessToken or expiresIn in response");
  }

  return {
    accessToken: data.token.accessToken,
    expiresAt: Date.now() + data.token.expiresIn * 1000,
  };
}
