// /src/routes/api/menu/index.ts
// Path: src/routes/api/menu/index.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";
import { acquireSingleFlight, releaseSingleFlight, getRateLimitedUntil } from "../../../lib/rateLimit";
import { getCachedMenuBody, setCachedMenuBody, getCachedRevision, setCachedRevision, computeRevision } from "../../../lib/menuCache";

/**
 * GET /api/menu[?force=1]
 * Now uses scoped pacer:
 *  - metadata calls => scope "global" (default pacing)
 *  - full /menus calls => scope "menus" with 1100ms min gap (1 rps safety)
 */
export default async function handleMenu(env: EnvDeps, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  // 1) Serve cached menu if present and not forced
  const cached = await getCachedMenuBody(env.CACHE_KV);
  if (cached && !force) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
    });
  }

  // 2) Respect any global RL cool-down set by previous 429s
  const rlUntil = await getRateLimitedUntil(env.CACHE_KV);
  const now = Date.now();
  if (rlUntil && rlUntil > now) {
    const retrySec = Math.max(1, Math.ceil((rlUntil - now) / 1000));
    return Response.json({ ok: false, error: "Rate limited; please retry later.", retryAfter: retrySec }, { status: 429 });
  }

  // 3) Cheap metadata check (scope: global)
  let needFull = force || !cached;
  try {
    let meta: any;
    try {
      meta = await toastGet<any>(env, "/menus/v3/metadata"); // global scope pacing
    } catch (e: any) {
      const msg: string = e?.message || "";
      const fallback = /failed:\s*(403|404)\b/.test(msg);
      if (fallback) {
        meta = await toastGet<any>(env, "/menus/v2/metadata"); // global scope pacing
      } else {
        throw e;
      }
    }

    const newRev = await computeRevision(meta);
    const prevRev = await getCachedRevision(env.CACHE_KV);
    if (!prevRev || prevRev !== newRev) {
      needFull = true;
      await setCachedRevision(env.CACHE_KV, newRev);
    }
  } catch (e: any) {
    if (cached) {
      return new Response(cached, {
        headers: { "Content-Type": "application/json", "X-Cache": "STALE" },
      });
    }
    const status = Number(/failed:\s*(\d{3})\b/.exec(e?.message || "")?.[1] ?? "502");
    return Response.json({ ok: false, error: e?.message || "Metadata fetch failed" }, { status });
  }

  if (!needFull && cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json", "X-Cache": "HIT-NOCHANGE" },
    });
  }

  // 4) Single-flight full menu fetch (scope: "menus" with 1100ms gap)
  const iAmFetcher = await acquireSingleFlight(env.CACHE_KV, 60);
  if (!iAmFetcher) {
    await new Promise((r) => setTimeout(r, 1500));
    const after = await getCachedMenuBody(env.CACHE_KV);
    if (after) {
      return new Response(after, {
        headers: { "Content-Type": "application/json", "X-Cache": "LATE-HIT" },
      });
    }
  }

  try {
    // Try v3 first
    try {
      const data = await toastGet<any>(env, "/menus/v3/menus", {}, { scope: "menus", minGapMs: 1100 });
      const body = JSON.stringify({ ok: true, apiVersion: "v3", data });
      await setCachedMenuBody(env.CACHE_KV, body, 600); // 10 min
      return new Response(body, { headers: { "Content-Type": "application/json", "X-Cache": "MISS" } });
    } catch (e: any) {
      const msg: string = e?.message || "";
      const fallback = /failed:\s*(403|404)\b/.test(msg);
      if (!fallback) throw e;

      const dataV2 = await toastGet<any>(env, "/menus/v2/menus", {}, { scope: "menus", minGapMs: 1100 });
      const body = JSON.stringify({ ok: true, apiVersion: "v2", data: dataV2 });
      await setCachedMenuBody(env.CACHE_KV, body, 600);
      return new Response(body, { headers: { "Content-Type": "application/json", "X-Cache": "MISS" } });
    }
  } catch (e: any) {
    const status = Number(/failed:\s*(\d{3})\b/.exec(e?.message || "")?.[1] ?? "502");
    return Response.json({ ok: false, error: e?.message || "Menu fetch failed" }, { status });
  } finally {
    await releaseSingleFlight(env.CACHE_KV);
  }
}
