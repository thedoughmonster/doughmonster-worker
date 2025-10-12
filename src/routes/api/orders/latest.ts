// src/routes/api/orders/latest.ts
// Returns full Toast orders from the last ?minutes= (default 60, max 120)
// Response includes both order IDs and full order objects, plus rich debug.

import { jsonResponse } from "../../../lib/http";
import { getOrdersWindowFull } from "../../../lib/toastOrders";

type Bindings = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Toast expects: yyyy-MM-dd'T'HH:mm:ss.SSSZ (e.g. 2025-10-10T14:13:12.000+0000)
// We format in UTC with +0000.
function toToastIsoUtc(d: Date): string {
  const pad = (x: number, len = 2) => String(x).padStart(len, "0");
  const yyyy = d.getUTCFullYear();
  const MM = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const HH = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  const mmm = pad(d.getUTCMilliseconds(), 3);
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.${mmm}+0000`;
}

export default async function handleOrdersLatest(env: Bindings, request: Request) {
  try {
    const url = new URL(request.url);
    const minutesParam = url.searchParams.get("minutes");
    const detail = (url.searchParams.get("detail") || "full").toLowerCase();
    const minutes = clamp(Number(minutesParam ?? 60) || 60, 1, 120);
    const withDebug = url.searchParams.has("debug") || url.searchParams.get("debug") === "1";

    const now = new Date();
    const start = new Date(now.getTime() - minutes * 60_000);

    const startDateIso = toToastIsoUtc(start);
    const endDateIso = toToastIsoUtc(now);

    // Always fetch full orders for this endpoint.
    const res = await getOrdersWindowFull(env, {
      startDateIso,
      endDateIso,
      debugMeta: { callerRoute: "/api/orders/latest" },
    });

    const body: any = {
      ok: true,
      route: "/api/orders/latest",
      minutes,
      window: { start: startDateIso, end: endDateIso },
      detail: "full",
      expandUsed: [
        "checks",
        "items",
        "payments",
        "discounts",
        "serviceCharges",
        "customers",
        "employee",
      ],
      count: Array.isArray(res.data) ? res.data.length : 0,
      ids: res.ids,
      data: res.data, // full order objects
    };

    if (withDebug) body.slice = res.slice;

    return jsonResponse(body);
  } catch (err: any) {
    const msg =
      typeof err?.message === "string" ? err.message : (err ? String(err) : "Unknown error");
    return jsonResponse(
      {
        ok: false,
        route: "/api/orders/latest",
        error: msg,
      },
      { status: 500 }
    );
  }
}
