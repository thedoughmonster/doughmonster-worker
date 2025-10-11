// /src/lib/toastOrders.ts
// lines: 1-~end (new full file; replaces previous toastOrders.ts)
import { getAccessToken } from "./toastAuth";
import { paceBeforeToastCall } from "./pacer";
import { buildIsoWindowSlices } from "./time";
import { httpJson } from "./http";

export type OrdersWindowOpts = {
  startISO: string; // inclusive ISO-8601 with offset, e.g. 2025-10-10T06:00:00.000-0400
  endISO: string;   // inclusive end-ish we’ll clamp per slice
  sliceMinutes?: number; // default 60 (Toast hard limit)
  detail?: "ids" | "full"; // "full" uses /ordersBulk
  debug?: boolean;
};

type Env = {
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
};

type DebugSlice = {
  sliceWindow: { start: string; end: string };
  toast: {
    route: string;
    url: string;
    headerUsed: "Toast-Restaurant-External-ID";
  };
  status: number;
  returned: number;
};

export async function getOrdersWindow(env: Env, opts: OrdersWindowOpts) {
  const {
    startISO,
    endISO,
    sliceMinutes = 60,
    detail = "ids",
    debug = false,
  } = opts;

  const token = await getAccessToken(env);
  const slices = buildIsoWindowSlices(startISO, endISO, sliceMinutes);

  const all: any[] = [];
  const debugSlices: DebugSlice[] = [];

  for (const [i, win] of slices.entries()) {
    await paceBeforeToastCall("orders"); // 1 rps “global” pacer

    const route =
      detail === "full" ? "/orders/v2/ordersBulk" : "/orders/v2/orders";

    const query =
      detail === "full"
        ? new URLSearchParams({
            startDate: win.start,
            endDate: win.end,
            pageSize: "100",
          })
        : new URLSearchParams({
            startDate: win.start,
            endDate: win.end,
            restaurantGuid: env.TOAST_RESTAURANT_GUID, // kept for back-compat, but header is authoritative
          });

    const url = `${env.TOAST_API_BASE}${route}?${query.toString()}`;

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
    };

    const res = await fetch(url, { headers });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // keep as text for debugging
    }

    if (debug) {
      debugSlices.push({
        sliceWindow: win,
        toast: {
          route,
          url,
          headerUsed: "Toast-Restaurant-External-ID",
        },
        status: res.status,
        returned: Array.isArray(json) ? json.length : json ? 1 : 0,
      });
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || "1");
      throw {
        ok: false,
        error: "Rate limited; please retry later.",
        route,
        status: 429,
        retryAfter,
      };
    }

    if (!res.ok) {
      throw {
        ok: false,
        error: `Toast ${route} failed`,
        route,
        status: res.status,
        bodyPreview: text?.slice(0, 4000),
      };
    }

    if (detail === "full") {
      // Expecting array of full Order objects
      if (Array.isArray(json)) {
        all.push(...json);
      } else if (json) {
        all.push(json);
      }
    } else {
      // “ids” mode: map to order GUIDs if present, otherwise fall back
      const ids =
        Array.isArray(json) && json.length && typeof json[0] === "object"
          ? json.map((o: any) => o.guid ?? o.id ?? o)
          : Array.isArray(json)
          ? json
          : json
          ? [json]
          : [];
      all.push(...ids);
    }
  }

  return {
    ok: true,
    detail,
    slices: slices.length,
    count: all.length,
    data: all,
    ...(debug ? { debugSlices } : null),
  };
}
