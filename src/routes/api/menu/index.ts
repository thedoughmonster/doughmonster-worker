// /src/routes/api/menu/index.ts
// Path: src/routes/api/menu/index.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";
import {
  acquireSingleFlight,
  releaseSingleFlight,
  getRateLimitedUntil,
} from "../../../lib/rateLimit";

export default async function handleMenu(env: EnvDeps): Promise<Response> {
  const cacheKey = "toast_menu_cache_v1";

  // Serve from cache if present
  const cached = await env.CACHE_KV.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
    });
  }

  // Respect global rate-limit cool-down
  const rlUntil = await getRateLimitedUntil(env.CACHE_KV);
  const now = Date.now();
  if (rlUntil && rlUntil > now) {
    const retrySec = Math.max(1, Math.ceil((rlUntil - now) / 1000));
    return Response.json(
      { ok: false, error: "Rate limited; please retry later.", retryAfter: retrySec },
      { status: 429 }
    );
  }

  // Single-flight: only one caller hits Toast; others wait briefly then serve cache if filled
  const iAmFetcher = await acquireSingleFlight(env.CACHE_KV, 10); // 10s lock
  if (!iAmFetcher) {
    // brief wait then try cache once
    await new Promise((r) => setTimeout(r, 1500));
    const after = await env.CACHE_KV.get(cacheKey);
    if (after) {
      return new Response(after, {
        headers: { "Content-Type": "application/json", "X-Cache": "LATE-HIT" },
      });
    }
    // fallthrough to attempt fetch (edge case)
  }

  try {
    // Try v3 first
    const dataV3 = await toastGet<any>(env, "/menus/v3/menus");
    const body = JSON.stringify({ ok: true, apiVersion: "v3", data: dataV3 });
    await env.CACHE_KV.put(cacheKey, body, { expirationTtl: 600 }); // 10 minutes
    return new Response(body, {
      headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  } catch (e: any) {
    const msg: string = e?.message || "";

    // Only fallback to v2 on 403/404 (permission/resource issues)
    const shouldFallback = /failed:\s*(403|404)\b/.test(msg);
    if (shouldFallback) {
      try {
        const dataV2 = await toastGet<any>(env, "/menus/v2/menus");
        const body = JSON.stringify({ ok: true, apiVersion: "v2", data: dataV2 });
        await env.CACHE_KV.put(cacheKey, body, { expirationTtl: 600 });
        return new Response(body, {
          headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
        });
      } catch (e2: any) {
        return Response.json({ ok: false, error: e2?.message || "Unknown error (v2 fallback)" }, { status: 502 });
      }
    }

    // Surface other errors (incl. 429). If 429 occurred, our toastGet set a cool-down.
    const status = Number(/failed:\s*(\d{3})\b/.exec(msg)?.[1] ?? "502");
    return Response.json({ ok: false, error: msg }, { status });
  } finally {
    await releaseSingleFlight(env.CACHE_KV);
  }
}
