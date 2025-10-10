// /src/routes/api/menu/index.ts
// Path: src/routes/api/menu/index.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";

/**
 * Fetch menus. Try V3 first; on 403/404, fall back to V2.
 */
export default async function handleMenu(env: EnvDeps): Promise<Response> {
  try {
    // Recommended flow: check metadata first to avoid heavy pulls (optional)
    // const meta = await toastGet<any>(env, "/menus/v3/metadata");
    // Then fetch menus if needed:
    const data = await toastGet<any>(env, "/menus/v3/menus");
    return Response.json({ ok: true, apiVersion: "v3", data });
  } catch (e: any) {
    const msg: string = e?.message || "";
    const shouldFallback = /failed:\s*(403|404)\b/.test(msg);

    if (shouldFallback) {
      try {
        const dataV2 = await toastGet<any>(env, "/menus/v2/menus");
        return Response.json({ ok: true, apiVersion: "v2", data: dataV2 });
      } catch (e2: any) {
        return Response.json(
          { ok: false, error: e2?.message || "Unknown error (v2 fallback)" },
          { status: 502 }
        );
      }
    }

    return Response.json({ ok: false, error: msg || "Unknown error" }, { status: 502 });
  }
}
