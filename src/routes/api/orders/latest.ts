// /src/routes/api/orders/latest.ts
// Path: src/routes/api/orders/latest.ts

import { nowToastIsoUtc, minusMinutesToastIsoUtc, clampInt } from "../../../lib/time";
import { getOrdersWindow } from "../../../lib/toastOrders";

type Env = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

function asToastIsoString(v: unknown, label: string): string {
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().replace("Z", "+0000");
  // Final fallback — stringify and *throw* so we see it in logs
  throw new Error(`Expected ${label} to be Toast ISO string, got: ${Object.prototype.toString.call(v)} -> ${String(v)}`);
}

/**
 * GET /api/orders/latest?minutes=30&detail=full|ids&debug=1
 * - Caps minutes to [1..120]
 * - detail=full (default) returns expanded orders; detail=ids returns only IDs
 * - Debug echoes computed window so we can see exactly what we send
 */
export default async function handleOrdersLatest(env: Env, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const debug = url.searchParams.get("debug") === "1";
    const minutes = clampInt(url.searchParams.get("minutes"), 1, 120, 30);
    const detailParam = (url.searchParams.get("detail") || "full").toLowerCase();
    const detail: "full" | "ids" = detailParam === "ids" ? "ids" : "full";

    // Compute window as *strings* (force-cast defensively)
    const endISO = asToastIsoString(nowToastIsoUtc(), "endISO");
    const startISO = asToastIsoString(minusMinutesToastIsoUtc(minutes, endISO), "startISO");

    // Optional early debug preview (no network) — toggle by uncommenting:
    // if (debug) {
    //   return new Response(JSON.stringify({ ok: true, route: "/api/orders/latest", minutes, detail, startISO, endISO }), {
    //     status: 200,
    //     headers: { "content-type": "application/json" },
    //   });
    // }

    const result = await getOrdersWindow(env, {
      startISO,
      endISO,
      detail,
      debug,
      where: "orders-latest",
      callerRoute: "/api/orders/latest",
    });

    // If library already returns a Response, pass it through
    if (result instanceof Response) return result;

    // Otherwise, normalize to a JSON response
    return new Response(
      JSON.stringify({
        ok: true,
        route: "/api/orders/latest",
        minutes,
        detail,
        startISO,
        endISO,
        ...result,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : String(err);
    return new Response(
      JSON.stringify({
        ok: false,
        route: "/api/orders/latest",
        error: msg,
        stack: err?.stack,
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
