import type { AppEnv } from "../../../config/env.js";
import { getOrdersBulk } from "../../../clients/toast.js";
import { jsonResponse } from "../../../lib/http.js";
import { collectLatestOrders } from "../../../lib/collectLatestOrders.js";
import { normalizeToastTimestamp } from "../../../lib/order-utils.js";

const EXPAND_FULL = [
  "checks",
  "items",
  "payments",
  "discounts",
  "serviceCharges",
  "customers",
  "employee",
];

export interface OrdersLatestDeps {
  getOrdersBulk: typeof getOrdersBulk;
}

const LIMIT_MIN = 1;
const LIMIT_MAX = 200;
const DEFAULT_LIMIT = LIMIT_MAX;
const PAGE_SIZE_MIN = 1;
const PAGE_SIZE_MAX = 100;

export function createOrdersLatestHandler(
  deps: OrdersLatestDeps = { getOrdersBulk }
) {
  return async function handleOrdersLatest(env: AppEnv, request: Request) {
    const url = new URL(request.url);

    const limitRaw = parseNumber(url.searchParams.get("limit"), DEFAULT_LIMIT);
    const limit = clamp(limitRaw ?? DEFAULT_LIMIT, LIMIT_MIN, LIMIT_MAX);

    const detailParam = url.searchParams.get("detail");
    const detail = detailParam === "ids" ? "ids" : "full";

    const minutesValue = parseNumber(url.searchParams.get("minutes"), null);
    const pageSizeRaw = parseNumber(url.searchParams.get("pageSize"), null);
    const pageSize =
      pageSizeRaw === null
        ? null
        : clamp(Math.trunc(pageSizeRaw), PAGE_SIZE_MIN, PAGE_SIZE_MAX);

    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    const sinceParam = url.searchParams.get("since");

    const locationId = url.searchParams.get("locationId");
    const status = url.searchParams.get("status");

    const wantsDebugParam = parseBooleanParam(url.searchParams, "debug");
    const allowDebug = Boolean((env as any).DEBUG);
    const includeDebug = allowDebug && wantsDebugParam;

    try {
      const now = new Date();

      const { windowOverride, minutesUsed } = resolveWindow({
        startParam,
        endParam,
        minutesValue,
        now,
      });

      const result = await collectLatestOrders({
        env,
        deps,
        limit,
        detail,
        locationId,
        status,
        pageSize,
        since: parseIsoToDate(sinceParam),
        sinceRaw: sinceParam,
        windowOverride,
        debug: includeDebug,
      });

      const responseBody: any = {
        ok: true,
        route: "/api/orders/latest",
        limit,
        detail,
        minutes: minutesUsed ?? result.minutes,
        window: result.window,
        pageSize: result.pageSize,
        expandUsed: EXPAND_FULL,
        count: result.orderIds.length,
        ids: result.orderIds,
        orders: detail === "ids" ? result.orderIds : result.orders,
      };

      const sourcesMap = includeDebug && Array.isArray(result.sources)
        ? new Map(result.sources.map((entry) => [entry.id, entry.source]))
        : null;

      if (detail === "full") {
        if (includeDebug && sourcesMap) {
          responseBody.data = result.orders.map((order, index) => {
            const id = result.orderIds[index];
            if (!order || typeof order !== "object") {
              return order;
            }
            const source = sourcesMap.get(id) ?? "cache";
            return {
              ...order,
              _meta: {
                source,
                kvKey: `orders:byId:${id}`,
              },
            };
          });
        } else {
          responseBody.data = result.orders;
        }
      }

      if (includeDebug && result.sources) {
        responseBody.sources = result.sources;
      }

      if (includeDebug && result.debug) {
        responseBody.debug = result.debug;
      }

      const response = jsonResponse(responseBody);

      if (includeDebug && result.debug) {
        const cache = result.debug.cache ?? { hits: 0, misses: 0, updated: 0 };
        const api = result.debug.api ?? { requests: 0 };
        const timing = result.debug.timing ?? { totalMs: 0 };

        if (typeof cache.hits === "number") {
          response.headers.set("X-Orders-Cache-Hits", String(cache.hits));
        }
        if (typeof cache.misses === "number") {
          response.headers.set("X-Orders-Cache-Misses", String(cache.misses));
        }
        if (typeof cache.updated === "number") {
          response.headers.set("X-Orders-Cache-Updated", String(cache.updated));
        }
        if (typeof api.requests === "number") {
          response.headers.set("X-Orders-API-Requests", String(api.requests));
        }
        if (typeof timing.totalMs === "number") {
          response.headers.set("X-Orders-TotalMs", String(Math.round(timing.totalMs)));
        }
      }

      return response;
    } catch (err: any) {
      const statusCode = typeof err?.status === "number" ? err.status : 500;
      const snippet = err?.bodySnippet ?? err?.message ?? String(err ?? "Unknown error");

      return jsonResponse(
        {
          ok: false,
          route: "/api/orders/latest",
          error: typeof snippet === "string" ? snippet : "Unknown error",
        },
        { status: statusCode }
      );
    }
  };
}

export default createOrdersLatestHandler();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveWindow({
  startParam,
  endParam,
  minutesValue,
  now,
}: {
  startParam: string | null;
  endParam: string | null;
  minutesValue: number | null;
  now: Date;
}): {
  windowOverride: { start: Date; end: Date } | null;
  minutesUsed: number | null;
} {
  const parsedStart = parseIsoToDate(startParam);
  const parsedEnd = parseIsoToDate(endParam);

  if (parsedStart && parsedEnd && parsedStart.getTime() < parsedEnd.getTime()) {
    return {
      windowOverride: { start: parsedStart, end: parsedEnd },
      minutesUsed: Math.round((parsedEnd.getTime() - parsedStart.getTime()) / 60_000),
    };
  }

  const minutes = minutesValue ?? null;
  if (minutes !== null && minutes > 0) {
    return {
      windowOverride: {
        start: new Date(now.getTime() - minutes * 60_000),
        end: new Date(now.getTime()),
      },
      minutesUsed: minutes,
    };
  }

  return {
    windowOverride: null,
    minutesUsed: null,
  };
}

function parseIsoToDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeToastTimestamp(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function parseBooleanParam(params: URLSearchParams, key: string): boolean {
  if (!params.has(key)) {
    return false;
  }
  const raw = params.get(key);
  if (raw === null) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") {
    return true;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return true;
}

function parseNumber(value: string | null, fallback: number | null): number | null {
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}
