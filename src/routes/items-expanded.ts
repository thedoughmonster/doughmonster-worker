import type { AppEnv } from "../config/env.js";
import { jsonResponse } from "../lib/http.js";
import { fetchMenuFromWorker, fetchOrdersFromWorker } from "./items-expanded/fetchers.js";
import { buildExpandedOrders, extractOrders } from "./items-expanded/compose.js";
import type {
  DiagnosticsCounters,
  MenusResponse,
  OrdersLatestResponse,
  UpstreamTrace,
} from "./items-expanded/types-local.js";
import type { ToastOrder } from "../types/toast-orders.js";

const ORDERS_ENDPOINT = "/api/orders/latest";
const MENUS_ENDPOINT = "/api/menus";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;
const ORDERS_UPSTREAM_DEFAULT = 60;
const ORDERS_UPSTREAM_MAX = 200;
const HANDLER_TIME_BUDGET_MS = 10_000;
const DEFAULT_FALLBACK_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

export default async function handleItemsExpanded(env: AppEnv, request: Request): Promise<Response> {
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
  const upstreamLimit = clamp(parseNumber(url.searchParams.get("limit"), ORDERS_UPSTREAM_DEFAULT), 1, ORDERS_UPSTREAM_MAX);
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
