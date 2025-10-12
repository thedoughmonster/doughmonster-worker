// /src/lib/toastOrders.ts
// Path: src/lib/toastOrders.ts

import { buildIsoWindowSlices } from "./time";

type Env = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

type Detail = "full" | "ids";

type OrdersWindowArgs = {
  startISO: string; // Toast ISO string "YYYY-MM-DDTHH:mm:ss.SSS±HHmm"
  endISO: string;   // Toast ISO string "YYYY-MM-DDTHH:mm:ss.SSS±HHmm"
  detail: Detail;   // "full" (expanded) or "ids"
  debug?: boolean;
  where?: string;        // label for logs
  callerRoute?: string;  // label for logs
};

function assertToastIso(label: string, v: unknown): string {
  if (typeof v !== "string") throw new Error(`${label} must be string, got ${Object.prototype.toString.call(v)} => ${String(v)}`);
  const ok = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/.test(v);
  if (!ok) throw new Error(`${label} is not Toast ISO (±HHmm): ${v}`);
  return v;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Call Toast Orders v2 across a window, respecting the 1-hour-per-request limit.
 * - Uses query param `restaurantGuid` AND header `Toast-Restaurant-External-ID` (uuid).
 * - Adds &expand=... when detail === "full".
 * - Serializes start/end strictly as strings so we never leak [object Object].
 */
export async function getOrdersWindow(env: Env, args: OrdersWindowArgs): Promise<Response | {
  count: number;
  data: any[];           // flattened list (ids or full orders depending on detail)
  rawCount: number;      // sum of per-slice returned lengths
  debugSlices?: any[];
}> {
  const { TOAST_API_BASE, TOAST_RESTAURANT_GUID } = env;
  const startISO = assertToastIso("startISO", args.startISO);
  const endISO = assertToastIso("endISO", args.endISO);
  const detail: Detail = args.detail === "ids" ? "ids" : "full";
  const debug = !!args.debug;

  const slices = buildIsoWindowSlices(startISO, endISO);

  const debugSlices: any[] = [];
  const aggregated: any[] = [];
  let rawCount = 0;

  // Build common headers once
  const headers: Record<string, string> = {
    accept: "application/json",
    // Toast wants *this exact* header name, case-insensitive on their end, but we use canonical form
    "Toast-Restaurant-External-ID": TOAST_RESTAURANT_GUID,
  };

  // We rely on upstream auth layer to inject Bearer via fetch binding or via global wrapper.
  // If you’re setting auth here, add `authorization` to headers before fetch.

  // Optional expansion for "full"
  const expand = detail === "full"
    ? "checks,items,payments,discounts,serviceCharges,customers,employee"
    : undefined;

  for (const { startISO: s, endISO: e } of slices) {
    const url = new URL(`${TOAST_API_BASE.replace(/\/+$/, "")}/orders/v2/orders`);
    url.searchParams.set("restaurantGuid", TOAST_RESTAURANT_GUID);
    url.searchParams.set("startDate", s);
    url.searchParams.set("endDate", e);
    if (expand) url.searchParams.set("expand", expand);

    const res = await fetch(url.toString(), { headers });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* keep text in debug */ }

    if (debug) {
      debugSlices.push({
        sliceWindow: { start: s, end: e },
        toast: {
          route: "/orders/v2/orders",
          url: url.toString(),
          headerUsed: "Toast-Restaurant-External-ID",
          hasAuthHeader: typeof headers["authorization"] === "string",
        },
        status: res.status,
        returned: Array.isArray(body) ? body.length : Array.isArray(body?.orders) ? body.orders.length : (body?.results?.length ?? 0),
        bodyPreview: typeof body === "string" ? body : (text?.slice(0, 300) ?? null),
      });
    }

    if (!res.ok) {
      // Normalize the same error structure we log elsewhere
      return json({
        ok: false,
        error: "Toast /orders/v2/orders failed",
        status: res.status,
        route: "/orders/v2/orders",
        url: url.toString(),
        headerUsed: "Toast-Restaurant-External-ID",
        externalIdLooksLikeUuid: /^[0-9a-f-]{36}$/i.test(TOAST_RESTAURANT_GUID),
        bodyPreview: text?.slice(0, 500),
        where: args.where ?? null,
        callerRoute: args.callerRoute ?? null,
      }, res.status);
    }

    // Body shape can vary: sometimes an array, sometimes { orders: [] }, sometimes { results: [] }
    const list: any[] =
      Array.isArray(body) ? body :
      Array.isArray(body?.orders) ? body.orders :
      Array.isArray(body?.results) ? body.results :
      [];

    rawCount += list.length;

    if (detail === "ids") {
      for (const o of list) {
        const id = o?.guid ?? o?.id ?? o?.orderGuid ?? null;
        if (typeof id === "string") aggregated.push(id);
      }
    } else {
      aggregated.push(...list);
    }
  }

  return {
    count: aggregated.length,
    data: aggregated,
    rawCount,
    ...(debug ? { debugSlices } : null),
  };
}
