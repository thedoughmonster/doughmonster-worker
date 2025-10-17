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
  sinceRaw?: string | null;
  windowOverride?: { start: Date; end: Date } | null;
  now?: Date;
}

export interface CollectLatestOrdersResult {
  orders: any[];
  orderIds: string[];
  minutes: number | null;
  window: { start: string; end: string };
  debug?: CollectLatestOrdersDebug;
  sources?: Array<{ id: string; source: OrderSourceType }>;
}

interface CollectLatestOrdersDebug {
  fetchWindow: { start: string; end: string };
  cursorBefore: OrderCursor | null;
  cursorAfter: OrderCursor | null;
  pages: Array<{ page: number; count: number; returned: number; nextPage: number | null }>;
  totals: {
    fetched: number;
    written: number;
    skipped: number;
    readyCandidates: number;
  };
  kv?: {
    reads: number;
    writes: number;
    indexLoads: number;
    indexWrites: number;
    bytesRead?: number;
    bytesWritten?: number;
  };
  api?: {
    requests: number;
    pages: Array<{ page: number; returned: number; count: number; nextPage: number | null }>;
  };
  cache?: {
    hits: number;
    misses: number;
    updated: number;
  };
  cursor?: {
    before: OrderCursor | null;
    after: OrderCursor | null;
  };
  timing?: {
    toastFetchMs: number;
    kvMs: number;
    totalMs: number;
  };
  params?: {
    limit: number;
    detail: "ids" | "full";
    debug: boolean;
    since: string | null;
    locationId: string | null;
    status: string | null;
  };
  resultCount?: number;
}

interface ProcessedOrder extends CachedOrderRecord {
  order: any;
  businessDate: string | null;
  modifiedAtMs: number | null;
  normalizedStatus: string | null;
  readyTimestampMs: number | null;
  isReady: boolean;
  changed: boolean;
  source: OrderSourceType;
}

type OrderSourceType = "cache" | "api" | "merged";

