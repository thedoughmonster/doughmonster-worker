// /src/lib/toastAuth.ts
// Path: src/lib/toastAuth.ts

import type { EnvDeps } from "./toastApi";
import { paceBeforeToastCall } from "./pacer";

const TOKEN_KEY = "toast_machine_token_v1";

function assertKV(env: EnvDeps) {
  const kv = (env as any).TOKEN_KV;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    throw new Error("TOKEN_KV binding missing or invalid. Check wrangler.toml [[kv_namespaces]] and dashboard bindings.");
  }
  return kv as KVNamespace;
}

export async function getAccessToken(env: EnvDeps): Promise<string> {
  const kv = assertKV(env);

  // try cache first
  const cached = await kv.get(TOKEN_KEY, "json").catch(() => null) as
    | { accessToken: string; expiresAt: number }
    | null;

  const now = Date.now();
  if (cached?.accessToken && cached.expiresAt && cached.expiresAt - now > 60_000) {
    return cached.accessToken;
  }

  // pace before auth
  await paceBeforeToastCall("global", 600);

  const authUrl = env.TOAST_AUTH_URL;
  const clientId = (env as any).TOAST_CLIENT_ID as string | undefined;
  const clientSecret = (env as any).TOAST_CLIENT_SECRET as string | undefined;

  if (!clientId || !clientSecret || !authUrl) {
    throw new Error("Missing Toast auth secrets. Ensure TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_AUTH_URL are set (secrets/vars).");
  }

  const body = {
    clientId,
    clientSecret,
    grant_type: "client_credentials",
  };

  const r = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // honor rate-limit if present
  const retryAfter = r.headers?.get?.("retry-after") ?? null;
  if (r.status === 429) {
    await paceBeforeToastCall("global", 1000, retryAfter);
    throw new Error("Rate limited at auth; please retry.");
  }

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Toast auth failed: ${r.status} ${text}`);
  }

  const data = (await r.json()) as { access_token: string; expires_in?: number };
  const accessToken = data?.access_token;
  if (!accessToken) throw new Error("Toast auth response missing access_token.");

  const ttlSec = Math.max(120, Math.min(3600, Number(data.expires_in ?? 1800)));
  const expiresAt = now + ttlSec * 1000;

  await kv.put(
    TOKEN_KEY,
    JSON.stringify({ accessToken, expiresAt }),
    { expirationTtl: ttlSec - 60 } // refresh 1 min early
  );

  return accessToken;
}
