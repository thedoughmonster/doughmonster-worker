// /src/lib/toastAuth.ts
// Path: src/lib/toastAuth.ts

import type { EnvDeps } from "./toastApi";
import { paceBeforeToastCall } from "./pacer";

const TOKEN_KEY = "toast_machine_token_v1";

function requireTokenKV(env: EnvDeps): KVNamespace {
  const kv = (env as any).TOKEN_KV;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    throw new Error("TOKEN_KV binding missing or invalid.");
  }
  return kv as KVNamespace;
}

/**
 * Auth for Toast `/authentication/login`
 * Body must include: clientId, clientSecret, userAccessType: "TOAST_MACHINE_CLIENT"
 * Response: { token: { tokenType, accessToken, expiresIn, ... }, status: "SUCCESS" }
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

  // 2) Request new token (pace lightly to avoid global per-sec caps)
  await paceBeforeToastCall("global", 600);

  const authUrl = env.TOAST_AUTH_URL; // should be https://ws-api.toasttab.com/authentication/login
  const clientId = (env as any).TOAST_CLIENT_ID as string | undefined;
  const clientSecret = (env as any).TOAST_CLIENT_SECRET as string | undefined;

  if (!authUrl || !clientId || !clientSecret) {
    throw new Error("Missing TOAST_AUTH_URL, TOAST_CLIENT_ID, or TOAST_CLIENT_SECRET.");
  }

  const body = {
    clientId,
    clientSecret,
    userAccessType: "TOAST_MACHINE_CLIENT",
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

  type LoginResp = {
    token?: { tokenType?: string; accessToken?: string; expiresIn?: number };
    status?: string;
  };

  const data = (await res.json()) as LoginResp;
  const tokenType = (data?.token?.tokenType || "").toLowerCase();
  const accessToken = data?.token?.accessToken;
  const ttlSec = Math.max(120, Math.min(86400, Number(data?.token?.expiresIn ?? 1800)));

  if (tokenType !== "bearer" || !accessToken) {
    throw new Error("Toast auth response missing bearer token.");
  }

  const expiresAt = now + ttlSec * 1000;

  await kv.put(
    TOKEN_KEY,
    JSON.stringify({ accessToken, expiresAt }),
    { expirationTtl: Math.max(60, ttlSec - 60) }
  );

  return accessToken;
}