export async function collectLatestOrders({
  env,
  deps,
  limit,
  detail: _detail = "full",
  locationId,
  status,
  debug,
  since = null,
  sinceRaw = null,
  windowOverride = null,
  now = new Date(),
}: CollectLatestOrdersOptions): Promise<CollectLatestOrdersResult> {
  const telemetry = createOrdersTelemetry(env, debug);
  const workingEnv = telemetry.env;
  const cursorBefore = await getCachedCursor(workingEnv);
  const { start, end } = resolveFetchWindow({ now, cursor: cursorBefore, since, windowOverride });

  const startIso = toToastIsoUtc(start);
  const endIso = toToastIsoUtc(end);
  const pagesDebug: CollectLatestOrdersDebug["pages"] = [];
  const processed = new Map<string, ProcessedOrder>();
  const knownRecords = new Map<string, CachedOrderRecord>();
  const byBusinessDate = new Map<string, CachedOrderRecord[]>();
  const readyCandidates: ProcessedOrder[] = [];
  const orderSources = new Map<string, OrderSourceType>();

  let totalFetched = 0;
  let totalWritten = 0;

  let page = 1;
  while (page <= MAX_PAGES) {
    const apiStart = telemetry.now();
    const { orders, nextPage } = await deps.getOrdersBulk(workingEnv, {
      startIso,
      endIso,
      page,
      pageSize: FETCH_PAGE_SIZE,
      expansions: EXPAND_FULL,
    } as any);
    telemetry.recordApiRequest(apiStart);

    const currentOrders = Array.isArray(orders) ? orders : [];
    totalFetched += currentOrders.length;
    pagesDebug.push({
      page,
      count: currentOrders.length,
      returned: currentOrders.length,
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

      const processedOrder = await processOrder(workingEnv, order, telemetry);
      if (!processedOrder) {
        continue;
      }

      processed.set(guid, processedOrder);
      knownRecords.set(guid, {
        guid,
        openedAtMs: processedOrder.openedAtMs,
        order: processedOrder.order,
      });
      orderSources.set(guid, processedOrder.source);

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
    await upsertIntoDateIndex(workingEnv, businessDate, entries, { knownOrders: knownRecords });
  }

  if (processed.size > 0) {
    const entries = Array.from(processed.values()).map((value) => ({
      guid: value.guid,
      openedAtMs: value.openedAtMs,
      order: value.order,
    }));
    await upsertRecentIndex(workingEnv, entries, { knownOrders: knownRecords, limit: RECENT_INDEX_LIMIT });
  }

  const cursorAfter = await maybeAdvanceCursor(workingEnv, cursorBefore, readyCandidates);

  const { orderIds, orders } = await gatherLatestOrders({
    env: workingEnv,
    limit,
    locationId,
    status,
    knownRecords,
    orderSources,
  });

  const minutes = computeWindowMinutes(start, end);
  const window = { start: startIso, end: endIso };
  const totalMs = telemetry.totalMs();

  const result: CollectLatestOrdersResult = {
    orders,
    orderIds,
    minutes,
    window,
  };

  if (debug) {
    const sources = orderIds.map((id) => ({ id, source: orderSources.get(id) ?? "cache" }));
    result.sources = sources;

    const sinceEcho = sinceRaw ?? (since ? toToastIsoUtc(since) : null);
    telemetry.setResultCount(orderIds.length);
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
      kv: {
        reads: telemetry.metrics.kvReads,
        writes: telemetry.metrics.kvWrites,
        indexLoads: telemetry.metrics.indexLoads,
        indexWrites: telemetry.metrics.indexWrites,
        bytesRead: telemetry.metrics.kvBytesRead,
        bytesWritten: telemetry.metrics.kvBytesWritten,
      },
      api: {
        requests: telemetry.metrics.apiRequests,
        pages: pagesDebug.map((pageInfo) => ({
          page: pageInfo.page,
          returned: pageInfo.returned ?? pageInfo.count,
          count: pageInfo.count,
          nextPage: pageInfo.nextPage ?? null,
        })),
      },
      cache: {
        hits: telemetry.metrics.cacheHits,
        misses: telemetry.metrics.cacheMisses,
        updated: telemetry.metrics.cacheUpdated,
      },
      cursor: {
        before: cursorBefore,
        after: cursorAfter,
      },
      timing: {
        toastFetchMs: Math.round(telemetry.metrics.toastFetchMs),
        kvMs: Math.round(telemetry.metrics.kvMs),
        totalMs: Math.round(totalMs),
      },
      params: {
        limit,
        detail: _detail,
        debug: true,
        since: sinceEcho,
        locationId,
        status,
      },
      resultCount: orderIds.length,
    };
  }

  return result;
}

async function processOrder(env: AppEnv, order: any, telemetry: OrdersTelemetry): Promise<ProcessedOrder | null> {
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

  if (shouldWrite && existing) {
    telemetry.recordCacheUpdated();
  }

  const finalOrder = shouldWrite ? orderForCache : existing ?? orderForCache;
  statusToStore = typeof finalOrder?.normalizedFulfillmentStatus === "string"
    ? finalOrder.normalizedFulfillmentStatus
    : statusToStore;

  const source: OrderSourceType = !existing ? "api" : shouldWrite ? "merged" : "cache";

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
    source,
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
  orderSources,
}: {
  env: AppEnv;
  limit: number;
  locationId: string | null;
  status: string | null;
  knownRecords: Map<string, CachedOrderRecord>;
  orderSources: Map<string, OrderSourceType>;
}): Promise<{ orderIds: string[]; orders: any[] }> {
  const candidateIds = await collectCandidateIds(env, limit);
  const uniqueIds = unique(candidateIds);

  const loadedOrders: Array<{ guid: string; order: any; openedAtMs: number | null }> = [];
  for (const guid of uniqueIds) {
    const cached = knownRecords.get(guid);
    if (cached?.order) {
      if (!orderSources.has(guid)) {
        orderSources.set(guid, "cache");
      }
      loadedOrders.push({ guid, order: cached.order, openedAtMs: cached.openedAtMs ?? resolveOrderOpenedAt(cached.order).ms });
      continue;
    }
    const order = await getCachedOrder(env, guid);
    if (!order) {
      continue;
    }
    const opened = resolveOrderOpenedAt(order);
    knownRecords.set(guid, { guid, openedAtMs: opened.ms, order });
    if (!orderSources.has(guid)) {
      orderSources.set(guid, "cache");
    }
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

interface TelemetryMetrics {
  kvReads: number;
  kvWrites: number;
  kvMs: number;
  kvBytesRead: number;
  kvBytesWritten: number;
  indexLoads: number;
  indexWrites: number;
  toastFetchMs: number;
  apiRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheUpdated: number;
  resultCount: number;
}

interface OrdersTelemetry {
  enabled: boolean;
  env: AppEnv;
  metrics: TelemetryMetrics;
  now(): number;
  recordApiRequest(startTime: number): void;
  recordCacheUpdated(): void;
  setResultCount(count: number): void;
  totalMs(): number;
}

function createOrdersTelemetry(env: AppEnv, enabled: boolean): OrdersTelemetry {
  const nowFn = typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();
  const start = nowFn();

  const metrics: TelemetryMetrics = {
    kvReads: 0,
    kvWrites: 0,
    kvMs: 0,
    kvBytesRead: 0,
    kvBytesWritten: 0,
    indexLoads: 0,
    indexWrites: 0,
    toastFetchMs: 0,
    apiRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheUpdated: 0,
    resultCount: 0,
  };

  if (!enabled) {
    return {
      enabled: false,
      env,
      metrics,
      now: nowFn,
      recordApiRequest: () => {},
      recordCacheUpdated: () => {},
      setResultCount: () => {},
      totalMs: () => nowFn() - start,
    };
  }

  const baseKv = env.CACHE_KV;
  const instrumentedKv = {
    async get(key: string, ...rest: any[]): Promise<any> {
      const opStart = nowFn();
      const result = await (baseKv as any).get(key, ...rest);
      const duration = nowFn() - opStart;
      metrics.kvMs += duration;
      metrics.kvReads += 1;
      if (typeof result === "string") {
        metrics.kvBytesRead += result.length;
      }
      if (isIndexKey(key)) {
        metrics.indexLoads += 1;
      }
      if (isOrderKey(key)) {
        if (result === null || result === undefined) {
          metrics.cacheMisses += 1;
        } else {
          metrics.cacheHits += 1;
        }
      }
      return result;
    },
    async put(key: string, value: string, ...rest: any[]): Promise<any> {
      const opStart = nowFn();
      const result = await (baseKv as any).put(key, value, ...rest);
      const duration = nowFn() - opStart;
      metrics.kvMs += duration;
      metrics.kvWrites += 1;
      if (typeof value === "string") {
        metrics.kvBytesWritten += value.length;
      }
      if (isIndexKey(key)) {
        metrics.indexWrites += 1;
      }
      return result;
    },
  };

  const instrumentedEnv = {
    ...env,
    CACHE_KV: instrumentedKv,
  } as AppEnv;

  return {
    enabled: true,
    env: instrumentedEnv,
    metrics,
    now: nowFn,
    recordApiRequest(startTime: number) {
      const duration = nowFn() - startTime;
      metrics.toastFetchMs += duration;
      metrics.apiRequests += 1;
    },
    recordCacheUpdated() {
      metrics.cacheUpdated += 1;
    },
    setResultCount(count: number) {
      metrics.resultCount = count;
    },
    totalMs() {
      return nowFn() - start;
    },
  };
}

function isOrderKey(key: string): boolean {
  return typeof key === "string" && key.startsWith("orders:byId:");
}

function isIndexKey(key: string): boolean {
  if (typeof key !== "string") {
    return false;
  }
  return key.startsWith("orders:index:") || key === "orders:recentIndex";
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
