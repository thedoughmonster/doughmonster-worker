// /src/routes/api/orders/by-date.ts
// Path: src/routes/api/orders/by-date.ts

import { paceBeforeToastCall } from "../../../lib/pacer";
import { buildLocalHourSlicesWithinDay, clampInt } from "../../../lib/time";
import { getOrdersWindow } from "../../../lib/toastOrders";
import {
  DEFAULT_START_HOUR,
  DEFAULT_END_HOUR,
  MAX_SLICES_PER_REQUEST,
  DEFAULT_TZ_OFFSET,
} from "../../../config/orders";

/**
 * GET /api/orders/by-date?date=YYYY-MM-DD
 *      [&tzOffset=±HHmm]
 *      [&startHour=H&endHour=H]      // MUST be ≤ 2 hours total
 *      [&expand=checks,items,...]    // optional expansions; defaults applied if omitted
 *      [&debug=1]                    // include per-slice debug payloads
 *
 * Route: /api/orders/by-date
 * - Hard cap: ≤ 2 hours (2 hourly slices).
 * - Returns ALL entries from Toast (no filtering).
 * - On success: adds `debugSlices` when debug=1.
 */
export default async function handleOrdersByDate(env: any, request: Request): Promise<Response> {
  const ROUTE = "/api/orders/by-date";
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const tzOffset = url.searchParams.get("tzOffset") || DEFAULT_TZ_OFFSET;
    const includeDebug = url.searchParams.get("debug") === "1";

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return j(400, { ok: false, route: ROUTE, error: "Missing/invalid 'date' (YYYY-MM-DD)" });
    }
    if (!/^[+-]\d{4}$/.test(tzOffset)) {
      return j(400, { ok: false, route: ROUTE, error: "Invalid 'tzOffset' (like +0000, -0400)" });
    }

    const startHour = clampInt(url.searchParams.get("startHour"), 0, 23, DEFAULT_START_HOUR);
    const endHour = clampInt(url.searchParams.get("endHour"), 1, 24, DEFAULT_END_HOUR);

    if (endHour <= startHour) {
      return j(400, { ok: false, route: ROUTE, error: "'endHour' must be greater than 'startHour'." });
    }
    if (endHour - startHour > MAX_SLICES_PER_REQUEST) {
      return j(400, {
        ok: false,
        route: ROUTE,
        error: "Requested window too large; max 2 hours per request.",
        limitHours: MAX_SLICES_PER_REQUEST,
        hint: `Use endHour <= startHour + ${MAX_SLICES_PER_REQUEST}`,
      });
    }

    // optional expand param passthrough
    // supports: ?expand=checks,items,payments  (comma separated)
    const expandParam = url.searchParams.get("expand");
    const expand = expandParam ? expandParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

    const { startToast, endToast, slices } = buildLocalHourSlicesWithinDay(
      date,
      tzOffset,
      startHour,
      endHour,
      60
    );

    if (slices.length > MAX_SLICES_PER_REQUEST) {
      return j(400, {
        ok: false,
        route: ROUTE,
        error: "Requested window expands beyond 2 hourly slices.",
        slices: slices.length,
        limit: MAX_SLICES_PER_REQUEST,
      });
    }

    // Accumulate ALL entries from Toast — no filtering.
    const raw: any[] = [];
    const debugSlices: any[] = [];
    let requests = 0;

    for (const [start, end] of slices) {
      await paceBeforeToastCall("orders", 1100);
      try {
        const res = await getOrdersWindow(env, start, end, expand);
        requests++;
        if (Array.isArray(res?.data)) raw.push(...res.data);
        if (includeDebug) {
          debugSlices.push({
            sliceWindow: { start, end },
            toast: res?.debug ?? null,
            status: res?.status ?? null,
            returned: Array.isArray(res?.data) ? res!.data.length : 0,
          });
        }
      } catch (e: any) {
        // If the lower-level error is JSON, pass it through with our route label.
        try {
          const parsed = JSON.parse(e?.message ?? "");
          return j(502, { ...parsed, where: "orders-window", callerRoute: ROUTE });
        } catch {
          return j(502, {
            ok: false,
            route: ROUTE,
            where: "orders-window",
            error: e?.message || String(e),
            window: { start, end },
          });
        }
      }
    }

    const data = raw;

    const body: any = {
      ok: true,
      route: ROUTE,
      day: date,
      tzOffset,
      hours: { startHour, endHour },
      window: { start: startToast, end: endToast },
      slices: slices.length,
      requests,
      count: data.length,
      data,
      rawCount: raw.length,
    };

    if (includeDebug) {
      body.debugSlices = debugSlices;
    }

    return j(200, body);
  } catch (err: any) {
    return j(500, {
      ok: false,
      route: ROUTE,
      where: "unhandled",
      error: err?.message || String(err),
    });
  }
}

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
