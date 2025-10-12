// src/lib/toastOrders.ts
// Single responsibility: hit Toast Orders v2 with a correct query.
// - Always pass startDate/endDate as Toast-formatted ISO strings (string, not objects)
// - Join expand[]=... into a comma-separated string
// - Send the Toast-Restaurant-External-ID header
// - Return rich debug so you can see exactly what was sent/received

import { getAccessToken } from "./toastAuth";

type Bindings = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

export type OrdersWindowOpts = {
  startDateIso: string;                // e.g. 2025-10-10T10:00:00.000+0000
  endDateIso: string;                  // e.g. 2025-10-10T11:00:00.000+0000
  expand?: string[];                   // e.g. ["checks","items","payments",...]
  debugMeta?: Record<string, unknown>; // optional: callerRoute, etc.
};

type ToastDebugSlice = {
  sliceWindow: { startDateIso: string; endDateIso: string; expand: string[] | null };
  toast: {
    route: string;
    url: string;
    headerUsed: "Toast-Restaurant-External-ID";
    expandUsed: string | null;
    externalIdLooksLikeUuid: boolean;
  };
  status: number;
  returned: number;
  error?: {
    status: number;
    url: string;
    responseHeaders: Record<string, string>;
    body: { json?: unknown; text?: string };
    message: string;
  };
};

export async function getOrdersWindow(
  env: Bindings,
  opts: OrdersWindowOpts
): Promise<{
  ok: true;
  ids: string[];
  data?: any[]; // present when expand was used (full orders)
  slice: ToastDebugSlice; // debug payload
}> {
  const route = "/orders/v2/orders";

  // Normalize input to plain strings
  const startDate = String(opts.startDateIso);
  const endDate = String(opts.endDateIso);
  const expandParam = opts.expand && opts.expand.length > 0 ? opts.expand.join(",") : undefined;

  const params = new URLSearchParams();
  // query param is fine; the header is the key requirement
  params.set("restaurantGuid", env.TOAST_RESTAURANT_GUID);
  params.set("startDate", startDate);
  params.set("endDate", endDate);
  if (expandParam) params.set("expand", expandParam);

  const url = `${env.TOAST_API_BASE}${route}?${params.toString()}`;

  const token = await getAccessToken(env);
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
  });

  const res = await fetch(url, { headers, method: "GET" });

  const debugSlice: ToastDebugSlice = {
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

  if (!res.ok) {
    let bodyJson: any = null;
    let bodyText: string | undefined;
    try {
      bodyJson = await res.json();
    } catch {
      try {
        bodyText = await res.text();
      } catch { /* ignore */ }
    }

    debugSlice.error = {
      status: res.status,
      url,
      responseHeaders: Object.fromEntries(res.headers.entries()),
      body: bodyJson ? { json: bodyJson } : { text: bodyText ?? "(no body)" },
      message: `Toast error ${res.status} on ${route}`,
    };

    // Throw a single-stringified error that routes can pass through
    throw new Error(
      JSON.stringify({
        ok: false,
        error: `Toast ${route} failed`,
        status: res.status,
        route,
        url,
        headerUsed: "Toast-Restaurant-External-ID",
        externalIdLooksLikeUuid: debugSlice.toast.externalIdLooksLikeUuid,
        bodyPreview: bodyJson ? JSON.stringify(bodyJson) : bodyText ?? "(no body)",
      })
    );
  }

  const json = (await res.json()) as any[];
  debugSlice.returned = Array.isArray(json) ? json.length : 0;

  const ids = Array.isArray(json) ? json.map((o) => o?.guid).filter(Boolean) : [];

  return {
    ok: true,
    ids,
    data: expandParam ? json : undefined, // only include full orders if expand requested
    slice: debugSlice,
  };
}

/**
 * Back-compat wrapper for existing routes that import `getOrdersWindowFull`.
 * It enforces `expand` to request full orders and always returns `data`.
 */
export async function getOrdersWindowFull(
  env: Bindings,
  opts: Omit<OrdersWindowOpts, "expand">
): Promise<{
  ok: true;
  ids: string[];
  data: any[];                // always present
  slice: ToastDebugSlice;
}> {
  const expand = [
    "checks",
    "items",
    "payments",
    "discounts",
    "serviceCharges",
    "customers",
    "employee",
  ];
  const res = await getOrdersWindow(env, { ...opts, expand });
  return {
    ok: true,
    ids: res.ids,
    data: res.data ?? [],
    slice: res.slice,
  };
}
