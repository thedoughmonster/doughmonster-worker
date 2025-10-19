import type { AppEnv } from "../config/env.js";
import { getDiningOptions, type DiningOptionConfig } from "../clients/toast.js";
import { jsonResponse } from "../lib/http.js";
import { fetchMenuFromWorker, fetchOrdersFromWorker } from "./items-expanded/fetchers.js";
import { buildExpandedOrders, extractOrders } from "./items-expanded/compose.js";
import {
  extractCustomerName,
  normalizeName,
  normalizeOrderType,
  pickStringPaths,
} from "./items-expanded/extractors.js";
import type {
  DiagnosticsCounters,
  ExpandedOrder,
  MenusResponse,
  OrdersLatestResponse,
  UpstreamTrace,
} from "./items-expanded/types-local.js";
import type { ToastCheck, ToastOrder } from "../types/toast-orders.js";

const ORDERS_ENDPOINT = "/api/orders/latest";
const MENUS_ENDPOINT = "/api/menus";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;
const ORDERS_UPSTREAM_DEFAULT = 60;
const ORDERS_UPSTREAM_MAX = 200;
const HANDLER_TIME_BUDGET_MS = 10_000;
const DEFAULT_FALLBACK_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

interface ItemsExpandedDependencies {
  getDiningOptions: (env: AppEnv) => Promise<DiningOptionConfig[]>;
}

interface ItemsExpandedFactoryOptions extends Partial<ItemsExpandedDependencies> {
  fetch?: typeof fetch;
}

const DEFAULT_DEPS: ItemsExpandedDependencies = {
  getDiningOptions,
};

function ensureCacheNamespace(env: AppEnv): AppEnv {
  const candidate = (env as any)?.CACHE_KV;
  if (candidate && typeof candidate.get === "function" && typeof candidate.put === "function") {
    return env;
  }

  const store = new Map<string, string>();

  const ensureDefaults = () => {
    if (!store.has("menu:published:v1")) {
      store.set("menu:published:v1", "null");
    }
    if (!store.has("menu:published:meta:v1")) {
      const now = Date.now();
      const meta = {
        updatedAt: new Date(now).toISOString(),
        staleAt: new Date(now + 30 * 60 * 1000).toISOString(),
        expireAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      };
      store.set("menu:published:meta:v1", JSON.stringify(meta));
    }
  };

  const fallback = {
    async get(key: string) {
      ensureDefaults();
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
      return undefined;
    },
    async delete(key: string) {
      store.delete(key);
      return undefined;
    },
    async list() {
      ensureDefaults();
      return {
        keys: Array.from(store.keys()).map((name) => ({ name, expiration: null, metadata: null })),
        list_complete: true,
        cursor: null,
        cacheStatus: null,
      };
    },
  } as unknown as KVNamespace;

  (env as any).CACHE_KV = fallback;
  return env;
}

export function createItemsExpandedHandler(options: ItemsExpandedFactoryOptions = {}) {
  const deps: ItemsExpandedDependencies = {
    getDiningOptions: options.getDiningOptions ?? DEFAULT_DEPS.getDiningOptions,
  };

  const customFetch = options.fetch;

  return async function handler(env: AppEnv, request: Request): Promise<Response> {
    const previousFetch = globalThis.fetch;
    const shouldOverrideFetch = typeof customFetch === "function";
    if (shouldOverrideFetch) {
      (globalThis as any).fetch = customFetch as typeof fetch;
    }

    try {
      const runtimeEnv = ensureCacheNamespace(env);
      return handleItemsExpanded(runtimeEnv, request, deps);
    } finally {
      if (shouldOverrideFetch) {
        (globalThis as any).fetch = previousFetch;
      }
    }
  };
}

export default createItemsExpandedHandler();

