import type { AppEnv } from "../config/env.js";
import type { getOrdersBulk } from "../clients/toast.js";

const INITIAL_WINDOW_MINUTES = 60;
const WINDOW_STEP_MINUTES = 60;
const MAX_LOOKBACK_DAYS = 7;
const PAGE_SIZE = 100;
const MAX_PAGES = 200;

export interface CollectLatestOrdersDeps {
  getOrdersBulk: typeof getOrdersBulk;
}

export interface CollectLatestOrdersOptions {
  env: AppEnv;
  deps: CollectLatestOrdersDeps;
  limit: number;
  locationId: string | null;
  status: string | null;
  start: Date;
  end: Date;
  allowWidening: boolean;
  debug: boolean;
}

export interface CollectLatestOrdersResult {
  orders: any[];
  orderIds: string[];
  minutes: number | null;
  window: { start: string; end: string };
  debug?: CollectLatestOrdersDebug;
}

interface CollectLatestOrdersDebug {
  initialWindow: { start: string; end: string };
  windows: Array<{
    start: string;
    end: string;
    pagesFetched: number;
    totalOrders: number;
    uniqueCollected: number;
  }>;
  totals: {
    returned: number;
    filtered: {
      voided: number;
      deleted: number;
      location: number;
      status: number;
    };
    uniqueKept: number;
    finalReturned: number;
    lastSortKey: { orderTimeMs: number | null; guid: string } | null;
  };
}

interface CollectorEntry {
  order: any;
  orderTimeMs: number | null;
}

export async function collectLatestOrders({
  env,
  deps,
  limit,
  locationId,
  status,
  start,
  end,
  allowWidening,
  debug,
}: CollectLatestOrdersOptions): Promise<CollectLatestOrdersResult> {
  const collector = new Map<string, CollectorEntry>();
  const normalizedLocation = normalizeString(locationId);
  const normalizedStatus = normalizeString(status);

  const filteredCounts = {
    voided: 0,
    deleted: 0,
    location: 0,
    status: 0,
  };

  const windowsDebug: CollectLatestOrdersDebug["windows"] = [];
  const initialWindow = { start: toToastIsoUtc(start), end: toToastIsoUtc(end) };
  let totalOrdersReturned = 0;

  const stepMs = WINDOW_STEP_MINUTES * 60_000;
  const maxLookbackMs = MAX_LOOKBACK_DAYS * 24 * 60 * 60_000;
  const windowWidthMs = Math.max(0, end.getTime() - start.getTime());
  const referenceEndMs = end.getTime();

  let currentStart = new Date(start.getTime());
  let currentEnd = new Date(end.getTime());

  while (true) {
    const startIso = toToastIsoUtc(currentStart);
    const endIso = toToastIsoUtc(currentEnd);

    const windowDebug = {
      start: startIso,
      end: endIso,
      pagesFetched: 0,
      totalOrders: 0,
      uniqueCollected: collector.size,
    };

    const pageSignatures = new Set<string>();
    let page = 1;

    while (page <= MAX_PAGES) {
      const { orders, nextPage } = await deps.getOrdersBulk(env, {
        startIso,
        endIso,
        page,
        pageSize: PAGE_SIZE,
      });

      const currentOrders = Array.isArray(orders) ? orders : [];
      totalOrdersReturned += currentOrders.length;
      windowDebug.totalOrders += currentOrders.length;
      windowDebug.pagesFetched += 1;

      if (currentOrders.length === 0) {
        break;
      }

      const signature = JSON.stringify([
        currentOrders[0]?.guid ?? null,
        currentOrders[currentOrders.length - 1]?.guid ?? null,
        typeof nextPage === "number" ? nextPage : null,
      ]);
      if (pageSignatures.has(signature)) {
        break;
      }
      pageSignatures.add(signature);

      for (const order of currentOrders) {
        if (isOrderVoided(order)) {
          filteredCounts.voided += 1;
          continue;
        }

        if (isOrderDeleted(order)) {
          filteredCounts.deleted += 1;
          continue;
        }

        if (normalizedLocation) {
          const orderLocation = normalizeString(extractOrderLocation(order));
          if (!orderLocation || orderLocation !== normalizedLocation) {
            filteredCounts.location += 1;
            continue;
          }
        }

        if (normalizedStatus) {
          const orderStatus = normalizeString(extractOrderStatus(order));
          if (!orderStatus || orderStatus !== normalizedStatus) {
            filteredCounts.status += 1;
            continue;
          }
        }

        const guid = typeof order?.guid === "string" ? order.guid : null;
        if (!guid || collector.has(guid)) {
          continue;
        }

        collector.set(guid, {
          order,
          orderTimeMs: extractOrderTimeMs(order),
        });

        if (collector.size >= limit) {
          break;
        }
      }

      if (collector.size >= limit) {
        break;
      }

      const hasNextPage = typeof nextPage === "number" && nextPage > page;
      if (!hasNextPage) {
        break;
      }

      page = nextPage;
    }

    windowDebug.uniqueCollected = collector.size;
    windowsDebug.push(windowDebug);

    if (!allowWidening || collector.size >= limit) {
      break;
    }

    const nextStartMs = currentStart.getTime() - stepMs;
    const nextEndMs = currentEnd.getTime() - stepMs;
    const lookbackMs = referenceEndMs - nextStartMs;

    if (lookbackMs > maxLookbackMs) {
      break;
    }

    if (nextEndMs <= nextStartMs) {
      break;
    }

    currentStart = new Date(nextStartMs);
    currentEnd = new Date(nextEndMs);
  }

  const collected = Array.from(collector.entries()).map(([guid, value]) => ({
    guid,
    order: value.order,
    orderTimeMs: value.orderTimeMs,
  }));

  collected.sort((a, b) => {
    const aTime = a.orderTimeMs;
    const bTime = b.orderTimeMs;
    if (aTime === null && bTime === null) {
      return a.guid.localeCompare(b.guid);
    }
    if (aTime === null) {
      return 1;
    }
    if (bTime === null) {
      return -1;
    }
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return a.guid.localeCompare(b.guid);
  });

  const final = collected.slice(0, limit);
  const finalOrders = final.map((entry) => entry.order);
  const finalIds = final.map((entry) => entry.guid);

  const finalWindow = {
    start: toToastIsoUtc(currentStart),
    end: toToastIsoUtc(currentEnd),
  };

  const result: CollectLatestOrdersResult = {
    orders: finalOrders,
    orderIds: finalIds,
    minutes: windowWidthMs > 0 ? Math.round(windowWidthMs / 60_000) : null,
    window: finalWindow,
  };

  if (debug) {
    result.debug = {
      initialWindow,
      windows: windowsDebug,
      totals: {
        returned: totalOrdersReturned,
        filtered: filteredCounts,
        uniqueKept: collector.size,
        finalReturned: finalOrders.length,
        lastSortKey:
          final.length > 0
            ? { orderTimeMs: final[final.length - 1].orderTimeMs, guid: final[final.length - 1].guid }
            : null,
      },
    };
  }

  return result;
}

