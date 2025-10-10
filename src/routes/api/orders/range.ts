// /src/routes/api/orders/range.ts
// Path: src/routes/api/orders/range.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";
import {
  clampInt,
  nowToastIsoUtc,
  minusMinutesToastIsoUtc,
  toastsUtcAddMinutes,
} from "../../../lib/time";

type ToastRangeQ = {
  startDate?: string;
  endDate?: string;
  minutes?: string;
  pageSize?: string;
};

export default async function handleOrdersRange(env: EnvDeps, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const minutes = clampInt(url.searchParams.get("minutes"), 1, 1440, 360);
  const limit = clampInt(url.searchParams.get("limit"), 1, 2000, 500);

  const end = nowToastIsoUtc();
  const start = minusMinutesToastIsoUtc(end, minutes);

  // Break into <=60 min slices to satisfy Toast constraint
  const slices: Array<[string, string]> = [];
  let cursor = start;
  while (true) {
    const next = toastsUtcAddMinutes(cursor, Math.min(60, minutes));
    slices.push([cursor, next]);
    if (next >= end) break;
    cursor = next;
  }

  const all: any[] = [];
  let requests = 0;

  try {
    for (const [s, e] of slices) {
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
