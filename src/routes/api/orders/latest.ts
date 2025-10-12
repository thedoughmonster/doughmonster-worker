// src/routes/api/orders/latest.ts
import { jsonResponse } from "../../../lib/http";
import { clampInt } from "../../../lib/time";
import { getOrdersWindow } from "../../../lib/toastOrders";
import { nowToastIsoUtc } from "../../../lib/time/now";
import { minusMinutesToastIsoUtc } from "../../../lib/time/minus";

type Bindings = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

export default async function handleOrdersLatest(env: Bindings, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    // windowMinutes: how far back to look (default 60, max 120 per your constraint)
    const windowMinutesRaw = url.searchParams.get("minutes");
    const windowMinutes = clampInt(windowMinutesRaw ? parseInt(windowMinutesRaw, 10) : 60, 1, 120);

    // full-by-default; allow lean via ?lean=1
    const lean = url.searchParams.get("lean") === "1";
    const expand = lean
      ? undefined
      : ["checks","items","payments","discounts","serviceCharges","customers","employee"];

    const nowIso = nowToastIsoUtc();
    const startIso = minusMinutesToastIsoUtc(windowMinutes, nowIso);
    const debug = url.searchParams.get("debug") === "1";

    const result = await getOrdersWindow(env, {
      startDateIso: startIso,
      endDateIso: nowIso,
      expand,
      debugMeta: debug ? { callerRoute: "/api/orders/latest" } : undefined,
    });

    return jsonResponse({
      ok: true,
      route: "/api/orders/latest",
      windowMinutes,
      startIso,
      endIso: nowIso,
      expandUsed: expand ?? null,
      ...result
    });
  } catch (err: any) {
    return jsonResponse(
      { ok: false, route: "/api/orders/latest", error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
