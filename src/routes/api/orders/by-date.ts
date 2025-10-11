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
 *      [&tzOffset=+0000|-0400]
 *      [&startHour=6&endHour=8]      // MUST be ≤ 2 hours total
 *      [&includeEmpty=1]             // debug: keep empty results
 *
 * Enforces a hard 2-hour limit to avoid Worker 1102 resource errors.
 * Defaults to 06:00–08:00 local unless overridden.
 */
export default async function handleOrdersByDate(env: any, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const tzOffset = url.searchParams.get("tzOffset") || DEFAULT_TZ_OFFSET;
    const includeEmpty = url.searchParams.get("includeEmpty") === "1";

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ ok: false, error: "Missing or invalid 'date' (expected YYYY-MM-DD)." }, 400);
    }
    if (!/^[+-]\d{4}$/.test(tzOffset)) {
      return json({ ok: false, error: "Invalid 'tzOffset' (expected like +0000, -0400, -0500)." }, 400);
    }

    const startHour = clampInt(url.searchParams.get("startHour"), 0, 23, DEFAULT_START_HOUR);
    const endHour = clampInt(url.searchParams.get("endHour"), 1, 24, DEFAULT_END_HOUR);

    if (endHour <= startHour) {
      return json({ ok: false, error: "'endHour' must be greater than 'startHour'." }, 400);
    }

    // Hard cap: <= 2 hourly slices
    if (endHour - startHour > MAX_SLICES_PER_REQUEST) {
      return json(
        {
          ok: false,
          error: "Requested window too large; max 2 hours per request.",
          limitHours: MAX_SLICES_PER_REQUEST,
          hint: `Try: /api/orders/by-date?date=${date}&tzOffset=${tzOffset}&startHour=${startHour}&endHour=${startHour +
            MAX_SLICES_PER_REQUEST}`,
        },
        400
      );
    }

    const { startToast, endToast, slices } = buildLocalHourSlicesWithinDay(
      date,
      tzOffset,
      startHour,
      endHour,
      60
    );

    if (slices.length > MAX_SLICES_PER_REQUEST) {
      return json(
        {
          ok: false,
          error: "Requested window expands beyond 2 hourly slices.",
          slices: slices.length,
          limit: MAX_SLICES_PER_REQUEST,
        },
        400
      );
    }

    const raw: any[] = [];
    let requests = 0;

    for (const [start, end] of slices) {
      await paceBeforeToastCall("orders", 1100); // keep under per-sec + endpoint limits
      const res = await getOrdersWindow(env, start, end);
      requests++;
      if (Array.isArray(res?.data)) raw.push(...res.data);
    }

    const filtered = includeEmpty
      ? raw
      : raw.filter((o) => {
          if (!o || typeof o !== "object") return false;
          if (o.id) return true;
          if (Array.isArray(o.items) && o.items.length > 0) return true;
          return false;
        });

    return json({
      ok: true,
      day: date,
      tzOffset,
      hours: { startHour, endHour },
      window: { start: startToast, end: endToast },
      slices: slices.length,
      requests,
      count: filtered.length,
      data: filtered,
      rawCount: raw.length,
      includedEmpty: includeEmpty,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err) }, 500);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
