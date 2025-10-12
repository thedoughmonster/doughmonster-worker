// /src/lib/toastOrders.ts
// Path: src/lib/toastOrders.ts

import { paceBeforeToastCall } from "./pacer";
import { getAccessToken } from "./toastAuth";

type DetailMode = "ids" | "full";

type WindowOpts = {
  startISO: string;
  endISO: string;
  detail: DetailMode;
  debug?: boolean;
  where?: string;
  callerRoute?: string;
};

type Env = {
  TOAST_API_BASE: string;            // e.g. https://ws-api.toasttab.com
  TOAST_RESTAURANT_GUID: string;     // your restaurant guid (reused for external id)
};

function jres(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Build the expand parameter for “full” detail. */
function expandString(detail: DetailMode): string | undefined {
  if (detail !== "full") return undefined;
  return "checks,items,payments,discounts,serviceCharges,customers,employee";
}

/** Core: fetch orders for a single window */
export async function getOrdersWindow(env: Env, opts: WindowOpts):
  Promise<Response | { count: number; data: any[]; rawCount: number; debugSlices?: any[] }> {

  const { startISO, endISO, detail, debug, where, callerRoute } = opts;

  // Defensive: ensure we send strings, not objects
  if (typeof startISO !== "string" || typeof endISO !== "string") {
    return jres({
      ok: false,
      error: "Invalid time window; expected Toast ISO strings",
      route: callerRoute ?? null,
      where: where ?? null,
      receivedTypes: { startISO: typeof startISO, endISO: typeof endISO },
    }, 400);
  }

  await paceBeforeToastCall(env);

  const token = await getAccessToken(env as any);

  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const route = "/orders/v2/orders";

  const url = new URL(base + route);
  // Keep both header and query param; some tenants require one/both.
  url.searchParams.set("restaurantGuid", env.TOAST_RESTAURANT_GUID);
  url.searchParams.set("startDate", startISO);
  url.searchParams.set("endDate", endISO);
  const expand = expandString(detail);
  if (expand) url.searchParams.set("expand", expand);

  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/json");
  // Prefer the canonical header name
  headers.set("Toast-Restaurant-External-ID", env.TOAST_RESTAURANT_GUID);

  const res = await fetch(url.toString(), { method: "GET", headers });

  const retryAfter = res.headers.get("retry-after");
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!res.ok) {
    const bodyPreview = isJson ? await res.text() : await res.text();
    return jres({
      ok: false,
      error: "Toast /orders/v2/orders failed",
      status: res.status,
      route,
      url: url.toString(),
      headerUsed: "Toast-Restaurant-External-ID",
      externalIdLooksLikeUuid: /^[0-9a-f-]{36}$/i.test(env.TOAST_RESTAURANT_GUID),
      retryAfter: retryAfter ? parseInt(retryAfter, 10) : null,
      bodyPreview,
      where: where ?? null,
      callerRoute: callerRoute ?? null,
    }, res.status);
  }

  const payload: any = isJson ? await res.json() : await res.json();
  const list: any[] = Array.isArray(payload) ? payload : payload?.orders ?? [];
  const data = detail === "ids" ? list.map((o: any) => o?.guid ?? o?.id ?? null).filter(Boolean) : list;

  const debugSlice = debug
    ? [{
        sliceWindow: { start: startISO, end: endISO },
        toast: {
          route,
          url: url.toString(),
          headerUsed: "Toast-Restaurant-External-ID",
          expandUsed: expand ?? null,
          externalIdLooksLikeUuid: /^[0-9a-f-]{36}$/i.test(env.TOAST_RESTAURANT_GUID),
        },
        status: res.status,
        returned: list.length,
      }]
    : undefined;

  return {
    count: data.length,
    data,
    rawCount: list.length,
    ...(debugSlice ? { debugSlices: debugSlice } : {}),
  };
}

/**
 * Back-compat wrapper for code importing `getOrdersWindowFull`.
 * It simply calls getOrdersWindow with detail: "full".
 */
export async function getOrdersWindowFull(env: Env, opts: Omit<WindowOpts, "detail">) {
  return getOrdersWindow(env, { ...opts, detail: "full" });
}
