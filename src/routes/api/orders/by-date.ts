// /src/routes/api/orders/by-date.ts
// Lines: 1-240 — “by date” endpoint, switches IDs vs FULL via ?detail=ids|full

import { json } from "../../../lib/http";
import {
  buildLocalHourSlicesWithinDay,
  clampInt,
} from "../../../lib/time";
import {
  getOrdersWindow,
  getOrdersWindowFull,
} from "../../../lib/toastOrders";

type DetailMode = "ids" | "full";

export default async function handleOrdersByDate(
  env: Env,
  request: Request
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const day = url.searchParams.get("date"); // e.g. 2025-10-10
    const tzOffset = url.searchParams.get("tzOffset") ?? "+0000";
    const startHour = clampInt(
      Number(url.searchParams.get("startHour") ?? 0),
      0,
      23
    );
    const endHour = clampInt(
      Number(url.searchParams.get("endHour") ?? 24),
      1,
      24
    );
    const debug = url.searchParams.get("debug") === "1";
    const detail: DetailMode =
      (url.searchParams.get("detail") as DetailMode) ?? "ids";

    if (!day) {
      return json(
        { ok: false, route: "/api/orders/by-date", error: "Missing ?date" },
        400
      );
    }
    if (endHour <= startHour) {
      return json(
        {
          ok: false,
          route: "/api/orders/by-date",
          error: "endHour must be > startHour",
        },
        400
      );
    }
    const slices = buildLocalHourSlicesWithinDay(day, tzOffset, startHour, endHour); // returns [{startIso,endIso},...]

    // Toast allows max 1hr per call; our slices are hours already.
    const debugSlices: any[] = [];
    const aggregate: any[] = [];
    let rawCount = 0;

    for (const slice of slices) {
      if (detail === "full") {
        const { orders, slice: s } = await getOrdersWindowFull(
          env,
          slice.startIso,
          slice.endIso,
          { debug }
        );
        rawCount += s.returned;
        if (debug && s.debug)
          debugSlices.push({
            sliceWindow: { start: slice.startIso, end: slice.endIso },
            ...s,
          });
        // Append full order objects
        for (const o of orders) aggregate.push(o);
      } else {
        const { ids, slice: s } = await getOrdersWindow(env, slice.startIso, slice.endIso, {
          debug,
        });
        rawCount += s.returned;
        if (debug && s.debug)
          debugSlices.push({
            sliceWindow: { start: slice.startIso, end: slice.endIso },
            ...s,
          });
        // Append IDs
        for (const id of ids) aggregate.push(id);
      }
    }

    const body: Record<string, unknown> = {
      ok: true,
      route: "/api/orders/by-date",
      day,
      tzOffset,
      hours: { startHour, endHour },
      window: {
        start: slices[0].startIso,
        end: slices[slices.length - 1].endIso,
      },
      slices: slices.length,
      requests: slices.length,
      count: aggregate.length,
      // If full, data contains full orders; else GUIDs
      data: aggregate,
      rawCount,
      includedEmpty: false,
    };
    if (debug) body.debugSlices = debugSlices;

    return json(body);
  } catch (err: any) {
    return json(
      {
        ok: false,
        route: "/api/orders/by-date",
        where: "unhandled",
        error: err?.message || String(err),
      },
      500
    );
  }
}
