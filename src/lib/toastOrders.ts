// /src/lib/toastOrders.ts
// Lines: 1-200 — Toast Orders helpers (IDs or full orders), with deep debug.

import { toastGet } from "./toastApi";
import { paceBeforeToastCall } from "./pacer";

export type OrdersOptions = {
  includeEmpty?: boolean;
  debug?: boolean;
  // When true we request expanded/full orders from Toast and return full objects instead of IDs.
  full?: boolean;
};

// Minimal shape we rely on. Toast returns much more; we pass through when full=true.
export type ToastOrderLite = { guid: string };
export type ToastOrderFull = Record<string, unknown>;

type SliceResult<T> = {
  status: number;
  returned: number;
  orders: T[];
  debug?: {
    route: string;
    url: string;
    headerUsed: "Toast-Restaurant-External-ID";
    expandUsed: string | null;
    externalIdLooksLikeUuid: boolean;
  };
};

const ROUTE = "/orders/v2/orders";

// Build the query used for each slice. Pure.
function buildQuery(
  restaurantGuid: string,
  startIso: string,
  endIso: string,
  expand: string | null
) {
  const base: Record<string, string> = {
    restaurantGuid,
    startDate: startIso,
    endDate: endIso,
  };
  if (expand) base.expand = expand;
  return base;
}

export async function getOrdersWindow(
  env: Env,
  startIso: string,
  endIso: string,
  opts: OrdersOptions = {}
): Promise<{
  count: number;
  ids: string[];
  slice: SliceResult<string>;
}> {
  const expand = null; // IDs-only mode
  await paceBeforeToastCall(env, ROUTE);

  const query = buildQuery(env.TOAST_RESTAURANT_GUID, startIso, endIso, expand);

  const res = await toastGet(env, ROUTE, query, {
    where: "orders-window",
    callerRoute: "internal:getOrdersWindow",
  });

  // res.data could be undefined if Toast returns 200 with empty array; normalize.
  const list = Array.isArray(res.data) ? (res.data as ToastOrderLite[]) : [];
  const ids = list
    .map((o) => o?.guid)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const slice: SliceResult<string> = {
    status: res.status ?? 200,
    returned: list.length,
    orders: ids,
    debug: opts.debug
      ? {
          route: ROUTE,
          url: res.url ?? "",
          headerUsed: "Toast-Restaurant-External-ID",
          expandUsed: expand,
          externalIdLooksLikeUuid:
            /^[0-9a-fA-F-]{36}$/.test(env.TOAST_RESTAURANT_GUID || ""),
        }
      : undefined,
  };

  return { count: ids.length, ids, slice };
}

export async function getOrdersWindowFull(
  env: Env,
  startIso: string,
  endIso: string,
  opts: OrdersOptions = {}
): Promise<{
  count: number;
  orders: ToastOrderFull[];
  slice: SliceResult<ToastOrderFull>;
}> {
  // Ask Toast for expanded/full orders.
  const expand =
    "checks,items,payments,discounts,serviceCharges,customers,employee";

  await paceBeforeToastCall(env, ROUTE);

  const query = buildQuery(env.TOAST_RESTAURANT_GUID, startIso, endIso, expand);

  const res = await toastGet(env, ROUTE, query, {
    where: "orders-window",
    callerRoute: "internal:getOrdersWindowFull",
  });

  const orders = Array.isArray(res.data) ? (res.data as ToastOrderFull[]) : [];

  const slice: SliceResult<ToastOrderFull> = {
    status: res.status ?? 200,
    returned: orders.length,
    orders,
    debug: opts.debug
      ? {
          route: ROUTE,
          url: res.url ?? "",
          headerUsed: "Toast-Restaurant-External-ID",
          expandUsed: expand,
          externalIdLooksLikeUuid:
            /^[0-9a-fA-F-]{36}$/.test(env.TOAST_RESTAURANT_GUID || ""),
        }
      : undefined,
  };

  return { count: orders.length, orders, slice };
}
