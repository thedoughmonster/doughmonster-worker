// /src/routes/api/orders/range.ts
// Path: src/routes/api/orders/range.ts

import type { ToastApiEnv } from "../../../lib/env";
import { toastGet } from "../../../lib/toastApi";
import { clampInt, nowToastIsoUtc, minusMinutesToastIsoUtc, buildIsoWindowSlices } from "../../../lib/time";
import { MAX_SLICES_PER_REQUEST } from "../../../config/orders";

export default async function handleOrdersRange(env: ToastApiEnv, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const minutes = clampInt(url.searchParams.get("minutes"), 1, 1440, 360);
  const limit = clampInt(url.searchParams.get("limit"), 1, 2000, 500);

  const end = nowToastIsoUtc();
  const start = minusMinutesToastIsoUtc(minutes, end);

  const slices = buildIsoWindowSlices(start, end, 60);
  if (slices.length === 0) {
    return Response.json(
      { ok: false, error: "Invalid range; end must be after start" },
      { status: 400 }
    );
  }
  if (slices.length > MAX_SLICES_PER_REQUEST) {
    return Response.json(
      {
        ok: false,
        error: "Requested window too large; reduce the duration",
        limitHours: MAX_SLICES_PER_REQUEST,
        slices: slices.length,
      },
      { status: 400 }
    );
  }

  const all: any[] = [];
  let requests = 0;

  try {
    for (const { startISO: s, endISO: e } of slices) {
      if (all.length >= limit) break;

      const data = await toastGet<any>(
        env,
        "/orders/v2/orders",
        { startDate: s, endDate: e, pageSize: String(limit) },
        { scope: "orders", minGapMs: 800 }
      );
      requests++;

      const list: any[] = Array.isArray(data?.orders)
        ? data.orders
        : Array.isArray(data?.elements)
        ? data.elements
        : Array.isArray(data)
        ? data
        : [];

      for (const o of list) {
        all.push(o);
        if (all.length >= limit) break;
      }
    }

    return Response.json({
      ok: true,
      window: { minutes, start, end },
      slices: slices.length,
      requests,
      count: all.length,
      data: all,
    });
  } catch (e: any) {
    const status = Number(/Toast (\d{3})/.exec(e?.message || "")?.[1] ?? "502");
    return Response.json({ ok: false, error: e?.message || "Orders range failed" }, { status });
  }
}
