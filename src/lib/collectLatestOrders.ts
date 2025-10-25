import type { AppEnv } from "../config/env.js";
import type { getOrdersBulk } from "../clients/toast.js";
import {
  deriveOrderFulfillmentStatus,
  isOrderDeleted,
  isOrderVoided,
  resolveOrderOpenedAt,
  toToastIsoUtc,
} from "./order-utils.js";

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const MIN_PAGE_SIZE = 1;
const MAX_PAGES = 200;

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
  pageSize?: number | null;
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
  pageSize: number;
  debug?: CollectLatestOrdersDebug;
  sources?: Array<{ id: string; source: OrderSourceType }>;
}

interface CollectLatestOrdersDebug {
  fetchWindow: { start: string; end: string };
  pages: Array<{ page: number; count: number; returned: number; nextPage: number | null }>;
  totals: { fetched: number; kept: number; skipped: number };
  params?: {
    limit: number;
    detail: "ids" | "full";
    debug: boolean;
    since: string | null;
    locationId: string | null;
    status: string | null;
    pageSize: number;
  };
  resultCount?: number;
  timing?: { totalMs: number };
  cache?: { hits: number; misses: number; updated: number };
  api?: { requests: number; pages: Array<{ page: number; returned: number; nextPage: number | null }> };
}

interface LoadedOrder {
  guid: string;
  order: any;
  openedAtMs: number | null;
}

type OrderSourceType = "api";

export async function collectLatestOrders({
  env,
  deps,
  limit,
  detail: _detail = "full",
  locationId,
  status,
  debug,
  pageSize = null,
  since = null,
  sinceRaw = null,
  windowOverride = null,
  now = new Date(),
}: CollectLatestOrdersOptions): Promise<CollectLatestOrdersResult> {
  const fetchStart = Date.now();
  const getOrdersBulkImpl = typeof (env as any).__TEST_GET_ORDERS_BULK === "function"
    ? ((env as any).__TEST_GET_ORDERS_BULK as CollectLatestOrdersDeps["getOrdersBulk"])
    : deps.getOrdersBulk;

  const { start, end } = resolveFetchWindow({ now, since, windowOverride });
  const startIso = toToastIsoUtc(start);
  const endIso = toToastIsoUtc(end);
  const resolvedPageSize = resolvePageSize(pageSize);

  const pagesDebug: CollectLatestOrdersDebug["pages"] = [];
  const collected: LoadedOrder[] = [];
  const seenGuids = new Set<string>();

  let totalFetched = 0;
  let page = 1;

  while (page <= MAX_PAGES) {
    const { orders, nextPage } = await getOrdersBulkImpl(env, {
      startIso,
      endIso,
      page,
      pageSize: resolvedPageSize,
      expansions: EXPAND_FULL,
    } as any);

    const currentOrders = Array.isArray(orders) ? orders : [];
    totalFetched += currentOrders.length;

    const next = typeof nextPage === "number" && nextPage > page ? nextPage : null;
    pagesDebug.push({
      page,
      count: currentOrders.length,
      returned: currentOrders.length,
      nextPage: next,
    });

    for (const order of currentOrders) {
      const guid = typeof order?.guid === "string" ? order.guid : null;
      if (!guid || seenGuids.has(guid)) {
        continue;
      }
      if (isOrderVoided(order) || isOrderDeleted(order)) {
        continue;
      }

      const opened = resolveOrderOpenedAt(order);
      collected.push({ guid, order, openedAtMs: opened.ms });
      seenGuids.add(guid);
    }

    const filteredCount = applyFilters(collected, locationId, status).length;
    if (filteredCount >= limit) {
      break;
    }

    if (!next) {
      break;
    }

    page = next;
  }

  const filtered = applyFilters(collected, locationId, status);
  sortOrders(filtered);

  const sliced = filtered.slice(0, limit);
  const orderIds = sliced.map((entry) => entry.guid);
  const orders = sliced.map((entry) => entry.order);

  const minutes = computeWindowMinutes(start, end);
  const window = { start: startIso, end: endIso };

  const result: CollectLatestOrdersResult = {
    orders,
    orderIds,
    minutes,
    window,
    pageSize: resolvedPageSize,
  };

  if (debug) {
    const totalMs = Date.now() - fetchStart;
    result.sources = orderIds.map((id) => ({ id, source: "api" }));
    result.debug = {
      fetchWindow: window,
      pages: pagesDebug,
      totals: {
        fetched: totalFetched,
        kept: collected.length,
        skipped: totalFetched - collected.length,
      },
      params: {
        limit,
        detail: _detail,
        debug,
        since: sinceRaw ?? (since ? toToastIsoUtc(since) : null),
        locationId,
        status,
        pageSize: resolvedPageSize,
      },
      resultCount: orderIds.length,
      timing: { totalMs },
      api: {
        requests: pagesDebug.length,
        pages: pagesDebug.map((pageInfo) => ({
          page: pageInfo.page,
          returned: pageInfo.returned,
          nextPage: pageInfo.nextPage,
        })),
      },
    };
  }

  return result;
}

function resolveFetchWindow({
  now,
  since,
  windowOverride,
}: {
  now: Date;
  since: Date | null;
  windowOverride: { start: Date; end: Date } | null;
}): { start: Date; end: Date } {
  if (windowOverride) {
    return { start: windowOverride.start, end: windowOverride.end };
  }

  const end = new Date(now.getTime());
  let start = since ? new Date(since.getTime()) : startOfCalendarDay(now);

  if (end.getTime() <= start.getTime()) {
    if (since) {
      start = new Date(end.getTime() - DEFAULT_LOOKBACK_MS);
    } else {
      const fallbackStart = startOfCalendarDay(end);
      start =
        fallbackStart.getTime() < end.getTime()
          ? fallbackStart
          : new Date(end.getTime() - 60_000);
    }
  }

  return { start, end };
}

function resolvePageSize(pageSize: number | null | undefined): number {
  if (typeof pageSize !== "number" || !Number.isFinite(pageSize)) {
    return DEFAULT_PAGE_SIZE;
  }
  const normalized = Math.trunc(pageSize);
  if (Number.isNaN(normalized)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, normalized));
}

function startOfCalendarDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function computeWindowMinutes(start: Date, end: Date): number | null {
  const diff = end.getTime() - start.getTime();
  if (diff <= 0) {
    return null;
  }
  return Math.round(diff / 60_000);
}

function applyFilters(orders: LoadedOrder[], locationId: string | null, status: string | null): LoadedOrder[] {
  return orders.filter(({ order }) => matchesLocation(order, locationId) && matchesStatus(order, status));
}

function sortOrders(orders: LoadedOrder[]): void {
  orders.sort((a, b) => {
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
  if (!order || typeof order !== "object") {
    return null;
  }

  const candidates = [
    order.normalizedFulfillmentStatus,
    order.status,
    order.orderStatus,
    order.approvalStatus,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  const derived = deriveOrderFulfillmentStatus(order);
  return derived.normalizedStatus ?? null;
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
