import type { AppEnv } from "../config/env.js";
import type { getOrdersBulk } from "../clients/toast.js";
import {
  deriveOrderFulfillmentStatus,
  formatBusinessDate,
  isFulfillmentStatusReady,
  isOrderDeleted,
  isOrderVoided,
  parseToastTimestamp,
  resolveBusinessDate,
  resolveOrderModifiedAt,
  resolveOrderOpenedAt,
  resolveReadyTimestampMs,
  toToastIsoUtc,
} from "./order-utils.js";
import type { CachedOrderRecord, OrderCursor } from "../cache/orders.js";
import {
  getCursor as getCachedCursor,
  getIndexForDate,
  getOrder as getCachedOrder,
  getRecentIndex,
  putOrder as putCachedOrder,
  setCursor as setCachedCursor,
  upsertIntoDateIndex,
  upsertRecentIndex,
} from "../cache/orders.js";

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const FETCH_PAGE_SIZE = 100;
const MAX_PAGES = 200;
const CACHE_VERSION = 1;
const RECENT_INDEX_LIMIT = 300;
const FALLBACK_DAYS = 3;

const EXPAND_FULL = [
  "checks",
  "items",
  "payments",
  "discounts",
  "serviceCharges",
  "customers",
  "employee",
];

export interface CollectLatestOrdersDeps {
  getOrdersBulk: typeof getOrdersBulk;
}

export interface CollectLatestOrdersOptions {
  env: AppEnv;
  deps: CollectLatestOrdersDeps;
  limit: number;
  detail: "ids" | "full";
  locationId: string | null;
  status: string | null;
  debug: boolean;
  since?: Date | null;
  windowOverride?: { start: Date; end: Date } | null;
  now?: Date;
}

export interface CollectLatestOrdersResult {
  orders: any[];
  orderIds: string[];
  minutes: number | null;
  window: { start: string; end: string };
  debug?: CollectLatestOrdersDebug;
}

interface CollectLatestOrdersDebug {
  fetchWindow: { start: string; end: string };
  cursorBefore: OrderCursor | null;
  cursorAfter: OrderCursor | null;
  pages: Array<{ page: number; count: number; nextPage: number | null }>;
  totals: {
    fetched: number;
    written: number;
    skipped: number;
    readyCandidates: number;
  };
}

interface ProcessedOrder extends CachedOrderRecord {
  order: any;
  businessDate: string | null;
  modifiedAtMs: number | null;
  normalizedStatus: string | null;
  readyTimestampMs: number | null;
  isReady: boolean;
  changed: boolean;
}

export async function collectLatestOrders({
  env,
  deps,
  limit,
  detail: _detail = "full",
  locationId,
  status,
  debug,
  since = null,
  windowOverride = null,
  now = new Date(),
}: CollectLatestOrdersOptions): Promise<CollectLatestOrdersResult> {
  const cursorBefore = await getCachedCursor(env);
  const { start, end } = resolveFetchWindow({ now, cursor: cursorBefore, since, windowOverride });

  const startIso = toToastIsoUtc(start);
  const endIso = toToastIsoUtc(end);
  const pagesDebug: CollectLatestOrdersDebug["pages"] = [];
  const processed = new Map<string, ProcessedOrder>();
  const knownRecords = new Map<string, CachedOrderRecord>();
  const byBusinessDate = new Map<string, CachedOrderRecord[]>();
  const readyCandidates: ProcessedOrder[] = [];

  let totalFetched = 0;
  let totalWritten = 0;

  let page = 1;
  while (page <= MAX_PAGES) {
    const { orders, nextPage } = await deps.getOrdersBulk(env, {
      startIso,
      endIso,
      page,
      pageSize: FETCH_PAGE_SIZE,
      expansions: EXPAND_FULL,
    } as any);

    const currentOrders = Array.isArray(orders) ? orders : [];
    totalFetched += currentOrders.length;
    pagesDebug.push({
      page,
      count: currentOrders.length,
      nextPage: typeof nextPage === "number" ? nextPage : null,
    });

    if (currentOrders.length === 0) {
      break;
    }

    for (const order of currentOrders) {
      const guid = typeof order?.guid === "string" ? order.guid : null;
      if (!guid || processed.has(guid)) {
        continue;
      }

      if (isOrderVoided(order) || isOrderDeleted(order)) {
        continue;
      }

      const processedOrder = await processOrder(env, order);
      if (!processedOrder) {
        continue;
      }

      processed.set(guid, processedOrder);
      knownRecords.set(guid, {
        guid,
        openedAtMs: processedOrder.openedAtMs,
        order: processedOrder.order,
      });

      if (processedOrder.businessDate) {
        const list = byBusinessDate.get(processedOrder.businessDate) ?? [];
        list.push({ guid, openedAtMs: processedOrder.openedAtMs, order: processedOrder.order });
        byBusinessDate.set(processedOrder.businessDate, list);
      }

      if (processedOrder.isReady && processedOrder.readyTimestampMs !== null) {
        readyCandidates.push(processedOrder);
      }

      if (processedOrder.changed) {
        totalWritten += 1;
      }
    }

    const hasNextPage = typeof nextPage === "number" && nextPage > page;
    if (!hasNextPage) {
      break;
    }
    page = nextPage;
  }

  for (const [businessDate, entries] of byBusinessDate.entries()) {
    await upsertIntoDateIndex(env, businessDate, entries, { knownOrders: knownRecords });
  }

  if (processed.size > 0) {
    const entries = Array.from(processed.values()).map((value) => ({
      guid: value.guid,
      openedAtMs: value.openedAtMs,
      order: value.order,
    }));
    await upsertRecentIndex(env, entries, { knownOrders: knownRecords, limit: RECENT_INDEX_LIMIT });
  }

  const cursorAfter = await maybeAdvanceCursor(env, cursorBefore, readyCandidates);

  const { orderIds, orders } = await gatherLatestOrders({
    env,
    limit,
    locationId,
    status,
    knownRecords,
  });

  const minutes = computeWindowMinutes(start, end);
  const window = { start: startIso, end: endIso };

  const result: CollectLatestOrdersResult = {
    orders,
    orderIds,
    minutes,
    window,
  };

  if (debug) {
    result.debug = {
      fetchWindow: window,
      cursorBefore,
      cursorAfter,
      pages: pagesDebug,
      totals: {
        fetched: totalFetched,
        written: totalWritten,
        skipped: totalFetched - totalWritten,
        readyCandidates: readyCandidates.length,
      },
    };
  }

  return result;
}

