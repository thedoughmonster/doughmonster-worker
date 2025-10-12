// /src/routes/api/orders/latest.ts
// Path: src/routes/api/orders/latest.ts

import { nowToastIsoUtc, minusMinutesToastIsoUtc, clampInt } from "../../../lib/time";
import { getOrdersWindow } from "../../../lib/toastOrders";

type Env = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

/**
 * GET /api/orders/latest?minutes=30&detail=full|ids&debug=1
 * - Caps minutes to [1..120] (you said you never need > 2 hours)
 * - Defaults to full orders via ordersBulk (detail=full)
 * - Includes debug slices when ?debug=1
 */
export default async function handleOrdersLatest(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "1";

  // minutes: default 30, clamp to [1..120]
  const minutes = clampInt(url.searchParams.get("minutes"), 1, 120, 30);

  // detail: "full" (default) or "ids"
  const detailParam = (url.searchParams.get("detail") || "full").toLowerCase();
  const detail: "full" | "ids" = detailParam === "ids" ? "ids" : "full";

  // Build UTC Toast ISO window [now - minutes, now]
  const endISO = nowToastIsoUtc();
  const startISO = minusMinutesToastIsoUtc(minutes, endISO);

  const result = await getOrdersWindow(env, {
    startISO,
    endISO,
    detail,          // "full" uses ordersBulk; "ids" uses the light path
    debug,
    where: "orders-latest",
    callerRoute: "/api/orders/latest",
  });

  // result already comes back as a Response in the existing lib
  if (result instanceof Response) return result;

  // If your getOrdersWindow returns a data object instead, normalize it:
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
