// src/routes/api/orders/latest.ts
// Path: src/routes/api/orders/latest.ts

import { jsonResponse } from "../../../lib/http";
import { clampInt, nowToastIsoUtc, minusMinutesToastIsoUtc } from "../../../lib/time";
import { getOrdersWindow } from "../../../lib/toastOrders";

type Bindings = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

export default async function handleOrdersLatest(env: Bindings, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    // Lookback window (default 60, cap at 120)
    const minutes = clampInt(parseInt(url.searchParams.get("minutes") || "60", 10), 1, 120);

    // Full by default; opt out with ?lean=1
    const lean = url.searchParams.get("lean") === "1";
    const expand = lean
      ? undefined
      : ["checks", "items", "payments", "discounts", "serviceCharges", "customers", "employee"];

    const endIso = nowToastIsoUtc();
    const startIso = minusMinutesToastIsoUtc(minutes, endIso);

    const debug = url.searchParams.get("debug") === "1";

    const result = await getOrdersWindow(env, {
      startDateIso: startIso,
      endDateIso: endIso,
      expand,
      debugMeta: debug ? { callerRoute: "/api/orders/latest" } : undefined,
    });

    return jsonResponse({
      ok: true,
      route: "/api/orders/latest",
      minutes,
      window: { start: startIso, end: endIso },
      detail: lean ? "lean" : "full",
      expandUsed: expand ?? null,
      ...result, // includes data, count, raw/debugSlices from getOrdersWindow
    });
  } catch (err: any) {
    return jsonResponse(
      {
        ok: false,
        route: "/api/orders/latest",
        error: err?.message || String(err),
        stack: err?.stack,
      },
      { status: 500 }
    );
  }
}
