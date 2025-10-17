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

export function createOrdersLatestHandler(
  deps: OrdersLatestDeps = { getOrdersBulk }
) {
  return async function handleOrdersLatest(env: AppEnv, request: Request) {
    const url = new URL(request.url);

    const limitRaw = parseNumber(url.searchParams.get("limit"), 20);
    const limit = clamp(limitRaw ?? 20, LIMIT_MIN, LIMIT_MAX);

    const detailParam = url.searchParams.get("detail");
    const detail = detailParam === "ids" ? "ids" : "full";

    const minutesValue = parseNumber(url.searchParams.get("minutes"), null);

    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    const sinceParam = url.searchParams.get("since");

    const locationId = url.searchParams.get("locationId");
    const status = url.searchParams.get("status");

    const wantsDebugParam =
      url.searchParams.get("debug") === "1" || url.searchParams.has("debug");
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
        since: parseIsoToDate(sinceParam),
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
        expandUsed: EXPAND_FULL,
        count: result.orderIds.length,
        ids: result.orderIds,
        orders: result.orderIds,
      };

      if (detail === "full") {
        responseBody.data = result.orders;
      }

      if (includeDebug && result.debug) {
        responseBody.debug = result.debug;
      }

      return jsonResponse(responseBody);
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