export function resolveInitialWindow(minutesParam: number | null, now: Date): {
  start: Date;
  end: Date;
  minutes: number | null;
  allowWidening: boolean;
} {
  if (typeof minutesParam === "number" && Number.isFinite(minutesParam) && minutesParam > 0) {
    const minutes = minutesParam;
    return {
      start: new Date(now.getTime() - minutes * 60_000),
      end: new Date(now.getTime()),
      minutes,
      allowWidening: true,
    };
  }

  return {
    start: new Date(now.getTime() - INITIAL_WINDOW_MINUTES * 60_000),
    end: new Date(now.getTime()),
    minutes: INITIAL_WINDOW_MINUTES,
    allowWidening: true,
  };
}

export function normalizeToastTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

function extractOrderTimeMs(order: any): number | null {
  const candidates = [order?.createdDate, order?.openedDate, order?.modifiedDate];
  for (const candidate of candidates) {
    const normalized = normalizeToastTimestamp(typeof candidate === "string" ? candidate : null);
    if (!normalized) {
      continue;
    }
    const parsed = Date.parse(normalized);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isOrderVoided(order: any): boolean {
  return Boolean(order?.voided);
}

function isOrderDeleted(order: any): boolean {
  return Boolean(order?.deleted);
}

function extractOrderLocation(order: any): string | null {
  const candidates = [
    order?.restaurantLocationGuid,
    order?.restaurantGuid,
    order?.locationGuid,
    order?.locationId,
    order?.context?.restaurantLocationGuid,
    order?.context?.locationGuid,
    order?.context?.locationId,
    order?.revenueCenter?.guid,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return null;
}

function extractOrderStatus(order: any): string | null {
  const candidates = [order?.status, order?.orderStatus, order?.approvalStatus];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }
  return null;
}

function normalizeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

function toToastIsoUtc(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const yyyy = date.getUTCFullYear();
  const MM = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const HH = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  const mmm = pad(date.getUTCMilliseconds(), 3);
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.${mmm}+0000`;
}

