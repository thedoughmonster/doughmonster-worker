// /src/lib/toastAuth.ts
// Path: src/lib/toastAuth.ts

import { paceBeforeToastCall } from "./pacer";

export interface ToastAuthConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  kv: KVNamespace;          // TOKEN_KV
  paceKv?: KVNamespace;     // optional KV for global pacer
}

export interface ToastToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

type AuthStats = {
  refresh_attempts: number;
  refresh_success: number;
  refresh_fail: number;
  last_success_at?: number;
  last_fail_at?: number;
  last_error?: string;
};

const TOKEN_KEY = "toast_access_token";
const LOCK_KEY  = "toast_access_token_lock";
const STATS_KEY = "toast_access_token_stats";
const MIN_TTL   = 60;

export async function getAccessToken(env: ToastAuthConfig): Promise<string> {
  const cached = await env.kv.get<ToastToken>(TOKEN_KEY, "json");
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const lockHeld = await acquireLock(env.kv);
  if (lockHeld) {
    try {
      const fresh = await fetchNewTokenWithStats(env);
      const ttlSeconds = clampTtlSeconds(Math.floor((fresh.expiresAt - Date.now()) / 1000));
      await env.kv.put(TOKEN_KEY, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
      return fresh.accessToken;
    } finally {
      await releaseLock(env.kv);
    }
  } else {
    await sleep(500);
    const after = await env.kv.get<ToastToken>(TOKEN_KEY, "json");
    if (after?.accessToken) return after.accessToken;

    // last resort guarded refresh
    const fresh = await fetchNewTokenWithStats(env);
    const ttlSeconds = clampTtlSeconds(Math.floor((fresh.expiresAt - Date.now()) / 1000));
    await env.kv.put(TOKEN_KEY, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
    return fresh.accessToken;
  }
}

async function fetchNewTokenWithStats(env: ToastAuthConfig): Promise<ToastToken> {
  await bumpStats(env.kv, (s) => ({ ...s, refresh_attempts: s.refresh_attempts + 1 }));

  // Pace BEFORE calling auth to avoid global burst (use global scope)
  if (env.paceKv) {
    await paceBeforeToastCall(env.paceKv, 600, "global");
  }

  const res = await fetch(env.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "doughmonster-worker/1.0 (+workers)" },
    body: JSON.stringify({
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    await bumpStats(env.kv, (s) => ({
      ...s,
      refresh_fail: s.refresh_fail + 1,
      last_fail_at: Date.now(),
      last_error: `${res.status}${errText ? ` - ${errText}` : ""}`,
    }));
    throw new Error(`Toast auth failed: ${res.status}${errText ? ` - ${errText}` : ""}`);
  }

  const data = await res.json<{ token: { tokenType: string; accessToken: string; expiresIn: number } }>();
  if (!data?.token?.accessToken || !data?.token?.expiresIn) {
    await bumpStats(env.kv, (s) => ({
      ...s,
      refresh_fail: s.refresh_fail + 1,
      last_fail_at: Date.now(),
      last_error: "Missing accessToken/expiresIn",
    }));
    throw new Error("Toast auth: missing accessToken or expiresIn in response");
  }

  await bumpStats(env.kv, (s) => ({
    ...s,
    refresh_success: s.refresh_success + 1,
    last_success_at: Date.now(),
    last_error: undefined,
  }));

  return {
    accessToken: data.token.accessToken,
    expiresAt: Date.now() + data.token.expiresIn * 1000,
  };
}

/* helpers */

async function acquireLock(kv: KVNamespace, ttlSec = MIN_TTL): Promise<boolean> {
  const existing = await kv.get(LOCK_KEY);
  if (existing) return false;
  const ttl = Math.max(MIN_TTL, ttlSec);
  await kv.put(LOCK_KEY, String(Date.now() + ttl * 1000), { expirationTtl: ttl });
  return true;
}

async function releaseLock(kv: KVNamespace): Promise<void> {
  await kv.delete(LOCK_KEY);
}

async function bumpStats(kv: KVNamespace, update: (s: AuthStats) => AuthStats): Promise<void> {
  const existing = (await kv.get<AuthStats>(STATS_KEY, "json")) ?? {
    refresh_attempts: 0,
    refresh_success: 0,
    refresh_fail: 0,
  };
  const next = update(existing);
  await kv.put(STATS_KEY, JSON.stringify(next), { expirationTtl: 7 * 24 * 60 * 60 });
}

function clampTtlSeconds(ttl: number): number {
  return Math.min(Math.max(MIN_TTL, ttl || MIN_TTL), 24 * 60 * 60);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
