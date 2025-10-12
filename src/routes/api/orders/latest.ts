// /src/routes/api/orders/latest.ts
// Path: src/routes/api/orders/latest.ts

import { clampInt, nowToastIsoUtc, minusMinutesToastIsoUtc } from "../../../lib/time";
import { getOrdersWindow } from "../../../lib/toastOrders";

type Env = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

type LatestDetail = "full" | "ids";

/** Assert a value is a Toast ISO string: "YYYY-MM-DDTHH:mm:ss.SSS±HHmm" */
function assertToastIsoString(v: unknown, label: string): string {
  if (typeof v !== "string") {
    throw new Error(`Expected ${label} to be string, got ${Object.prototype.toString.call(v)} => ${String(v)}`);
  }
  // Basic format check; don’t over-constrain
  const ok = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/.test(v);
  if (!ok) throw new Error(`Invalid ${label} format, expected Toast ISO (±HHmm): ${v}`);
  return v;
}

/**
 * GET /api/orders/latest?minutes=30&detail=full|ids&debug=1
 * - minutes capped to [1..120], default 30
 * - detail=full (default) | ids
 * - responds with computed start/end + passthrough from getOrdersWindow
 */
export default async function handleOrdersLatest(env: Env, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const debug = url.searchParams.get("debug") === "1";
    const minutes = clampInt(url.searchParams.get("minutes"), 1, 120, 30);

    const detailParam = (url.searchParams.get("detail") || "full").toLowerCase();
    const detail: LatestDetail = detailParam === "ids" ? "ids" : "full";

    // 🔒 Compute Toast ISO strings (never Objects)
    // nowToastIsoUtc() returns a Toast ISO string with +0000
    const endISO = assertToastIsoString(nowToastIsoUtc(), "endISO");
    const startISO = assertToastIsoString(minusMinutesToastIsoUtc(minutes, endISO), "startISO");

    // Optional preflight debug (uncomment if you want zero-hit preview)
    // if (debug) {
    //   return json({ ok: true, route: "/api/orders/latest", minutes, detail, startISO, endISO, previewOnly: true });
    // }

    const result = await getOrdersWindow(env, {
      startISO,
      endISO,
      detail,
      debug,
      where: "orders-latest",
      callerRoute: "/api/orders/latest",
    });

    // If library already produces a Response, return it as-is
    if (result instanceof Response) return result;

    return json({
      ok: true,
      route: "/api/orders/latest",
      minutes,
      detail,
      startISO,
      endISO,
      ...result,
    });
  } catch (err: any) {
    return json(
      {
        ok: false,
        route: "/api/orders/latest",
        error: typeof err?.message === "string" ? err.message : String(err),
        stack: err?.stack,
      },
      500
    );
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
