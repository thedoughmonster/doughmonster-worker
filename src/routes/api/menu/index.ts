// /src/routes/api/menu/index.ts
// Path: src/routes/api/menu/index.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";

export default async function handleMenu(env: EnvDeps): Promise<Response> {
  const cacheKey = "toast_menu_cache_v1";
  const cached = await env.CACHE_KV.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
    });
  }

  try {
    // Try V3 first
    const data = await toastGet<any>(env, "/menus/v3/menus");
    const body = JSON.stringify({ ok: true, apiVersion: "v3", data });
    await env.CACHE_KV.put(cacheKey, body, { expirationTtl: 600 }); // 10 minutes
    return new Response(body, {
      headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  } catch (e: any) {
    const msg: string = e?.message || "";

    // Only fallback on 403/404 (permission/path). DO NOT fallback on 429 (rate limit).
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
        return Response.json(
          { ok: false, error: e2?.message || "Unknown error (v2 fallback)" },
          { status: 502 }
        );
      }
    }

    // If we were rate limited (429) or anything else, surface the error cleanly.
    const status = /failed:\s*(\d{3})\b/.exec(msg)?.[1] ?? "502";
    return Response.json({ ok: false, error: msg }, { status: Number(status) });
  }
}
