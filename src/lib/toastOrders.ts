// /src/lib/toastOrders.ts
// Path: src/lib/toastOrders.ts

import { getAccessToken } from "./toastAuth";
import { paceBeforeToastCall } from "./pacer";

/**
 * Fetch Toast Orders v2 data for a time window.
 * Uses the existing TOAST_RESTAURANT_GUID for both query and required header.
 * Expects Toast-formatted timestamps: yyyy-MM-dd'T'HH:mm:ss.SSS±HHmm
 */
export async function getOrdersWindow(
  env: Record<string, any>,
  startToast: string,
  endToast: string
): Promise<{ data: any[]; raw?: unknown; status?: number }> {
  const base = env.TOAST_API_BASE;
  const restaurantGuid = env.TOAST_RESTAURANT_GUID;

  if (!base) throw new Error("TOAST_API_BASE is not set");
  if (!restaurantGuid) throw new Error("TOAST_RESTAURANT_GUID is not set");

  // Gentle pacing (stay under global/endpoint limits).
  await paceBeforeToastCall("orders", 900);

  const token = await getAccessToken(env);

  const url = new URL("/orders/v2/orders", base);
  url.searchParams.set("restaurantGuid", restaurantGuid);
  url.searchParams.set("startDate", startToast);
  url.searchParams.set("endDate", endToast);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      // Required by Toast Orders API:
      "restaurant-external-id": restaurantGuid,
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
    throw new Error(`Toast GET /orders/v2/orders failed: ${res.status} - ${text}`);
  }

  if (!res.ok) {
    throw new Error(`Toast GET /orders/v2/orders failed: ${res.status} - ${text}`);
  }

  // Normalize to { data: [] }
  let data: any[] = [];
  if (Array.isArray(parsed)) data = parsed;
  else if (Array.isArray(parsed?.orders)) data = parsed.orders;
  else if (Array.isArray(parsed?.data)) data = parsed.data;

  return { data, raw: parsed, status: res.status };
}