async function handleItemsExpanded(
  env: AppEnv,
  request: Request,
  deps: ItemsExpandedDependencies
): Promise<Response> {
  const startedAt = Date.now();
  const requestId = Math.random().toString(36).slice(2, 10);
  const url = new URL(request.url);
  const origin = url.origin;

  const debugRequested = url.searchParams.get("debug") === "1";
  const refreshRequested = url.searchParams.get("refresh") === "1";
  const finalLimit = clamp(parseNumber(url.searchParams.get("limit"), DEFAULT_LIMIT), 1, MAX_LIMIT);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const statusParam = url.searchParams.get("status");
  const locationParam = url.searchParams.get("locationId");
  const detailParam = url.searchParams.get("detail");
  const requestedLimit = parseNumber(url.searchParams.get("limit"), ORDERS_UPSTREAM_DEFAULT);
  const upstreamLimit = clamp(
    Math.max(finalLimit * 3, requestedLimit ?? ORDERS_UPSTREAM_DEFAULT),
    1,
    ORDERS_UPSTREAM_MAX
  );
  const rangeMode = Boolean(startParam || endParam);
  const lookbackWindowsTried: number[] = [];
  let ordersFetched = 0;

  const ordersUrl = new URL(ORDERS_ENDPOINT, origin);
  ordersUrl.searchParams.set("limit", String(upstreamLimit));
  ordersUrl.searchParams.set("detail", detailParam ?? "full");
  if (startParam) ordersUrl.searchParams.set("start", startParam);
  if (endParam) ordersUrl.searchParams.set("end", endParam);
  if (statusParam) ordersUrl.searchParams.set("status", statusParam);
  if (locationParam) ordersUrl.searchParams.set("locationId", locationParam);

  const menuUrl = new URL(MENUS_ENDPOINT, origin);
  if (refreshRequested) menuUrl.searchParams.set("refresh", "1");

  const [ordersResult, menuResult] = await Promise.all([
    fetchOrdersFromWorker(env, request, ordersUrl, { rangeMode }),
    fetchMenuFromWorker(env, request, menuUrl),
  ]);

  const timingMs = Date.now() - startedAt;
  const ordersTrace = ordersResult.trace;
  const menuTrace = menuResult.trace;

  const ordersPayload = ordersResult.ok ? ordersResult.data : null;
  const menuPayload = menuResult.ok ? menuResult.data.payload : null;
  const ordersOk = Boolean(ordersPayload && (ordersPayload as OrdersLatestResponse).ok);
  const menuOk = Boolean(menuPayload && (menuPayload as MenusResponse).ok);

  if (!ordersResult.ok || !menuResult.ok || !ordersOk || !menuOk) {
    const ordersBody = ordersOk ? (ordersPayload as OrdersLatestResponse & { ok: true }) : null;
    const debug = buildDebugPayload({
      requestId,
      timingMs,
      ordersTrace,
      menuTrace,
      window: {
        startIso: ordersBody?.window?.start ?? startParam ?? null,
        endIso: ordersBody?.window?.end ?? endParam ?? null,
      },
      limit: finalLimit,
      originSeen: origin,
      lastPage: 1,
      timedOut: false,
      lookbackWindowsTried,
      ordersFetched,
    });

    const message = !ordersResult.ok
      ? ordersResult.error.message
      : !menuResult.ok
      ? menuResult.error.message
      : !ordersOk
      ? extractErrorMessage(ordersPayload as OrdersLatestResponse)
      : extractErrorMessage(menuPayload as MenusResponse);

    return jsonResponse(
      {
        error: { message: message ?? "Upstream service unavailable", code: "UPSTREAM_UNAVAILABLE" },
        debug,
      },
      { status: 502 }
    );
  }

  let ordersBody = ordersPayload as OrdersLatestResponse & { ok: true };
  const menuBody = menuPayload as MenusResponse & { ok: true };

  const uniqueOrders = new Map<string, ToastOrder>();
  const addOrders = (orders: ToastOrder[]) => {
    for (const order of orders) {
      if (!order || typeof order !== "object") continue;
      const guid = typeof (order as any)?.guid === "string" ? (order as any).guid : null;
      if (!guid || uniqueOrders.has(guid)) continue;
      uniqueOrders.set(guid, order);
    }
  };

  addOrders(extractOrders(ordersBody));

  if (!rangeMode && uniqueOrders.size < finalLimit) {
    const lookbackWindows = [60, 240, 480, 1440, 2880, 4320, 10080];
    for (const minutes of lookbackWindows) {
      if (uniqueOrders.size >= finalLimit) break;
      if (minutes * 60_000 > DEFAULT_FALLBACK_RANGE_MS) break;
      const lookbackUrl = new URL(ordersUrl.toString());
      const nextResult = await fetchOrdersFromWorker(env, request, lookbackUrl, { rangeMode, minutes });
      lookbackWindowsTried.push(minutes);
      if (!nextResult.ok) break;
      const nextPayload = nextResult.data;
      if (!nextPayload?.ok) break;
      addOrders(extractOrders(nextPayload as OrdersLatestResponse & { ok: true }));
    }
  }

  const aggregatedOrders = Array.from(uniqueOrders.values());
  const checkLookup = buildCheckLookup(aggregatedOrders);
  ordersFetched = aggregatedOrders.length;
  ordersBody = { ...ordersBody, data: aggregatedOrders, orders: aggregatedOrders };

  menuTrace.cacheStatus = menuBody.cacheHit ? "hit-fresh" : "miss-network";
  menuTrace.updatedAt = menuBody.metadata?.lastUpdated ?? null;
  menuTrace.cacheHit = Boolean(menuBody.cacheHit);

  const build = buildExpandedOrders({
    ordersPayload: ordersBody,
    menuDocument: menuBody.menu ?? null,
    limit: finalLimit,
    startedAt,
    timeBudgetMs: HANDLER_TIME_BUDGET_MS,
  });

  await enrichExpandedOrders(build.orders, checkLookup, env, deps);

  const response: any = {
    orders: build.orders,
    cacheInfo: {
      menu: menuBody.cacheHit ? "hit-fresh" : "miss-network",
      menuUpdatedAt: menuBody.metadata?.lastUpdated ?? null,
    },
  };

  if (debugRequested) {
    response.debug = buildDebugPayload({
      requestId,
      timingMs,
      ordersTrace,
      menuTrace,
      window: {
        startIso: ordersBody.window?.start ?? startParam ?? null,
        endIso: ordersBody.window?.end ?? endParam ?? null,
      },
      limit: finalLimit,
      originSeen: origin,
      lastPage: 1,
      timedOut: build.timedOut,
      lookbackWindowsTried,
      ordersFetched,
      diagnostics: build.diagnostics,
    });
  }

  return jsonResponse(response);
}

