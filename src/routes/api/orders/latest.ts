// src/routes/api/orders/latest.ts
// Returns full Toast orders from the last ?minutes= (default 60, max 120)
// Adds rich debug with ?debug=1 to inspect shapes, keys, and samples.

import { jsonResponse } from "../../../lib/http";
import { getOrdersWindowFull } from "../../../lib/toastOrders";

type Bindings = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Toast format: yyyy-MM-dd'T'HH:mm:ss.SSSZ (UTC, +0000)
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

function looksLikeGuidArray(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every(v => typeof v === "string");
}

function topKeysOf(value: unknown, max = 20): string[] | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>).slice(0, max);
  }
  return null;
}

export default async function handleOrdersLatest(env: Bindings, request: Request) {
  try {
    const url = new URL(request.url);
    const minutesParam = url.searchParams.get("minutes");
    const minutes = clamp(Number(minutesParam ?? 60) || 60, 1, 120);
    const withDebug = url.searchParams.has("debug") || url.searchParams.get("debug") === "1";

    const now = new Date();
    const start = new Date(now.getTime() - minutes * 60_000);

    const startDateIso = toToastIsoUtc(start);
    const endDateIso = toToastIsoUtc(now);

    // Always fetch "full" – i.e., with expand=checks,items,payments,discounts,serviceCharges,customers,employee
    const res = await getOrdersWindowFull(env, {
      startDateIso,
      endDateIso,
      debugMeta: { callerRoute: "/api/orders/latest" },
    });

    // The library’s contract should be: { ids: string[], data: any[], slice?: any }
    // But if it still maps to GUIDs, our debug will make it obvious.
    const ids = Array.isArray(res?.ids) ? res.ids : [];
    const data = Array.isArray(res?.data) ? res.data : [];

    const count = data.length;
    const sample = count > 0 ? data[0] : null;
    const looksLikeIdsOnly = Array.isArray(data) && looksLikeGuidArray(data);
    const firstType = sample === null ? "null" : Array.isArray(sample) ? "array" : typeof sample;
    const firstKeys = topKeysOf(sample);

    const body: any = {
      ok: true,
      route: "/api/orders/latest",
      minutes,
      window: { start: startDateIso, end: endDateIso },
      detail: "full",
      // What we *intend* to use on the Toast request:
      expandUsed: [
        "checks",
        "items",
        "payments",
        "discounts",
        "serviceCharges",
        "customers",
        "employee",
      ],
      count,
      ids,
      data, // Expect full order objects here
    };

    if (withDebug) {
      body.debug = {
        lengths: { ids: ids.length, data: data.length },
        shapes: {
          dataArray: Array.isArray(data),
          looksLikeIdsOnly,
          firstType,
          firstKeys,
        },
        samples: {
          first: sample,
        },
        // Pass through lower-level toast/slice debugging if provided by lib:
        slice: res?.slice ?? null,
      };
    }

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
