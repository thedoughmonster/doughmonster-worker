import type { AppEnv } from "../config/env.js";

const TOKEN_CACHE_KEY = "toast_machine_token_v1";

export async function getToastHeaders(env: AppEnv): Promise<Record<string, string>> {
  const accessToken = await getAccessToken(env);
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
  };
}

async function getAccessToken(env: AppEnv): Promise<string> {
  const kv = env.TOKEN_KV;
  const cached = await kv.get(TOKEN_CACHE_KEY, "json").catch(() => null);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  if (
    cached &&
    typeof cached === "object" &&
    typeof (cached as any).accessToken === "string" &&
    typeof (cached as any).expiresAt === "number" &&
    typeof (cached as any).issuedAtDay === "string" &&
    (cached as any).issuedAtDay === today &&
    (cached as any).expiresAt - now > 60_000
  ) {
    return (cached as any).accessToken as string;
  }

  const res = await fetch(env.TOAST_AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: env.TOAST_CLIENT_ID,
      clientSecret: env.TOAST_CLIENT_SECRET,
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
  });

  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Toast auth failed: ${res.status} ${snippet}`.trim());
  }

  const payload = (await res
    .json()
    .catch(() => ({}))) as {
    token?: { accessToken?: string; tokenType?: string; expiresIn?: number };
  };
  const accessToken = String(payload.token?.accessToken ?? "");
  const tokenType = String(payload.token?.tokenType ?? "").toLowerCase();
  const ttlSec = Number(payload.token?.expiresIn ?? 1800);

  if (!accessToken || tokenType !== "bearer") {
    throw new Error("Toast auth response missing bearer token");
  }

  const expiresInMs = Math.max(120, Math.min(86_400, ttlSec || 0)) * 1000;
  const expiresAt = now + expiresInMs;
  const issuedAtDay = today;

  await kv.put(
    TOKEN_CACHE_KEY,
    JSON.stringify({ accessToken, expiresAt, issuedAtDay }),
    { expirationTtl: Math.max(60, Math.floor(expiresInMs / 1000) - 60) }
  );

  return accessToken;
}
