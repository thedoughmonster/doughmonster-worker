// /src/lib/toastOrders.ts
// Path: src/lib/toastOrders.ts
// Thin wrappers around /orders/v2/orders with strict start/end usage and rich debug.

import { toastGet } from "./toastApi";
import { paceBeforeToastCall } from "./pacer";

type DebugFlag = boolean | undefined;

export interface SliceMeta {
  route: "/orders/v2/orders";
  url: string;
  headerUsed: "Toast-Restaurant-External-ID";
  expandUsed: string | null;
  externalIdLooksLikeUuid: boolean;
}

export interface WindowSliceDebug {
  sliceWindow: { start: string; end: string };
  toast: SliceMeta;
  status: number;
  returned: number;
  error?: unknown;
}

function looksLikeUuid(id: string | undefined): boolean {
  return !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function compactIds(arr: unknown[]): string[] {
  const out: string[] = [];
  for (const x of arr) {
    if (x && typeof x === "object") {
      const any = x as any;
      const id = any.guid ?? any.id ?? any.orderGuid ?? any.orderId;
      if (typeof id === "string") out.push(id);
    }
  }
  return out;
}

function ensureEndInclusive(endIso: string): string {
  // Toast accepts either HH:mm:ss.SSSZ; we send precise end (already correct if caller sliced).
  return endIso;
}

async function doOrdersFetch(
  env: Env,
  startIso: string,
  endIso: string,
  expand: string | null,
  debug?: DebugFlag
) {
  await paceBeforeToastCall(env, "/orders/v2/orders"); // global pacer

  const query = {
    restaurantGuid: env.TOAST_RESTAURANT_GUID,
    startDate: startIso,
    endDate: ensureEndInclusive(endIso),
    ...(expand ? { expand } : {}),
  };

  const res = await toastGet(env, "/orders/v2/orders", query, { debug });

  return res;
}

export async function getOrdersWindow(
  env: Env,
  startIso: string,
  endIso: string,
  opts: { debug?: DebugFlag } = {}
): Promise<{ ids: string[]; slice: WindowSliceDebug }> {
  const expand = null; // id-only fast path
  const res = await doOrdersFetch(env, startIso, endIso, expand, opts.debug);

  const meta: SliceMeta = {
    route: "/orders/v2/orders",
    url: (res as any).url,
    headerUsed: "Toast-Restaurant-External-ID",
    expandUsed: expand,
    externalIdLooksLikeUuid: looksLikeUuid(env.TOAST_RESTAURANT_GUID),
  };

  if (!res.ok) {
    return {
      ids: [],
      slice: {
        sliceWindow: { start: startIso, end: endIso },
        toast: meta,
        status: res.status,
        returned: 0,
        error: {
          status: res.status,
          url: res.url,
          responseHeaders: res.responseHeaders,
          body: res.body ?? null,
          message: res.error,
        },
      },
    };
  }

  const payload = (res.json as any) ?? { orders: [] };
  const orders = Array.isArray(payload) ? payload : payload.orders ?? [];
  const ids = compactIds(orders);
  return {
    ids,
    slice: {
      sliceWindow: { start: startIso, end: endIso },
      toast: meta,
      status: res.status,
      returned: ids.length,
    },
  };
}

export async function getOrdersWindowFull(
  env: Env,
  startIso: string,
  endIso: string,
  opts: { debug?: DebugFlag } = {}
): Promise<{ orders: unknown[]; slice: WindowSliceDebug }> {
  // “Full” include fields typically needed for analytics/receipts
  const expand =
    "checks,items,payments,discounts,serviceCharges,customers,employee";
  const res = await doOrdersFetch(env, startIso, endIso, expand, opts.debug);

  const meta: SliceMeta = {
    route: "/orders/v2/orders",
    url: (res as any).url,
    headerUsed: "Toast-Restaurant-External-ID",
    expandUsed: expand,
    externalIdLooksLikeUuid: looksLikeUuid(env.TOAST_RESTAURANT_GUID),
  };

  if (!res.ok) {
    return {
      orders: [],
      slice: {
        sliceWindow: { start: startIso, end: endIso },
        toast: meta,
        status: res.status,
        returned: 0,
        error: {
          status: res.status,
          url: res.url,
          responseHeaders: res.responseHeaders,
          body: res.body ?? null,
          message: res.error,
        },
      },
    };
  }

  const payload = (res.json as any) ?? { orders: [] };
  const orders = Array.isArray(payload) ? payload : payload.orders ?? [];
  return {
    orders,
    slice: {
      sliceWindow: { start: startIso, end: endIso },
      toast: meta,
      status: res.status,
      returned: Array.isArray(orders) ? orders.length : 0,
    },
  };
}
