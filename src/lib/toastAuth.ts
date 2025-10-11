// /src/lib/toastAuth.ts
// Path: src/lib/toastAuth.ts

import type { EnvDeps } from "./toastApi";
import { paceBeforeToastCall } from "./pacer";

const TOKEN_KEY = "toast_machine_token_v1";

/** Ensure TOKEN_KV exists and has get/put. */
function requireTokenKV(env: EnvDeps): KVNamespace {
  const kv = (env as any).TOKEN_KV;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    throw new Error("TOKEN_KV binding missing or invalid.");
  }
  return kv as KVNamespace;
}

/**
 * Get a Toast access token.
 * - Uses KV cache with early refresh.
 * - Calls the configured TOAST_AUTH_URL with client_credentials body.
 * - No alternate endpoints or fallbacks.
 */
export async function getAccessToken(env: EnvDeps): Promise<string> {
  const kv = requireTokenKV(env);

  // 1) Cached token
  const cached = (await kv.get(TOKEN_KEY, "json").catch(() => null)) as
    | { accessToken: string; expiresAt: number }
    | null;

  const now = Date.now();
  if (cached?.accessToken && cached.expiresAt && cached.expiresAt - now > 60_000) {
    return cached.accessToken;
  }

  // 2) Request new token (small pacing to be safe with global per-sec limits)
  await paceBeforeToastCall("global", 600);

  const authUrl = env.TOAST_AUTH_URL;
  const clientId = (env as any).TOAST_CLIENT_ID as string | undefined;
  const clientSecret = (env as any).TOAST_CLIENT_SECRET as string | undefined;

  if (!authUrl || !clientId || !clientSecret) {
    throw new Error("Missing TOAST_AUTH_URL, TOAST_CLIENT_ID, or TOAST_CLIENT_SECRET.");
  }

  const body = {
    clientId,
    clientSecret,
    grant_type: "client_credentials",
  };

  const res = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Toast auth failed: ${res.status} ${text}`);
  }

  // Expected shape: { access_token: string, expires_in?: number }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  const accessToken = data?.access_token;
  if (!accessToken) {
    throw new Error("Toast auth response missing access_token.");
  }

  const ttlSec = Math.max(120, Math.min(86400, Number(data.expires_in ?? 1800)));
  const expiresAt = now + ttlSec * 1000;

  await kv.put(
    TOKEN_KEY,
    JSON.stringify({ accessToken, expiresAt }),
    { expirationTtl: Math.max(60, ttlSec - 60) } // refresh 1 min early
  );

  return accessToken;
}
