// /src/lib/toastAuth.ts

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
 */
export async function getAccessToken(env: ToastAuthConfig): Promise<string> {
  const cacheKey = "toast_access_token";
  const cached = await env.kv.get<ToastToken>(cacheKey, "json");

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    // still valid (with 1min buffer)
    return cached.accessToken;
  }

  const token = await fetchNewToken(env);
  await env.kv.put(cacheKey, JSON.stringify(token), {
    expirationTtl: 3600, // 1 hour
  });

  return token.accessToken;
}

async function fetchNewToken(env: ToastAuthConfig): Promise<ToastToken> {
  const body = JSON.stringify({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  });

  const res = await fetch(env.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Toast auth failed: ${res.status}`);
  }

  const data = await res.json<{
    access_token: string;
    expires_in: number;
  }>();

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}
