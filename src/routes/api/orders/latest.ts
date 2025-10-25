import type { AppEnv } from "../../../config/env.js";
import { getOrdersBulk } from "../../../clients/toast.js";
import { jsonResponse } from "../../../lib/http.js";
import { normalizeToastTimestamp, toToastIsoUtc } from "../../../lib/order-utils.js";

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

const LIMIT_DEFAULT = 5;
const LIMIT_MIN = 1;
const LIMIT_MAX = 200;
const PAGE_SIZE_DEFAULT = 5;
const PAGE_SIZE_MIN = 1;
const PAGE_SIZE_MAX = 100;
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export function createOrdersLatestHandler(
  deps: OrdersLatestDeps = { getOrdersBulk }
) {
  return async function handleOrdersLatest(env: AppEnv, request: Request) {
    try {
      const url = new URL(request.url);
      const limit = resolveNumber(
        url.searchParams.get("limit"),
        LIMIT_DEFAULT,
        LIMIT_MIN,
        LIMIT_MAX
      );
      const detailParam = url.searchParams.get("detail");
      const detail = detailParam === "ids" ? "ids" : "full";

      const pageSize = resolveNumber(
        url.searchParams.get("pageSize"),
        PAGE_SIZE_DEFAULT,
        PAGE_SIZE_MIN,
        PAGE_SIZE_MAX
      );

      const now = new Date();
      const end = parseIsoToDate(url.searchParams.get("end")) ?? now;
      const start =
        parseIsoToDate(url.searchParams.get("start")) ??
        new Date(end.getTime() - DEFAULT_LOOKBACK_MS);

      const startIso = toToastIsoUtc(start);
      const endIso = toToastIsoUtc(end);

      const getOrdersBulkImpl =
        typeof (env as any).__TEST_GET_ORDERS_BULK === "function"
          ? ((env as any)
              .__TEST_GET_ORDERS_BULK as OrdersLatestDeps["getOrdersBulk"])
          : deps.getOrdersBulk;

      const toastResponse = await getOrdersBulkImpl(env, {
        startIso,
        endIso,
        page: 1,
        pageSize,
        expansions: detail === "full" ? EXPAND_FULL : [],
      } as any);

      const toastOrders = Array.isArray(toastResponse?.orders)
        ? toastResponse.orders
        : [];
      const limitedOrders = toastOrders.slice(0, limit);
      const ids = limitedOrders
        .map((order) =>
          typeof order?.guid === "string" ? order.guid : null
        )
        .filter((guid): guid is string => Boolean(guid));

      const minutes = Math.max(
        0,
        Math.round((end.getTime() - start.getTime()) / 60_000)
      );

      const responseBody: any = {
        ok: true,
        route: "/api/orders/latest",
        limit,
        detail,
        minutes,
        window: { start: startIso, end: endIso },
        pageSize,
        expandUsed: detail === "full" ? EXPAND_FULL : [],
        count: ids.length,
        ids,
        orders: detail === "ids" ? ids : limitedOrders,
      };

      if (detail === "full") {
        responseBody.data = limitedOrders;
      }

      return jsonResponse(responseBody);
    } catch (err: any) {
      const statusCode = typeof err?.status === "number" ? err.status : 500;
      const snippet =
        err?.bodySnippet ?? err?.message ?? String(err ?? "Unknown error");

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

function resolveNumber(
  value: string | null,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (value === null) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  const integer = Math.trunc(parsed);
  return clamp(integer, min, max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
