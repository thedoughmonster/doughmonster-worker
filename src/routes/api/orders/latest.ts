// /src/routes/api/orders/latest.ts
// Path: src/routes/api/orders/latest.ts

import type { EnvDeps } from "../../../lib/toastApi";
import { toastGet } from "../../../lib/toastApi";
import { nowToastIsoUtc, minusHoursToastIsoUtc } from "../../../lib/time";

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

export default async function handleOrdersLatest(env: EnvDeps, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const hours = clampInt(url.searchParams.get("hours"), 1, 24, 4);
  const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);

  // Build a Toast-formatted UTC window with millis & numeric offset
  const end = nowToastIsoUtc();
  const start = minusHoursToastIsoUtc(end, hours);

  try {
    // Conservative pacing on global scope
    const data = await toastGet<any>(
      env,
      "/orders/v2/orders",
      {
        startDate: start,
        endDate: end,
        pageSize: String(limit), // if Toast ignores, we trim below
      },
      { scope: "global", minGapMs: 650 }
    );

    const list: any[] = Array.isArray(data?.orders)
      ? data.orders
      : Array.isArray(data?.elements)
      ? data.elements
      : Array.isArray(data)
      ? data
      : [];

    const compact: CompactOrder[] = list.slice(0, limit).map((o) => ({
      id: o?.guid ?? o?.id ?? null,
      businessDate: o?.businessDate ?? null,
      openedAt: o?.openedDate ?? o?.openedAt ?? null,
      updatedAt: o?.lastModifiedDate ?? o?.updatedAt ?? null,
      checkTotal: numOrNull(o?.check?.total ?? o?.checkTotal),
      items: extractItems(o),
    }));

    return Response.json({
      ok: true,
      window: { start, end, hours },
      count: compact.length,
      data: compact,
      raw: data, // keep raw for now
    });
  } catch (e: any) {
    const status = Number(/failed:\s*(\d{3})\b/.exec(e?.message || "")?.[1] ?? "502");
    return Response.json({ ok: false, error: e?.message || "Orders fetch failed" }, { status });
  }
}

function clampInt(raw: string | null, min: number, max: number, dflt: number): number {
  const n = Number(raw ?? dflt);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
