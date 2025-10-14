// /src/routes/api/debug/rl.ts
// Path: src/routes/api/debug/rl.ts

import { clearRateLimited, getRateLimitedUntil } from "../../../lib/rateLimit";

const OWNER_HEADER = "x-dm-admin-key";

/**
 * GET  /api/debug/rl       -> show RL status
 * POST /api/debug/rl/clear -> clear RL (requires x-dm-admin-key header == env.DM_ADMIN_KEY)
 */
export default async function handleRL(env: {
  CACHE_KV: KVNamespace;
  DM_ADMIN_KEY?: string;
}, request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/debug/rl") {
    const until = await getRateLimitedUntil(env.CACHE_KV);
    const now = Date.now();
    const secondsLeft = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
    return Response.json({
      ok: true,
      rateLimited: Boolean(until && until > now),
      retryAfter: secondsLeft,
      until,
      now,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/debug/rl/clear") {
    const provided = request.headers.get(OWNER_HEADER) || "";
    const expected = env.DM_ADMIN_KEY || "";
    if (!expected || provided !== expected) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    await clearRateLimited(env.CACHE_KV);
    return Response.json({ ok: true, cleared: true });
  }

  return Response.json({ ok: false, error: "Not Found" }, { status: 404 });
}
