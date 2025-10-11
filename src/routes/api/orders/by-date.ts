// /src/routes/api/orders/by-date.ts
// lines: 1-~end (full file; replaces previous by-date.ts)
import { getOrdersWindow } from "../../../lib/toastOrders";
import { buildDayRange, clampHours } from "../../../lib/time";
import { paceBeforeToastCall } from "../../../lib/pacer";

type Env = {
  TOAST_RESTAURANT_GUID: string;
  TOAST_API_BASE: string;
};

export default async function handleOrdersByDate(env: Env, request: Request) {
  const url = new URL(request.url);
  const day = url.searchParams.get("date"); // YYYY-MM-DD
  const tzOffset = url.searchParams.get("tzOffset") || "+0000";
  // Limit to at most 2 hours (your requirement)
  const startHour = Number(url.searchParams.get("startHour") || "0");
  const endHour = Number(url.searchParams.get("endHour") || "24");
  const hours = clampHours(startHour, endHour, 2); // hard cap at 2-hour window

  // detail=full returns fully expanded orders via /ordersBulk
  const detail = (url.searchParams.get("detail") as "full" | "ids") || "full";
  const debug = url.searchParams.get("debug") === "1";

  if (!day) {
    return json(
      { ok: false, error: "Missing required date (YYYY-MM-DD)", route: "/api/orders/by-date" },
      400
    );
  }

  const range = buildDayRange(day, tzOffset, hours.startHour, hours.endHour);

  // Basic pacing before we start slice loop
  await paceBeforeToastCall("orders");

  try {
    const result = await getOrdersWindow(env, {
      startISO: range.window.start,
      endISO: range.window.end,
      sliceMinutes: 60,
      detail,
      debug,
    });

    return json({
      ok: true,
      route: "/api/orders/by-date",
      day,
      tzOffset,
      hours,
      window: range.window,
      slices: result.slices,
      count: result.count,
      data: result.data,
      ...(debug ? { debugSlices: (result as any).debugSlices } : {}),
    });
  } catch (err: any) {
    return json(
      {
        ok: false,
        route: "/api/orders/by-date",
        error: err?.error || "Unknown error",
        status: err?.status,
        toastRoute: err?.route,
        bodyPreview: err?.bodyPreview,
      },
      500
    );
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
