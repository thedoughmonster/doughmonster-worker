// /src/lib/toastAuth.ts
// Path: src/lib/toastAuth.ts

import type { EnvDeps } from "./toastApi";
import { paceBeforeToastCall } from "./pacer";

const TOKEN_KEY = "toast_machine_token_v1";

function assertKV(env: EnvDeps) {
  const kv = (env as any).TOKEN_KV;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    throw new Error(
      "TOKEN_KV binding missing or invalid. Check wrangler.toml [[kv_namespaces]] and dashboard bindings."
    );
  }
  return kv as KVNamespace;
}

export async function getAccessToken(env: EnvDeps): Promise<string> {
  const kv = assertKV(env);

  // 1) Try cached token
  const cached = (await kv.get(TOKEN_KEY, "json").catch(() => null)) as
    | { accessToken: string; expiresAt: number }
    | null;
  const now = Date.now();
  if (cached?.accessToken && cached.expiresAt && cached.expiresAt - now > 60_000) {
    return cached.accessToken;
  }

  // 2) Request a new token (pace to avoid global per-sec limits)
  await paceBeforeToastCall("global", 600);

  const authUrl = env.TOAST_AUTH_URL; // e.g. https://ws-api.toasttab.com/authentication/login
  const clientId = (env as any).TOAST_CLIENT_ID as string | undefined;
  const clientSecret = (env as any).TOAST_CLIENT_SECRET as string | undefined;

  if (!authUrl || !clientId || !clientSecret) {
    throw new Error(
      "Missing Toast auth config. Ensure TOAST_AUTH_URL, TOAST_CLIENT_ID, TOAST_CLIENT_SECRET are set."
    );
  }

  const body = {
    clientId,
    clientSecret,
    // Required by Toast for machine-to-machine clients
    userAccessType: "TOAST_MACHINE_CLIENT",
  };

  const r = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const retryAfter = r.headers?.get?.("retry-after") ?? null;
  if (r.status === 429) {
    await paceBeforeToastCall("global", 1000, retryAfter);
    throw new Error("Rate limited at auth; please retry.");
  }

  if (!r.ok) {
    // show server message to help debugging
    const text = await r.text().catch(() => "");
    throw new Error(`Toast auth failed: ${r.status} ${text}`);
  }

  type AuthResponse = {
    token?: {
      tokenType?: string; // should be "Bearer"
      accessToken?: string;
      expiresIn?: number; // seconds
      scope?: string;
      idToken?: string;
      refreshToken?: string;
    };
    status?: string; // "SUCCESS"
  };

  const data = (await r.json()) as AuthResponse;

  const accessToken = data?.token?.accessToken;
  const tokenType = (data?.token?.tokenType || "Bearer").trim();
  const ttlSec = Math.max(120, Math.min(86400, Number(data?.token?.expiresIn ?? 1800)));

  if (!(accessToken && tokenType.toLowerCase() === "bearer")) {
    throw new Error("Toast auth response missing bearer accessToken.");
  }

  const expiresAt = now + ttlSec * 1000;

  await kv.put(
    TOKEN_KEY,
    JSON.stringify({ accessToken, expiresAt }),
    { expirationTtl: Math.max(60, ttlSec - 60) } // refresh 1 minute early
  );

  return accessToken;
}
