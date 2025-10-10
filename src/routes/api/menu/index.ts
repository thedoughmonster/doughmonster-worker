// /src/routes/api/menu/index.ts
// Path: src/routes/api/menu/index.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";

export default async function handleMenu(env: EnvDeps, _request: Request): Promise<Response> {
  try {
    // v2 menus, paced at ~1 req/sec
    const data = await toastGet<any>(env, "/menus/v2/menus", undefined, {
      scope: "menu",
      minGapMs: 1100,
    });

    return Response.json({ ok: true, apiVersion: "v2", data });
  } catch (e: any) {
    const msg = e?.message || "Menu fetch failed";
    return Response.json({ ok: false, error: msg }, { status: 502 });
  }
}
