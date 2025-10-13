// src/routes/api/orders/latest.ts
// Fetch full Toast orders for the last ?minutes= (default 60, max 120) with expand.
// Add ?debug=1 to see detailed request/response diagnostics.

import { jsonResponse } from "../../../lib/http";
import { getAccessToken } from "../../../lib/toastAuth";

type Bindings = {
  TOAST_API_BASE: string;              // e.g. https://ws-api.toasttab.com
  TOAST_RESTAURANT_GUID: string;       // your restaurant GUID (already set as secret)
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Toast requires yyyy-MM-dd'T'HH:mm:ss.SSSZ with +0000 suffix for UTC
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
  return arr.length > 0 && arr.every((v) => typeof v === "string");
}

function topKeysOf(value: unknown, max = 20): string[] | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>).slice(0, max);
  }
  return null;
}

export default async function handleOrdersLatest(env: Bindings, request: Request) {
  const url = new URL(request.url);
  const minutesParam = url.searchParams.get("minutes");
  const minutes = clamp(Number(minutesParam ?? 60) || 60, 1, 120);
  const wantDebug = url.searchParams.has("debug") || url.searchParams.get("debug") === "1";

  try {
    // Build window
    const now = new Date();
    const start = new Date(now.getTime() - minutes * 60_000);
    const startDateIso = toToastIsoUtc(start);
    const endDateIso = toToastIsoUtc(now);

    // Toast expand list for "full" orders
    const expand = [
      "checks",
      "items",
      "payments",
      "discounts",
      "serviceCharges",
      "customers",
      "employee",
    ];

    // Build URL
    const base = env.TOAST_API_BASE.replace(/\/+$/, "");
    const route = "/orders/v2/orders";
    const qp = new URLSearchParams({
      restaurantGuid: env.TOAST_RESTAURANT_GUID,
      startDate: encodeURIComponent(startDateIso), // keep characters safe
      endDate: encodeURIComponent(endDateIso),
      expand: expand.join(","),
    });

    // NOTE: we encode ISO (contains +) once more to be super-safe in CF Worker URL construction
    const toastUrl = `${base}${route}?${qp.toString()}`;

    // Auth header
    const token = await getAccessToken(env);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      // Toast header accepts either kebab or pascal; using their doc style:
      "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
    };

    const resp = await fetch(toastUrl, { headers, method: "GET" });
    const status = resp.status;
    const text = await resp.text();

    // Try parse JSON but keep original text for debugging
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // leave json = null
    }

    if (!resp.ok) {
      // error path with max detail
      const body = {
        ok: false,
        route: "/api/orders/latest",
        minutes,
        window: { start: startDateIso, end: endDateIso },
        error: `Toast error ${status} on ${route}`,
        toast: {
          route,
          url: toastUrl,
          headerUsed: "Toast-Restaurant-External-ID",
          expandUsed: expand.join(","),
          responseStatus: status,
          responseHeaders: Object.fromEntries(resp.headers.entries()),
          bodyPreview: text?.slice(0, 1000) ?? null,
        },
      };
      return jsonResponse(body, { status });
    }

    // Success: Toast can return either a bare array or an object with an `orders` array.
    const dataArray = Array.isArray(json) ? json : Array.isArray(json?.orders) ? json.orders : [];
    const count = dataArray.length;
    const ids = dataArray.map((o: any) => o?.guid).filter(Boolean);

    const sample = count > 0 ? dataArray[0] : null;
    const firstType = sample === null ? "null" : Array.isArray(sample) ? "array" : typeof sample;
    const firstKeys = topKeysOf(sample);

    const body: any = {
      ok: true,
      route: "/api/orders/latest",
      minutes,
      window: { start: startDateIso, end: endDateIso },
      detail: "full",
      expandUsed: expand,
      count,
      ids,
      orders: dataArray, // full order objects here
    };

    if (wantDebug) {
      body.debug = {
        request: {
          route,
          url: toastUrl,
          headerUsed: "Toast-Restaurant-External-ID",
        },
        lengths: { ids: ids.length, orders: dataArray.length },
        shapes: {
          dataIsArray: Array.isArray(json),
          wrappedOrdersArray: Array.isArray(json?.orders),
          looksLikeIdsOnly: looksLikeGuidArray(dataArray),
          firstType,
          firstKeys,
        },
        samples: {
          first: sample,
        },
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