async function processOrder(env: AppEnv, order: any): Promise<ProcessedOrder | null> {
  const guid = typeof order?.guid === "string" ? order.guid : null;
  if (!guid) {
    return null;
  }

  const fulfillment = deriveOrderFulfillmentStatus(order);
  const normalizedStatus = fulfillment.normalizedStatus ?? null;
  const opened = resolveOrderOpenedAt(order);
  const modifiedMs = resolveOrderModifiedAt(order);
  const businessDate = resolveBusinessDate(order, opened.ms);
  const readyTimestamp = isFulfillmentStatusReady(normalizedStatus)
    ? resolveReadyTimestampMs(order) ?? modifiedMs ?? opened.ms
    : null;

  const existing = await getCachedOrder(env, guid);
  const existingModified = existing ? resolveOrderModifiedAt(existing) : null;
  const existingStatus = typeof existing?.normalizedFulfillmentStatus === "string"
    ? existing.normalizedFulfillmentStatus
    : null;
  const existingVersion = typeof existing?.__cacheMeta?.version === "number" ? existing.__cacheMeta.version : 0;

  let statusToStore = normalizedStatus ?? existingStatus ?? null;
  let shouldWrite = false;

  if (!existing) {
    shouldWrite = true;
  } else if (modifiedMs !== null && existingModified !== null && modifiedMs > existingModified) {
    shouldWrite = true;
  } else if (modifiedMs !== null && existingModified === null) {
    shouldWrite = true;
  } else if (statusToStore !== existingStatus) {
    shouldWrite = true;
  } else if (existingVersion < CACHE_VERSION) {
    shouldWrite = true;
  }

  const orderForCache = {
    ...order,
    normalizedFulfillmentStatus: statusToStore,
    __cacheMeta: {
      version: CACHE_VERSION,
      storedAt: toToastIsoUtc(new Date()),
      openedAt: opened.iso,
    },
  };

  if (shouldWrite) {
    await putCachedOrder(env, orderForCache);
  }

  const finalOrder = shouldWrite ? orderForCache : existing ?? orderForCache;
  statusToStore = typeof finalOrder?.normalizedFulfillmentStatus === "string"
    ? finalOrder.normalizedFulfillmentStatus
    : statusToStore;

  return {
    guid,
    order: finalOrder,
    openedAtMs: opened.ms,
    businessDate,
    modifiedAtMs: modifiedMs,
    normalizedStatus: statusToStore,
    readyTimestampMs: readyTimestamp,
    isReady: readyTimestamp !== null && isFulfillmentStatusReady(statusToStore),
    changed: shouldWrite,
  };
}