interface CheckLookupRecord {
  order: ToastOrder;
  check: ToastCheck;
}

interface NormalizedDiningOptionRecord {
  guid: string;
  behavior: string | null;
  name: string | null;
}

interface DiningOptionsLookup {
  byGuid: Map<string, NormalizedDiningOptionRecord>;
}

function buildCheckLookup(orders: ToastOrder[]): Map<string, CheckLookupRecord> {
  const map = new Map<string, CheckLookupRecord>();
  for (const order of orders) {
    const checks = Array.isArray((order as any)?.checks) ? ((order as any).checks as ToastCheck[]) : [];
    for (const check of checks) {
      if (!check || typeof check !== "object") continue;
      const orderId = pickStringPaths(order, check, ["order.guid", "order.id"]);
      if (!orderId) continue;
      const checkId = pickStringPaths(order, check, ["check.guid", "check.id"]);
      const key = makeOrderCheckKey(orderId, checkId);
      if (!map.has(key)) {
        map.set(key, { order, check });
      }
    }
  }
  return map;
}

function makeOrderCheckKey(orderId: string, checkId: string | null): string {
  return `${orderId}::${checkId ?? ""}`;
}

async function enrichExpandedOrders(
  expandedOrders: ExpandedOrder[],
  checkLookup: Map<string, CheckLookupRecord>,
  env: AppEnv,
  deps: ItemsExpandedDependencies
): Promise<void> {
  if (expandedOrders.length === 0) return;

  let lookupPromise: Promise<DiningOptionsLookup> | null = null;
  const ensureLookup = async () => {
    if (!lookupPromise) {
      lookupPromise = loadDiningOptionsLookup(env, deps);
    }
    return lookupPromise;
  };

  for (const entry of expandedOrders) {
    const { orderData } = entry;
    const key = makeOrderCheckKey(orderData.orderId, orderData.checkId);
    const raw = checkLookup.get(key);
    if (!raw) continue;

    const resolvedName = extractCustomerName(raw.order, raw.check);
    if (resolvedName) {
      orderData.customerName = resolvedName;
    }

    const directMeta = collectDirectDiningOptionMeta(
      raw.order,
      raw.check,
      orderData.diningOptionGuid ?? null
    );

    let guid = directMeta.guid ?? orderData.diningOptionGuid ?? null;
    let behavior = directMeta.behavior ?? null;
    let optionName = directMeta.name ?? null;
    let normalizedOrderType = behavior ? normalizeOrderType(behavior) : null;

    if (guid) {
      const normalizedGuid = guid.toLowerCase();
      if (!behavior || !optionName || !normalizedOrderType) {
        const lookup = await ensureLookup();
        const config = lookup.byGuid.get(normalizedGuid) ?? null;
        if (config) {
          if (!guid) guid = config.guid;
          if (!behavior && config.behavior) {
            behavior = config.behavior;
            normalizedOrderType = normalizeOrderType(config.behavior);
          } else if (!normalizedOrderType && config.behavior) {
            const mapped = normalizeOrderType(config.behavior);
            if (mapped) {
              behavior = config.behavior;
              normalizedOrderType = mapped;
            }
          }
          if (!optionName && config.name) {
            optionName = config.name;
          }
        }
      }
    }

    if (guid && !orderData.diningOptionGuid) {
      orderData.diningOptionGuid = guid;
    }

    if (optionName) {
      (orderData as any).diningOptionName = optionName;
    }

    if (behavior) {
      (orderData as any).diningOptionBehavior = behavior;
    }

    if ((orderData.orderType === "UNKNOWN" || !orderData.orderType) && normalizedOrderType) {
      orderData.orderType = normalizedOrderType;
    }
  }
}

