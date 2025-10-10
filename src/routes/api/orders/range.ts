// /src/routes/api/orders/range.ts
// Path: src/routes/api/orders/range.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";
import {
  nowToastIsoUtc,
  minusMinutesToastIsoUtc,
  toastsUtcAddMinutes,
  clampInt,
  numOrNull,
} from "../../../lib/time";

type CompactItem = {
  name: string | null;
  quantity: number | null;
  modifiers?: Array<{ name: string | null; quantity: number | null }>;
};

type CompactOrder = {
  id: string | number | null;
  businessDate?: string | null;
  openedAt?: string | null;
  updatedAt?: string | null;
  checkTotal?: number | null;
  items?: CompactItem[];
};

export default async function handleOrdersRange(env: EnvDeps, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const hours = clampInt(url.searchParams.get("hours"), 1, 24, 6); // walk up to 24h
  const limit = clampInt(url.searchParams.get("limit"), 1, 1000, 200); // total cap across slices

  // End at "now", walk backwards in 60-min chunks
  const endOverall = nowToastIsoUtc();
  const startOverall = minusMinutesToastIsoUtc(endOverall, hours * 60);

  // Build slice boundaries (<= 60 minutes per Toast)
  const slices = buildSlices(startOverall, endOverall, 60);

  const all: any[] = [];
  let requests = 0;

  try {
    for (const [start, end] of slices) {
      if (all.length >= limit) break;

      const data = await toastGet<any>(
        env,
        "/orders/v2/orders",
        {
          startDate: start,
          endDate: end,
          pageSize: String(limit), // helps if Toast honors
        },
        { scope: "global", minGapMs: 650 }
      );
      requests++;

      const list: any[] = Array.isArray(data?.orders)
        ? data.orders
        : Array.isArray(data?.elements)
        ? data.elements
        : Array.isArray(data)
        ? data
        : [];

      // Append but respect overall limit
      for (const o of list) {
        all.push(o);
        if (all.length >= limit) break;
      }
    }

    const compact: CompactOrder[] = all.slice(0, limit).map((o) => ({
      id: o?.guid ?? o?.id ?? null,
      businessDate: o?.businessDate ?? null,
      openedAt: o?.openedDate ?? o?.openedAt ?? null,
      updatedAt: o?.lastModifiedDate ?? o?.updatedAt ?? null,
      checkTotal: numOrNull(o?.check?.total ?? o?.checkTotal),
      items: extractItems(o),
    }));

    return Response.json({
      ok: true,
      window: { start: startOverall, end: endOverall, hours },
      slices: slices.length,
      requests,
      count: compact.length,
      data: compact,
      rawCount: all.length, // no raw payload to keep response light
    });
  } catch (e: any) {
    const status = Number(/failed:\s*(\d{3})\b/.exec(e?.message || "")?.[1] ?? "502");
    return Response.json({ ok: false, error: e?.message || "Orders range fetch failed" }, { status });
  }
}

function extractItems(o: any): CompactItem[] {
  const lines: any[] = Array.isArray(o?.check?.lineItems) ? o.check.lineItems
                    : Array.isArray(o?.lineItems) ? o.lineItems
                    : [];
  return lines.map((li) => ({
    name: li?.name ?? li?.displayName ?? null,
    quantity: numOrNull(li?.quantity ?? 1),
    modifiers: extractMods(li),
  }));
}

function extractMods(li: any): Array<{ name: string | null; quantity: number | null }> {
  const groups: any[] = Array.isArray(li?.modifiers) ? li.modifiers
                    : Array.isArray(li?.modifierGroups) ? li.modifierGroups
                    : [];
  const out: Array<{ name: string | null; quantity: number | null }> = [];
  for (const g of groups) {
    if (Array.isArray(g?.modifiers)) {
      for (const m of g.modifiers) {
        out.push({ name: m?.name ?? m?.displayName ?? null, quantity: numOrNull(m?.quantity ?? 1) });
      }
    } else if (g?.name) {
      out.push({ name: g.name ?? null, quantity: numOrNull(g?.quantity ?? 1) });
    }
  }
  return out;
}

/** Build [start,end] pairs of <=sliceMinutes from startOverall→endOverall */
function buildSlices(startOverall: string, endOverall: string, sliceMinutes: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cursor = startOverall;
  while (true) {
    const next = toastsUtcAddMinutes(cursor, sliceMinutes);
    if (next >= endOverall) {
      out.push([cursor, endOverall]);
      break;
    }
    out.push([cursor, next]);
    cursor = next;
  }
  return out;
}
