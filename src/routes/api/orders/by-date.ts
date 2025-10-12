// /src/routes/api/orders/by-date.ts
// Path: src/routes/api/orders/by-date.ts

import { buildLocalHourSlicesWithinDay, clampInt } from "../../../lib/time";
import { getOrdersWindow, getOrdersWindowFull } from "../../../lib/toastOrders";

type Env = {
  TOAST_RESTAURANT_GUID: string;
};

function jres(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handleOrdersByDate(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const day = url.searchParams.get("date");           // YYYY-MM-DD (required)
  const tzOffset = url.searchParams.get("tzOffset") || "+0000"; // e.g. -0400
  const startHour = clampInt(url.searchParams.get("startHour"), 0, 23, 0);
  const endHour = clampInt(url.searchParams.get("endHour"), 1, 24, Math.min(startHour + 2, 24));
  const detailParam = (url.searchParams.get("detail") || "ids").toLowerCase();
  const detail: "ids" | "full" = detailParam === "full" ? "full" : "ids";
  const debug = url.searchParams.get("debug") === "1";

  // Basic validation
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return jres({
      ok: false,
      route: "/api/orders/by-date",
      where: "validate",
      error: "Missing or invalid ?date=YYYY-MM-DD",
    }, 400);
  }

  // Build hour-aligned slices within the day using local tzOffset
  const hourSlices = buildLocalHourSlicesWithinDay(day, tzOffset, startHour, endHour);
  if (!hourSlices.length) {
    return jres({
      ok: true,
      route: "/api/orders/by-date",
      day,
      tzOffset,
      hours: { startHour, endHour },
      window: null,
      slices: 0,
      requests: 0,
      count: 0,
      data: [],
      rawCount: 0,
      includedEmpty: false,
      debugSlices: debug ? [] : undefined,
      note: "No hour slices were generated (check hours range).",
    });
  }

  // Aggregate results per-slice
  const allData: any[] = [];
  const debugSlices: any[] = [];
  let rawCount = 0;

  // Overall window = first slice start .. last slice end
  const overallWindow = {
    start: hourSlices[0].startISO,
    end: hourSlices[hourSlices.length - 1].endISO,
  };

  for (const slice of hourSlices) {
    try {
      const fn = detail === "full" ? getOrdersWindowFull : getOrdersWindow;
      const res = await fn(
        env as any,
        {
          startISO: slice.startISO,
          endISO: slice.endISO,
          // detail is set by fn() choice above; keep debug metadata
          debug,
          where: "orders-window",
          callerRoute: "/api/orders/by-date",
        } as any
      );

      // If an error bubbled up as a Response, short-circuit and return it.
      if (res instanceof Response) {
        return res;
      }

      // Defensive: ensure shape
      const sliceData = Array.isArray(res.data) ? res.data : [];
      const sliceCount = typeof res.rawCount === "number" ? res.rawCount : sliceData.length;

      rawCount += sliceCount;
      if (sliceData.length) {
        allData.push(...sliceData);
      }

      if (debug && Array.isArray(res.debugSlices)) {
        debugSlices.push(...res.debugSlices);
      }
    } catch (err: any) {
      // Hard failure for this slice -> return a detailed error response
      return jres({
        ok: false,
        route: "/api/orders/by-date",
        where: "slice-fetch",
        slice,
        error: err?.message || String(err),
        stack: err?.stack || null,
      }, 500);
    }
  }

  return jres({
    ok: true,
    route: "/api/orders/by-date",
    day,
    tzOffset,
    hours: { startHour, endHour },
    window: overallWindow,
    slices: hourSlices.length,
    requests: hourSlices.length,
    count: allData.length,
    data: allData,
    rawCount,
    includedEmpty: false,
    ...(debug ? { debugSlices } : {}),
  });
}
