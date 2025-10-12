// src/lib/toastOrders.ts
// Path: src/lib/toastOrders.ts
//
// Single responsibility: hit Toast Orders v2 with a correct query.
// - Always pass startDate/endDate as ISO strings (Toast format)
// - Join expand[]=... into a comma-separated string
// - Send the Toast-Restaurant-External-ID header
// - Return rich debug so you can see exactly what was sent/received

import { getAccessToken } from "./toastAuth";

type Bindings = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

type OrdersWindowOpts = {
  startDateIso: string;                // e.g. 2025-10-10T10:00:00.000+0000
  endDateIso: string;                  // e.g. 2025-10-10T11:00:00.000+0000
  expand?: string[];                   // e.g. ["checks","items","payments",...]
  debugMeta?: Record<string, unknown>; // optional: callerRoute, etc.
};

/**
 * Core call: fetch orders for a window.
 * Returns IDs and (if expand provided) the raw orders array.
 */
export async function getOrdersWindow(
  env: Bindings,
  opts: OrdersWindowOpts
): Promise<{
  ok: true;
  ids: string[];
  data?: any[]; // present when expand is used (full orders)
  slice: any;   // debug payload for observability
}> {
  const route = "/orders/v2/orders";

  // Validate/normalize inputs early
  const startDate = String(opts.startDateIso);
  const endDate = String(opts.endDateIso);
  const expandParam = opts.expand && opts.expand.length > 0 ? opts.expand.join(",") : undefined;

  const params = new URLSearchParams();
  // You *can* include restaurantGuid in query; header is the critical one though.
  params.set("restaurantGuid", env.TOAST_RESTAURANT_GUID);
  params.set("startDate", startDate);
  params.set("endDate", endDate);
  if (expandParam) params.set("expand", expandParam);

  const url = `${env.TOAST_API_BASE}${route}?${params.toString()}`;

  const token = await getAccessToken(env);
  const headers = new Headers({
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    // Header name Toast expects:
    "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
  });

  // Perform the request
  const res = await fetch(url, { headers, method: "GET" });

  // Build an always-useful debug slice
  const debugSlice: any = {
    sliceWindow: { startDateIso: startDate, endDateIso: endDate, expand: opts.expand ?? null },
    toast: {
      route,
      url,
      headerUsed: "Toast-Restaurant-External-ID",
      expandUsed: expandParam ?? null,
      externalIdLooksLikeUuid: /^[0-9a-f-]{36}$/i.test(env.TOAST_RESTAURANT_GUID),
    },
    status: res.status,
    returned: 0,
  };

  // Handle non-2xx with a clear, non-double-stringified error
  if (!res.ok) {
    let bodyJson: any = null;
    try {
      bodyJson = await res.json();
    } catch {
      // ignore JSON parse errors (could be HTML)
    }
    debugSlice.error = {
      status: res.status,
      url,
      responseHeaders: Object.fromEntries(res.headers.entries()),
      body: bodyJson ? { json: bodyJson } : { text: await res.text() },
      message: `Toast error ${res.status} on ${route}`,
    };

    // Return a 400-series as a structured failure to caller (routes add their own Response wrapper)
    return Promise.reject(
      new Error(
        JSON.stringify({
          ok: false,
          error: `Toast ${route} failed`,
          status: res.status,
          route,
          url,
          headerUsed: "Toast-Restaurant-External-ID",
          externalIdLooksLikeUuid: debugSlice.toast.externalIdLooksLikeUuid,
          bodyPreview: bodyJson ? JSON.stringify(bodyJson) : "(non-JSON body)",
        })
      )
    );
  }

  const json = (await res.json()) as any[];
  debugSlice.returned = Array.isArray(json) ? json.length : 0;

  // IDs list
  const ids = Array.isArray(json) ? json.map((o) => o?.guid).filter(Boolean) : [];

  return {
    ok: true,
    ids,
    // When expand was requested we presume full order bodies are wanted
    data: expandParam ? json : undefined,
    slice: debugSlice,
  };
}
