// /src/lib/toastOrders.ts
// Path: src/lib/toastOrders.ts

import { getAccessToken } from "./toastAuth";
import { paceBeforeToastCall } from "./pacer";

export type EnvDeps = {
  TOAST_API_BASE: string;               // e.g. https://ws-api.toasttab.com
  TOAST_RESTAURANT_GUID: string;        // your restaurant GUID
};

/**
 * Calls Toast Orders v2 for a single time window.
 * - `startToast` and `endToast` MUST be Toast-formatted timestamps: yyyy-MM-dd'T'HH:mm:ss.SSS±HHmm
 * - Paces calls lightly and uses the bearer token from toastAuth.
 * - Normalizes response to { data: [] } so callers can just read `.data`.
 */
export async function getOrdersWindow(
  env: EnvDeps,
  startToast: string,
  endToast: string
): Promise<{ data: any[]; raw?: unknown; status?: number }> {
  // Defensive env checks
  const base = env.TOAST_API_BASE;
  const restaurantGuid = (env as any).TOAST_RESTAURANT_GUID as string | undefined;

  if (!base) throw new Error("TOAST_API_BASE is not set");
  if (!restaurantGuid) throw new Error("TOAST_RESTAURANT_GUID is not set");

  // Pace a bit for safety (global + per-endpoint rate limits)
  await paceBeforeToastCall("orders", 900);

  const token = await getAccessToken(env);

  const url = new URL("/orders/v2/orders", base);
  url.searchParams.set("restaurantGuid", restaurantGuid);
  url.searchParams.set("startDate", startToast);
  url.searchParams.set("endDate", endToast);
  // Optional tuning:
  // url.searchParams.set("pageSize", "200"); // uncomment if you need larger pages

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
    },
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after") || undefined;
    throw new Error(
      JSON.stringify({
        ok: false,
        error: "Toast rate limit (429)",
        retryAfter,
        window: { startToast, endToast },
      })
    );
  }

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text for debugging
    throw new Error(`Toast GET /orders/v2/orders failed: ${res.status} - ${text}`);
  }

  if (!res.ok) {
    throw new Error(`Toast GET /orders/v2/orders failed: ${res.status} - ${text}`);
  }

  // Normalize the shape to { data: [] }
  // Toast responses are not always consistent across accounts/versions.
  let data: any[] = [];
  if (Array.isArray(parsed)) {
    data = parsed;
  } else if (Array.isArray(parsed?.orders)) {
    data = parsed.orders;
  } else if (Array.isArray(parsed?.data)) {
    data = parsed.data;
  }

  return { data, raw: parsed, status: res.status };
}
