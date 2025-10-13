// /src/routes/api/menu/metadata.ts
// Path: src/routes/api/menu/metadata.ts

import type { ToastApiEnv } from "../../../lib/env";
import { toastGet } from "../../../lib/toastApi";

/**
 * GET /api/menu/metadata
 * Fetches Toast menu metadata (v3, falls back to v2).
 * Uses default (global) pacing.
 */
export default async function handleMenuMetadata(env: ToastApiEnv): Promise<Response> {
  try {
    try {
      const data = await toastGet<any>(env, "/menus/v3/metadata");
      return Response.json({ ok: true, apiVersion: "v3", data });
    } catch (e: any) {
      const msg: string = e?.message || "";
      const fallback = /failed:\s*(403|404)\b/.test(msg);
      if (!fallback) throw e;

      const dataV2 = await toastGet<any>(env, "/menus/v2/metadata");
      return Response.json({ ok: true, apiVersion: "v2", data: dataV2 });
    }
  } catch (e: any) {
    const status = Number(/failed:\s*(\d{3})\b/.exec(e?.message || "")?.[1] ?? "502");
    return Response.json({ ok: false, error: e?.message || "Metadata fetch failed" }, { status });
  }
}
