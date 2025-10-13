// /src/routes/api/debug/auth-stats.ts
// Path: src/routes/api/debug/auth-stats.ts

import type { ToastEnv } from "../../../lib/env";

type TokenMeta = { accessToken?: string; expiresAt?: number } | null;

export default async function handleAuthStats(env: Pick<ToastEnv, "TOKEN_KV">): Promise<Response> {
  const statsRaw = await env.TOKEN_KV.get("toast_access_token_stats");
  const token = (await env.TOKEN_KV.get("toast_access_token", "json").catch(() => null)) as TokenMeta;
  const parsed = statsRaw ? JSON.parse(statsRaw) : null;

  // Never leak the full token; just show a short preview & expiry
  const preview =
    token?.accessToken ? String(token.accessToken).slice(0, 12) + "..." : null;
  const expiresAt = token?.expiresAt ?? null;
  const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : null;

  return Response.json({
    ok: true,
    token_preview: preview,
    token_expires_at: expiresAt,
    token_seconds_left: secondsLeft,
    stats: parsed ?? {
      refresh_attempts: 0,
      refresh_success: 0,
      refresh_fail: 0,
    },
  });
}
