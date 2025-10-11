// /src/lib/toastOrders.ts
// Path: src/lib/toastOrders.ts

import { getAccessToken } from "./toastAuth";
import { paceBeforeToastCall } from "./pacer";

/** mask a token/id for logs */
function mask(val: string | undefined | null, keepStart = 8, keepEnd = 6): string {
  if (!val) return "<empty>";
  const s = String(val);
  if (s.length <= keepStart + keepEnd) return s.replace(/./g, "•");
  return `${s.slice(0, keepStart)}…${s.slice(-keepEnd)}`;
}

/** quick uuid-ish check */
function looksLikeUuid(v: string | undefined | null): boolean {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type Env = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

export type OrdersWindowDebug = {
  sliceWindow: { start: string; end: string };
  toast: {
    route: string;
    url: string;
    headerUsed: "Toast-Restaurant-External-ID";
  };
  status: number | null;
  returned: number;
};

export type OrdersWindowResult = {
  data: any[];
  status?: number;
  debug?: {
    route: string;
    url: string;
    headerUsed: "Toast-Restaurant-External-ID";
    externalIdLooksLikeUuid: boolean;
    expandUsed?: string;
  };
};

/**
 * IDs mode: /orders/v2/orders — usually returns GUIDs (even with expand).
 * We keep this to avoid breaking existing callers.
 */
export async function getOrdersWindow(
  env: Env,
  startToast: string,
  endToast: string,
  expand?: string[] | undefined
): Promise<OrdersWindowResult> {
  const route = "/orders/v2/orders";
  const base = env.TOAST_API_BASE;
  const restaurantGuid = env.TOAST_RESTAURANT_GUID;

  await paceBeforeToastCall("orders", 900);

  const token = await getAccessToken(env);

  const url = new URL(route, base);
  url.searchParams.set("restaurantGuid", restaurantGuid);
  url.searchParams.set("startDate", startToast);
  url.searchParams.set("endDate", endToast);
  if (expand && expand.length) url.searchParams.set("expand", expand.join(","));

  const headerName = "Toast-Restaurant-External-ID";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    [headerName]: restaurantGuid,
  };

  const reqDebug = {
    route,
    url: url.toString(),
    headerUsed: headerName as const,
    externalIdLooksLikeUuid: looksLikeUuid(restaurantGuid),
    expandUsed: expand?.join(","),
  };

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers });
  } catch (e: any) {
    throw new Error(
      JSON.stringify({ ok: false, where: "network", ...reqDebug, error: e?.message || String(e) })
    );
  }

  const status = res.status;
  const text = await res.text();

  if (status === 429) {
    throw new Error(
      JSON.stringify({
        ok: false,
        error: "Toast rate limit (429)",
        retryAfter: Number(res.headers.get("retry-after") || "1"),
        ...reqDebug,
        status,
      })
    );
  }

  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(JSON.stringify({ ok: false, error: "Non-JSON response", ...reqDebug, status }));
  }

  if (!res.ok) {
    throw new Error(
      JSON.stringify({
        ok: false,
        error: `Toast ${route} failed`,
        status,
        ...reqDebug,
        bodyPreview: text?.slice(0, 800),
      })
    );
  }

  // common shapes: array of GUIDs, or array of objects with guid
  let data: any[] = [];
  if (Array.isArray(parsed)) {
    data = parsed.map((o: any) => (o && typeof o === "object" ? o.guid ?? o.id ?? o : o));
  } else if (parsed && typeof parsed === "object") {
    const arr = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.results) ? parsed.results : [];
    data = arr.map((o: any) => (o && typeof o === "object" ? o.guid ?? o.id ?? o : o));
  }

  return {
    data,
    status,
    debug: reqDebug,
  };
}

/**
 * FULL mode: /orders/v2/ordersBulk — returns full Order objects.
 * No expand needed; we just page size modestly to be safe.
 */
export async function getOrdersWindowFull(
  env: Env,
  startToast: string,
  endToast: string
): Promise<OrdersWindowResult> {
  const route = "/orders/v2/ordersBulk";
  const base = env.TOAST_API_BASE;
  const restaurantGuid = env.TOAST_RESTAURANT_GUID;

  await paceBeforeToastCall("orders", 900);

  const token = await getAccessToken(env);

  const url = new URL(route, base);
  url.searchParams.set("startDate", startToast);
  url.searchParams.set("endDate", endToast);
  url.searchParams.set("pageSize", "100"); // safe page size

  const headerName = "Toast-Restaurant-External-ID";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    [headerName]: restaurantGuid,
  };

  const reqDebug = {
    route,
    url: url.toString(),
    headerUsed: headerName as const,
    externalIdLooksLikeUuid: looksLikeUuid(restaurantGuid),
  };

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers });
  } catch (e: any) {
    throw new Error(
      JSON.stringify({ ok: false, where: "network", ...reqDebug, error: e?.message || String(e) })
    );
  }

  const status = res.status;
  const text = await res.text();

  if (status === 429) {
    throw new Error(
      JSON.stringify({
        ok: false,
        error: "Toast rate limit (429)",
        retryAfter: Number(res.headers.get("retry-after") || "1"),
        ...reqDebug,
        status,
      })
    );
  }

  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(JSON.stringify({ ok: false, error: "Non-JSON response", ...reqDebug, status }));
  }

  if (!res.ok) {
    throw new Error(
      JSON.stringify({
        ok: false,
        error: `Toast ${route} failed`,
        status,
        ...reqDebug,
        bodyPreview: text?.slice(0, 1200),
      })
    );
  }

  // Bulk returns array of full order objects
  const data: any[] = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

  return {
    data,
    status,
    debug: reqDebug,
  };
}
