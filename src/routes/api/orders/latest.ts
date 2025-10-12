// /src/routes/api/orders/latest.ts
// Path: src/routes/api/orders/latest.ts

import { nowToastIsoUtc, minusMinutesToastIsoUtc, clampInt } from "../../../lib/time";
import { getOrdersWindow } from "../../../lib/toastOrders";

type Env = {
  TOAST_RESTAURANT_GUID: string;
};

/** Small JSON helper (no double-stringify). */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * GET /api/orders/latest?minutes=30&detail=full|ids&debug=1
 * - minutes: how far back from "now" to look (default 30, 1..120)
 * - detail:  "full" (expanded orders) or "ids" (just GUIDs), default "full"
 * - debug:   include per-slice diagnostics
 */
export default async function handleOrdersLatest(env: Env, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const minutes = clampInt(url.searchParams.get("minutes"), 1, 120, 30);
    const detail = (url.searchParams.get("detail") === "ids" ? "ids" : "full") as "ids" | "full";
    const debug = url.searchParams.get("debug") === "1";

    // Build ISO strings (must be strings, not Date objects)
    const endISO = nowToastIsoUtc();                 // e.g. 2025-10-12T13:37:42.123+0000
    const startISO = minusMinutesToastIsoUtc(minutes, endISO);

    // Call the window fetcher. It returns either a Response (on error) or a data object on success.
    const result = await getOrdersWindow(env as any, {
      startISO,
      endISO,
      detail,
      debug,
      where: "orders-latest",
      callerRoute: "/api/orders/latest",
    });

    // If getOrdersWindow returned a Response, forward it as-is (already proper JSON/no extra escaping).
    if (result instanceof Response) return result;

    // Success shape
    return json({
      ok: true,
      route: "/api/orders/latest",
      minutes,
      window: { start: startISO, end: endISO },
      detail,
      count: result.count,
      data: result.data,
      rawCount: result.rawCount,
      ...(debug ? { debugSlices: result.debugSlices } : {}),
    });
  } catch (err: any) {
    // Clean error object; do not stringfy nested JSON again.
    return json(
      {
        ok: false,
        route: "/api/orders/latest",
        error: err?.message ?? String(err),
        stack: err?.stack ?? null,
      },
      500
    );
  }
}
