// /src/routes/api/menu/index.ts
// Path: src/routes/api/menu/index.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";

/**
 * Fetches the restaurant's full menu payload from Toast.
 * NOTE: If this 404/400s, we’ll read the error and adjust the path.
 * Common paths:
 * - /menus/v3/menus
 * - /configuration/v1/menus
 */
export default async function handleMenu(env: EnvDeps): Promise<Response> {
  try {
    // Try the v3 Menus API first; include the restaurant GUID as query if required.
    const data = await toastGet<any>(env, "/menus/v3/menus", {
      restaurantGuid: env.TOAST_RESTAURANT_GUID,
    });

    // Return as-is for now; we’ll shape it later when we define the frontend needs.
    return Response.json({ ok: true, data });
  } catch (e: any) {
    // Fallback attempt (uncomment if needed after testing)
    // try {
    //   const data = await toastGet<any>(env, "/configuration/v1/menus", {
    //     restaurantGuid: env.TOAST_RESTAURANT_GUID,
    //   });
    //   return Response.json({ ok: true, data, note: "from configuration/v1/menus" });
    // } catch {}

    return Response.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 502 });
  }
}
