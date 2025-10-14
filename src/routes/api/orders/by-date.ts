// /src/routes/api/orders/by-date.ts
// Route: /api/orders/by-date
// Supports ?date=YYYY-MM-DD&tzOffset=-0400&startHour=6&endHour=8&detail=ids|full&debug=1

import type { ToastEnv } from "../../../lib/env";
import { jsonResponse } from "../../../lib/http";
import { buildLocalHourSlicesWithinDay, clampInt } from "../../../lib/time";
import { getOrdersWindow, getOrdersWindowFull } from "../../../lib/toastOrders";

type DetailMode = "ids" | "full";

export default async function handleOrdersByDate(
  env: ToastEnv,
  request: Request
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const day = url.searchParams.get("date");
    const tzOffset = url.searchParams.get("tzOffset") ?? "+0000";
    const startHour = clampInt(url.searchParams.get("startHour"), 0, 23, 0);
    const endHour = clampInt(url.searchParams.get("endHour"), 1, 24, 24);
    const debug = url.searchParams.get("debug") === "1";
    const detail: DetailMode =
      (url.searchParams.get("detail") as DetailMode) ?? "ids";

    if (!day) {
      return jsonResponse(
        { ok: false, route: "/api/orders/by-date", error: "Missing ?date" },
        { status: 400 }
      );
    }
    if (endHour <= startHour) {
      return jsonResponse(
        {
          ok: false,
          route: "/api/orders/by-date",
          error: "endHour must be > startHour",
        },
        { status: 400 }
      );
    }

    const slices = buildLocalHourSlicesWithinDay(day, tzOffset, startHour, endHour);
    if (slices.length === 0) {
      return jsonResponse(
        { ok: false, route: "/api/orders/by-date", error: "Requested window produced no slices" },
        { status: 400 }
      );
    }

    const debugSlices: any[] = [];
    const aggregate: any[] = [];
    let rawCount = 0;

    for (const slice of slices) {
      if (detail === "full") {
        const res = await getOrdersWindowFull(env, {
          startDateIso: slice.startISO,
          endDateIso: slice.endISO,
          debugMeta: debug ? { route: "/api/orders/by-date" } : undefined,
        });
        rawCount += res.slice.returned;
        if (debug) debugSlices.push(res.slice);
        aggregate.push(...res.data);
      } else {
        const res = await getOrdersWindow(env, {
          startDateIso: slice.startISO,
          endDateIso: slice.endISO,
          debugMeta: debug ? { route: "/api/orders/by-date" } : undefined,
        });
        rawCount += res.slice.returned;
        if (debug) debugSlices.push(res.slice);
        aggregate.push(...res.ids);
      }
    }

    const firstSlice = slices[0];
    const lastSlice = slices[slices.length - 1];

    const body: Record<string, unknown> = {
      ok: true,
      route: "/api/orders/by-date",
      day,
      tzOffset,
      hours: { startHour, endHour },
      window: {
        start: firstSlice?.startISO ?? null,
        end: lastSlice?.endISO ?? null,
      },
      slices: slices.length,
      requests: slices.length,
      count: aggregate.length,
      data: aggregate,
      rawCount,
      includedEmpty: false,
    };
    if (debug) body.debugSlices = debugSlices;

    return jsonResponse(body);
  } catch (err: any) {
    return jsonResponse(
      {
        ok: false,
        route: "/api/orders/by-date",
        where: "unhandled",
        error: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
