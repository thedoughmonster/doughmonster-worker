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

/**
 * Fetch Toast Orders v2 data for one window.
 * - Adds strong debug context on every failure.
 * - Sends `restaurant-external-id` header (currently using TOAST_RESTAURANT_GUID).
 * - Expects Toast timestamps: yyyy-MM-dd'T'HH:mm:ss.SSS±HHmm
 */
export async function getOrdersWindow(
  env: Record<string, any>,
  startToast: string,
  endToast: string
): Promise<{ data: any[]; raw?: unknown; status?: number; debug?: any }> {
  const route = "/orders/v2/orders";
  const base = env.TOAST_API_BASE;
  const restaurantGuid = env.TOAST_RESTAURANT_GUID;

  // Optional override: if you *also* have S_TOAST_ORDERS_EXTERNAL_ID set as a secret,
  // we’ll prefer that for the header. Otherwise we use the restaurant GUID.
  const externalIdForHeader =
    env.S_TOAST_ORDERS_EXTERNAL_ID && String(env.S_TOAST_ORDERS_EXTERNAL_ID).trim().length > 0
      ? String(env.S_TOAST_ORDERS_EXTERNAL_ID).trim()
      : restaurantGuid;

  if (!base) {
    throw new Error(
      JSON.stringify({
        ok: false,
        route,
        where: "preflight",
        error: "TOAST_API_BASE is not set",
      })
    );
  }
  if (!restaurantGuid) {
    throw new Error(
      JSON.stringify({
        ok: false,
        route,
        where: "preflight",
        error: "TOAST_RESTAURANT_GUID is not set",
      })
    );
  }
  if (!externalIdForHeader) {
    throw new Error(
      JSON.stringify({
        ok: false,
        route,
        where: "preflight",
        error:
          "No value available for `restaurant-external-id` header (expected TOAST_RESTAURANT_GUID or S_TOAST_ORDERS_EXTERNAL_ID).",
      })
    );
  }

  // Gentle pacing (stay under per-sec + endpoint limits).
  await paceBeforeToastCall("orders", 900);

  // Token
  let token = "";
  try {
    token = await getAccessToken(env);
  } catch (e: any) {
    throw new Error(
      JSON.stringify({
        ok: false,
        route,
        where: "auth",
        error: e?.message || String(e),
      })
    );
  }

  // Build URL
  const url = new URL(route, base);
  url.searchParams.set("restaurantGuid", restaurantGuid);
  url.searchParams.set("startDate", startToast);
  url.searchParams.set("endDate", endToast);

  // Build headers (DO NOT log full token)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "restaurant-external-id": externalIdForHeader,
  };

  const requestDebug = {
    ok: false,
    route,
    method: "GET",
    url: url.toString(),
    sentHeaders: {
      // show masked info only
      authorization: `Bearer ${mask(token, 10, 6)}`,
      accept: headers.Accept,
      "restaurant-external-id": mask(externalIdForHeader, 8, 6),
      // quick sanity flags
      externalIdLooksLikeUuid: looksLikeUuid(externalIdForHeader),
      externalIdEqualsRestaurantGuid: externalIdForHeader === restaurantGuid,
    },
    query: {
      restaurantGuidMasked: mask(restaurantGuid, 8, 6),
      startDate: startToast,
      endDate: endToast,
    },
  };

  // Fire request
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET", headers });
  } catch (e: any) {
    throw new Error(
      JSON.stringify({
        ...requestDebug,
        where: "network",
        error: e?.message || String(e),
      })
    );
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
    bodyPreview: text?.slice(0, 500),
  };

  if (status === 429) {
    throw new Error(
      JSON.stringify({
        ...baseErr,
        error: "Toast rate limit (429)",
      })
    );
  }

  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; bubble exact payload
    throw new Error(
      JSON.stringify({
        ...baseErr,
        error: `Non-JSON response from Toast`,
      })
    );
  }

  if (!res.ok) {
    // Bubble Toast error with all context
    throw new Error(
      JSON.stringify({
        ...baseErr,
        error: `Toast ${route} failed`,
        toastError: parsed,
      })
    );
  }

  // Normalize to { data: [] }
  let data: any[] = [];
  if (Array.isArray(parsed)) data = parsed;
  else if (Array.isArray(parsed?.orders)) data = parsed.orders;
  else if (Array.isArray(parsed?.data)) data = parsed.data;

  return {
    data,
    raw: parsed,
    status,
    debug: {
      route,
      url: url.toString(),
      externalIdEqualsRestaurantGuid: externalIdForHeader === restaurantGuid,
      externalIdLooksLikeUuid: looksLikeUuid(externalIdForHeader),
    },
  };
}