async function maybeAdvanceCursor(
  env: AppEnv,
  previous: OrderCursor | null,
  candidates: ProcessedOrder[]
): Promise<OrderCursor | null> {
  if (candidates.length === 0) {
    return previous;
  }

  const sorted = candidates
    .filter((candidate) => candidate.readyTimestampMs !== null)
    .sort((a, b) => {
      const aTime = a.readyTimestampMs ?? 0;
      const bTime = b.readyTimestampMs ?? 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return a.guid.localeCompare(b.guid);
    });

  if (sorted.length === 0) {
    return previous;
  }

  const latest = sorted[0];
  const previousMs = previous?.ts ? parseToastTimestamp(previous.ts) : null;
  if (latest.readyTimestampMs === null) {
    return previous;
  }
  if (previousMs !== null && latest.readyTimestampMs <= previousMs) {
    return previous;
  }

  const cursor: OrderCursor = {
    ts: toToastIsoUtc(new Date(latest.readyTimestampMs)),
    orderGuid: latest.guid,
    businessDate: latest.businessDate ? Number(latest.businessDate) : null,
  };
  await setCachedCursor(env, cursor);
  return cursor;
}

async function gatherLatestOrders({
  env,
  limit,
  locationId,
  status,
  knownRecords,
}: {
  env: AppEnv;
  limit: number;
  locationId: string | null;
  status: string | null;
  knownRecords: Map<string, CachedOrderRecord>;
}): Promise<{ orderIds: string[]; orders: any[] }> {
  const candidateIds = await collectCandidateIds(env, limit);
  const uniqueIds = unique(candidateIds);

  const loadedOrders: Array<{ guid: string; order: any; openedAtMs: number | null }> = [];
  for (const guid of uniqueIds) {
    const cached = knownRecords.get(guid);
    if (cached?.order) {
      loadedOrders.push({ guid, order: cached.order, openedAtMs: cached.openedAtMs ?? resolveOrderOpenedAt(cached.order).ms });
      continue;
    }
    const order = await getCachedOrder(env, guid);
    if (!order) {
      continue;
    }
    const opened = resolveOrderOpenedAt(order);
    knownRecords.set(guid, { guid, openedAtMs: opened.ms, order });
    loadedOrders.push({ guid, order, openedAtMs: opened.ms });
  }

  const filtered = loadedOrders.filter(({ order }) =>
    matchesLocation(order, locationId) && matchesStatus(order, status)
  );

  filtered.sort((a, b) => {
    const aTime = a.openedAtMs;
    const bTime = b.openedAtMs;
    if (aTime !== null && bTime !== null && aTime !== bTime) {
      return bTime - aTime;
    }
    if (aTime === null && bTime !== null) {
      return 1;
    }
    if (bTime === null && aTime !== null) {
      return -1;
    }
    return a.guid.localeCompare(b.guid);
  });

  const sliced = filtered.slice(0, limit);
  return {
    orderIds: sliced.map((entry) => entry.guid),
    orders: sliced.map((entry) => entry.order),
  };
}

async function collectCandidateIds(env: AppEnv, limit: number): Promise<string[]> {
  const recent = await getRecentIndex(env);
  if (recent.length >= limit) {
    return recent;
  }

  const now = new Date();
  const additional: string[] = [];
  for (let i = 0; i < FALLBACK_DAYS; i += 1) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = formatBusinessDate(date);
    const entries = await getIndexForDate(env, key);
    for (const guid of entries) {
      additional.push(guid);
    }
    if (recent.length + additional.length >= limit) {
      break;
    }
  }

  return [...recent, ...additional];
}

function resolveFetchWindow({
  now,
  cursor,
  since,
  windowOverride,
}: {
  now: Date;
  cursor: OrderCursor | null;
  since: Date | null;
  windowOverride: { start: Date; end: Date } | null;
}): { start: Date; end: Date } {
  if (windowOverride) {
    return { start: windowOverride.start, end: windowOverride.end };
  }

  let start = since ?? null;
  if (!start && cursor?.ts) {
    const parsed = parseToastTimestamp(cursor.ts);
    if (parsed !== null) {
      start = new Date(parsed);
    }
  }

  if (!start) {
    start = new Date(now.getTime() - DEFAULT_LOOKBACK_MS);
  }

  const end = new Date(now.getTime());

  if (end.getTime() <= start.getTime()) {
    start = new Date(end.getTime() - DEFAULT_LOOKBACK_MS);
  }

  return { start, end };
}

function computeWindowMinutes(start: Date, end: Date): number | null {
  const diff = end.getTime() - start.getTime();
  if (diff <= 0) {
    return null;
  }
  return Math.round(diff / 60_000);
}

function matchesLocation(order: any, locationId: string | null): boolean {
  if (!locationId) {
    return true;
  }
  const normalizedTarget = normalizeString(locationId);
  if (!normalizedTarget) {
    return true;
  }
  const location = normalizeString(extractOrderLocation(order));
  if (!location) {
    return false;
  }
  return location === normalizedTarget;
}

function matchesStatus(order: any, status: string | null): boolean {
  if (!status) {
    return true;
  }
  const normalizedTarget = normalizeString(status);
  if (!normalizedTarget) {
    return true;
  }
  const value = normalizeString(extractOrderStatus(order));
  if (!value) {
    return false;
  }
  return value === normalizedTarget;
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

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}
