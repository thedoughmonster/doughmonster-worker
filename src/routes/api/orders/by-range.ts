// /src/routes/api/orders/by-range.ts
// Path: src/routes/api/orders/by-range.ts

import { paceBeforeToastCall } from "../../../lib/pacer";
import { buildIsoWindowSlices } from "../../../lib/time";
import { getOrdersWindow, getOrdersWindowFull } from "../../../lib/toastOrders";
import { MAX_SLICES_PER_REQUEST } from "../../../config/orders";

/**
 * GET /api/orders/by-range
 *   ?start=YYYY-MM-DDTHH:mm:ss.SSS±HHmm
 *   &end=YYYY-MM-DDTHH:mm:ss.SSS±HHmm
 *   [&detail=full|ids]   // default: full (ordersBulk). ids => GUIDs (orders)
 *   [&debug=1]
 *
 * Notes:
 * - We don’t parse dates server-side beyond building 60m slices.
 * - Hard cap: max 2 slices (<= 2 hours).
 */
export default async function handleOrdersByRange(env: any, request: Request): Promise<Response> {
  const ROUTE = "/api/orders/by-range";
  try {
    const url = new URL(request.url);
    const startISO = url.searchParams.get("start");
    const endISO = url.searchParams.get("end");
    const detail = (url.searchParams.get("detail") as "full" | "ids") || "full";
    const includeDebug = url.searchParams.get("debug") === "1";

    if (!startISO || !endISO) {
      return j(400, {
        ok: false,
        route: ROUTE,
        error: "Missing required 'start' and/or 'end' parameters (ISO with offset, e.g. 2025-10-10T06:00:00.000-0400)",
      });
    }

    // Build 60-minute slices. This validates ordering & creates the loop inputs.
    const slices = buildIsoWindowSlices(startISO, endISO, 60);
    if (slices.length === 0) {
      return j(400, {
        ok: false,
        route: ROUTE,
        error: "Invalid range; 'end' must be after 'start'.",
      });
    }
    if (slices.length > MAX_SLICES_PER_REQUEST) {
      return j(400, {
        ok: false,
        route: ROUTE,
        error: "Requested window too large; max 2 hours per request.",
        limitHours: MAX_SLICES_PER_REQUEST,
        slices: slices.length,
      });
    }

    const out: any[] = [];
    const debugSlices: any[] = [];
    let requests = 0;

    for (const win of slices) {
      const { start, end } = win;
      await paceBeforeToastCall("orders", 1100);

      try {
        const res =
          detail === "full"
            ? await getOrdersWindowFull(env, start, end) // /ordersBulk
            : await getOrdersWindow(env, start, end);    // /orders (GUIDs)

        requests++;
        if (Array.isArray(res?.data)) out.push(...res.data);

        if (includeDebug) {
          debugSlices.push({
            sliceWindow: { start, end },
            toast: res?.debug ?? null,
            status: res?.status ?? null,
            returned: Array.isArray(res?.data) ? res!.data.length : 0,
          });
        }
      } catch (e: any) {
        // We throw JSON-stringified errors from lib; try to parse for great diagnostics.
        try {
          const parsed = JSON.parse(e?.message ?? "");
          return j(502, { ...parsed, where: "orders-window", callerRoute: ROUTE });
        } catch {
          return j(502, {
            ok: false,
            route: ROUTE,
            where: "orders-window",
            error: e?.message || String(e),
            window: { start, end },
          });
        }
      }
    }

    const body: any = {
      ok: true,
      route: ROUTE,
      start: startISO,
      end: endISO,
      detail,
      slices: slices.length,
      requests,
      count: out.length,
      data: out,
    };
    if (includeDebug) body.debugSlices = debugSlices;

    return j(200, body);
  } catch (err: any) {
    return j(500, {
      ok: false,
      route: "/api/orders/by-range",
      where: "unhandled",
      error: err?.message || String(err),
    });
  }
}

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
