// /src/routes/api/orders/by-date.ts
// Path: src/routes/api/orders/by-date.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";
import {
  clampInt,
  numOrNull,
  buildDaySlicesWithOffset,
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

export default async function handleOrdersByDate(env: EnvDeps, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const date = (url.searchParams.get("date") || "").trim(); // YYYY-MM-DD
  const tzOffset = (url.searchParams.get("tzOffset") || "+0000").trim(); // e.g. -0400 / -0500
  const limit = clampInt(url.searchParams.get("limit"), 1, 2000, 500);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { ok: false, error: "Provide ?date=YYYY-MM-DD (e.g., 2025-10-09)" },
      { status: 400 }
    );
  }
  if (!/^[+-]\d{4}$/.test(tzOffset)) {
    return Response.json(
      { ok: false, error: "Provide ?tzOffset like -0400 or -0500" },
      { status: 400 }
    );
  }

  const { startToast, endToast, slices } = buildDaySlicesWithOffset(date, tzOffset, 60);

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
          pageSize: String(limit),
        },
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
      day: date,
      tzOffset,
      window: { start: startToast, end: endToast },
      slices: slices.length,
      requests,
      count: compact.length,
      data: compact,
      rawCount: all.length,
    });
  } catch (e: any) {
    const status = Number(/Toast (\d{3})/.exec(e?.message || "")?.[1] ?? "502");
    return Response.json({ ok: false, error: e?.message || "Orders by date failed" }, { status });
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