function collectDirectDiningOptionMeta(
  order: ToastOrder,
  check: ToastCheck,
  existingGuid: string | null
): { guid: string | null; behavior: string | null; name: string | null } {
  const guid = firstString([
    existingGuid,
    (check as any)?.diningOptionGuid,
    (check as any)?.diningOption?.guid,
    (check as any)?.diningOption?.id,
    (order as any)?.diningOptionGuid,
    (order as any)?.diningOption?.guid,
    (order as any)?.diningOption?.id,
    (order as any)?.context?.diningOption?.guid,
    (order as any)?.context?.diningOption?.id,
  ]);

  const behavior = firstString([
    (check as any)?.diningOption?.behavior,
    (check as any)?.diningOption?.type,
    (check as any)?.diningOption?.mode,
    (check as any)?.diningOptionType,
    (order as any)?.diningOption?.behavior,
    (order as any)?.diningOption?.type,
    (order as any)?.diningOption?.mode,
    (order as any)?.diningOptionType,
    (order as any)?.context?.diningOption?.behavior,
    (order as any)?.context?.diningOption?.type,
    (order as any)?.context?.diningOption?.mode,
    (order as any)?.context?.diningOptionType,
  ]);

  const name = firstString([
    (check as any)?.diningOption?.name,
    (check as any)?.diningOption?.displayName,
    (order as any)?.diningOption?.name,
    (order as any)?.diningOption?.displayName,
    (order as any)?.context?.diningOption?.name,
    (order as any)?.context?.diningOption?.displayName,
  ]);

  return { guid, behavior, name };
}

async function loadDiningOptionsLookup(
  env: AppEnv,
  deps: ItemsExpandedDependencies
): Promise<DiningOptionsLookup> {
  try {
    const options = await deps.getDiningOptions(env);
    return createDiningOptionsLookup(Array.isArray(options) ? options : []);
  } catch (err) {
    console.warn("failed to load dining options", { err });
    return createDiningOptionsLookup([]);
  }
}

function createDiningOptionsLookup(options: DiningOptionConfig[]): DiningOptionsLookup {
  const byGuid = new Map<string, NormalizedDiningOptionRecord>();
  for (const option of options) {
    const guid = normalizeGuid(option.guid);
    if (!guid) continue;

    const behavior = firstString([option.behavior, (option as any)?.type, (option as any)?.mode]);
    const name = firstString([option.name, (option as any)?.displayName]);

    if (!byGuid.has(guid.toLowerCase())) {
      byGuid.set(guid.toLowerCase(), {
        guid,
        behavior: behavior ?? null,
        name: name ?? null,
      });
    }
  }

  return { byGuid };
}

function firstString(values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = normalizeName(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizeGuid(value: unknown): string | null {
  const normalized = firstString([value]);
  return normalized ?? null;
}

function buildDebugPayload(args: {
  requestId: string;
  timingMs: number;
  ordersTrace: UpstreamTrace;
  menuTrace: UpstreamTrace;
  window: { startIso: string | null; endIso: string | null };
  limit: number;
  originSeen: string;
  lastPage: number;
  timedOut: boolean;
  diagnostics?: DiagnosticsCounters;
  lookbackWindowsTried?: number[];
  ordersFetched?: number;
}) {
  const lookback = Array.isArray(args.lookbackWindowsTried) ? args.lookbackWindowsTried : [];
  const fetched = typeof args.ordersFetched === "number" ? args.ordersFetched : 0;
  return {
    ...args,
    lookbackWindowsTried: lookback,
    ordersFetched: fetched,
    ordersUpstream: args.ordersTrace,
    menuUpstream: args.menuTrace,
  };
}

function extractErrorMessage(response: OrdersLatestResponse | MenusResponse | null): string | null {
  if (!response) return null;
  if (typeof response === "string") return response;
  const error = (response as any)?.error;
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
