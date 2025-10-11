// /src/lib/toastOrders.ts
// Path: src/lib/toastOrders.ts

import { getAccessToken } from "./toastAuth";
import { paceBeforeToastCall } from "./pacer";

/** Mask helper for secrets/ids in logs (keep format hints while safe). */
function mask(val: string | undefined | null, keepStart = 8, keepEnd = 4): string {
  if (!val) return "<empty>";
  const s = String(val);
  if (s.length <= keepStart + keepEnd) return s.replace(/./g, "•");
  return `${s.slice(0, keepStart)}…${s.slice(-keepEnd)}`;
}

/** Basic UUID check (Toast GUIDs look like UUIDs). */
function looksLikeUuid(v: string | undefined | null): boolean {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export type OrdersWindowResult = {
  data: any[];
  raw?: unknown;
  status?: number;
  debug?: any;
};

/** Default expansions to get “complete enough” orders. Adjust later as needed. */
const DEFAULT_EXPAND = [
  "checks",
  "items",
  "payments",
  "discounts",
  "serviceCharges",
  "customers",
  "employee",
] as const;

/** Build a CSV expand string from array or string. */
function toExpandCSV(expand?: string | string[] | null): string | undefined {
  if (!expand) return DEFAULT_EXPAND.join(",");
  if (Array.isArray(expand)) return expand.join(",");
  return expand;
}

/**
 * Fetch Toast Orders v2 data for one window.
 * - Sends **Toast-Restaurant-External-ID** header (required by Toast).
 * - Uses TOAST_RESTAURANT_GUID for both query and required header.
 * - Supports `expand` to retrieve full order payloads.
 * - Expects timestamps: yyyy-MM-dd'T'HH:mm:ss.SSS±HHmm
 * - Heavy debug on all failures.
 */
export async function getOrdersWindow(
  env: Record<string, any>,
  startToast: string,
  endToast: string,
  expand?: string | string[] | null
): Promise<OrdersWindowResult> {
  const route = "/orders/v2/orders";
  const base = env.TOAST_API_BASE;
  const restaurantGuid = env.TOAST_RESTAURANT_GUID;

  if (!base) {
    throw new Error(JSON.stringify({ ok: false, route, where: "preflight", error: "TOAST_API_BASE is not set" }));
  }
  if (!restaurantGuid) {
    throw new Error(JSON.stringify({ ok: false, route, where: "preflight", error: "TOAST_RESTAURANT_GUID is not set" }));
  }

  // Gentle pacing (stay under per-sec + endpoint limits).
  await paceBeforeToastCall("orders", 900);

  // Token
  let token = "";
  try {
    token = await getAccessToken(env);
  } catch (e: any) {
    throw new Error(JSON.stringify({ ok: false, route, where: "auth", error: e?.message || String(e) }));
  }

  // Build URL
  const url = new URL(route, base);
  url.searchParams.set("restaurantGuid", restaurantGuid);
  url.searchParams.set("startDate", startToast);
  url.searchParams.set("endDate", endToast);
  const expandCsv = toExpandCSV(expand);
  if (expandCsv) url.searchParams.set("expand", expandCsv);

  // Correct header name required by Toast
  const headerName = "Toast-Restaurant-External-ID";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    [headerName]: restaurantGuid,
  };

  const requestDebug = {
    ok: false,
    route,
    method: "GET",
    url: url.toString(),
    sentHeaders: {
      authorization: `Bearer ${mask(token, 10, 6)}`,
      accept: headers.Accept,
      [headerName]: mask(restaurantGuid, 8, 6),
      externalIdLooksLikeUuid: looksLikeUuid(restaurantGuid),
    },
    query: {
      restaurantGuidMasked: mask(restaurantGuid, 8, 6),
      startDate: startToast,
      endDate: endToast,
      expand: expandCsv || "<none>",
    },
  };

  // Fire request
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET", headers });
  } catch (e: any) {
    throw new Error(JSON.stringify({ ...requestDebug, where: "network", error: e?.message || String(e) }));
  }

  const status = res.status;
  const text = await res.text();
  const baseErr = {
    ...requestDebug,
    status,
    responseHeaders: {
      "retry-after": res.headers.get("retry-after"),
      "content-type": res.headers.get("content-type"),
      "cf-ray": res.headers.get("cf-ray"),
    },
    bodyPreview: text?.slice(0, 800),
  };

  if (status === 429) {
    throw new Error(JSON.stringify({ ...baseErr, error: "Toast rate limit (429)" }));
  }

  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(JSON.stringify({ ...baseErr, error: `Non-JSON response from Toast` }));
  }

  if (!res.ok) {
    throw new Error(JSON.stringify({ ...baseErr, error: `Toast ${route} failed`, toastError: parsed }));
  }

  // Normalize to { data: [] }
  let data: any[] = [];
  if (Array.isArray(parsed)) data = parsed;
  else if (Array.isArray(parsed?.orders)) data = parsed.orders;
  else if (Array.isArray(parsed?.data)) data = parsed.data;
  else if (parsed && typeof parsed === "object") {
    // some responses return { results: [] }
    if (Array.isArray(parsed.results)) data = parsed.results;
  }

  return {
    data,
    raw: parsed,
    status,
    debug: {
      route,
      url: url.toString(),
      headerUsed: headerName,
      expandUsed: expandCsv || "<none>",
      externalIdLooksLikeUuid: looksLikeUuid(restaurantGuid),
    },
  };
}
