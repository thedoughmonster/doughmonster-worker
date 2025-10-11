// /src/routes/api/orders/by-range.ts

import { getOrdersWindow } from "../../../lib/toastOrders";
import { buildHourlySlices } from "../../../lib/time";
import { paceBeforeToastCall } from "../../../lib/pacer";

export default async function handleOrdersByRange(env: any, request: Request) {
  try {
    const url = new URL(request.url);
    const hoursParam = url.searchParams.get("hours");
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");

    const hours = hoursParam ? parseInt(hoursParam, 10) : null;
    const now = new Date();

    let start: Date;
    let end: Date;

    if (startParam && endParam) {
      start = new Date(startParam);
      end = new Date(endParam);
    } else if (hours) {
      end = now;
      start = new Date(now.getTime() - hours * 60 * 60 * 1000);
    } else {
      // Default: last 6 hours
      end = now;
      start = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    }

    const slices = buildHourlySlices(start, end);
    const allResults: any[] = [];

    for (const slice of slices) {
      await paceBeforeToastCall("orders", 1200); // pace requests to avoid rate limits
      const data = await getOrdersWindow(env, slice.start, slice.end);
      if (data?.data?.length) allResults.push(...data.data);
    }

    return Response.json({
      ok: true,
      window: { start: start.toISOString(), end: end.toISOString() },
      sliceCount: slices.length,
      totalOrders: allResults.length,
      data: allResults,
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: err.message || String(err) });
  }
}
