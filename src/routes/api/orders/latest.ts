import type { AppEnv } from "../../../config/env.js";
import { getOrdersBulk } from "../../../clients/toast.js";
import { jsonResponse } from "../../../lib/http.js";
import {
  normalizeToastTimestamp,
  resolveBusinessDate,
  resolveOrderOpenedAt,
} from "../../../lib/order-utils.js";

const EXPAND_FULL = [
  "checks",
  "items",
  "payments",
  "discounts",
  "serviceCharges",
  "customers",
  "employee",
];

const LIMIT_MIN = 1;
const LIMIT_MAX = 200;
const DEFAULT_LIMIT = 5;
const PAGE_SIZE_MIN = 1;
const PAGE_SIZE_MAX = 100;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_FETCHES = 200;
const DEFAULT_TIME_ZONE = "UTC";

export interface OrdersLatestDeps {
  getOrdersBulk: typeof getOrdersBulk;
}

interface OrdersWindow {
  start: Date;
  end: Date;
  requestStart: string;
  requestEnd: string;
  displayStart: string;
  displayEnd: string;
  businessDate: string;
  timeZone: string;
  minutes: number;
  enforceBusinessDate: boolean;
}

export function createOrdersLatestHandler(
  deps: OrdersLatestDeps = { getOrdersBulk }
) {
  return async function handleOrdersLatest(env: AppEnv, request: Request) {
    const url = new URL(request.url);

    const limitRaw = parseNumber(url.searchParams.get("limit"), DEFAULT_LIMIT);
    const limit = clamp(limitRaw ?? DEFAULT_LIMIT, LIMIT_MIN, LIMIT_MAX);

    const detail = url.searchParams.get("detail") === "ids" ? "ids" : "full";

    const pageSizeRaw = parseNumber(
      url.searchParams.get("pageSize"),
      DEFAULT_PAGE_SIZE
    );
    const pageSize = clamp(Math.trunc(pageSizeRaw ?? DEFAULT_PAGE_SIZE), PAGE_SIZE_MIN, PAGE_SIZE_MAX);

    const timeZone = resolveTimeZone(env, url.searchParams.get("timeZone"));
    const businessDateParam = normalizeBusinessDate(
      url.searchParams.get("businessDate")
    );
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    const sinceParam = url.searchParams.get("since");
    const minutesParamRaw = parseNumber(url.searchParams.get("minutes"), null);
    const minutesParam =
      minutesParamRaw !== null && minutesParamRaw > 0
        ? Math.trunc(minutesParamRaw)
        : null;

    try {
      const windowInfo = resolveWindow({
        now: new Date(),
        timeZone,
        businessDate: businessDateParam,
        startParam,
        endParam,
        sinceParam,
        minutes: minutesParam,
      });

      const fetchedOrders = await fetchOrdersForWindow(
        env,
        deps,
        windowInfo,
        pageSize
      );
      const sortedOrders = sortOrders(fetchedOrders);

      const orderIds = sortedOrders
        .map((order) =>
          order && typeof order === "object" && typeof (order as any).guid === "string"
            ? String((order as any).guid)
            : null
        )
        .filter((guid): guid is string => Boolean(guid));

      const responseBody: any = {
        ok: true,
        route: "/api/orders/latest",
        limit,
        detail,
        minutes: windowInfo.minutes,
        window: {
          start: windowInfo.displayStart,
          end: windowInfo.displayEnd,
          businessDate: windowInfo.businessDate,
          timeZone: windowInfo.timeZone,
        },
        pageSize,
        expandUsed: EXPAND_FULL,
        count: orderIds.length,
        ids: orderIds,
        orders: detail === "ids" ? orderIds : sortedOrders,
      };

      if (detail === "full") {
        responseBody.data = sortedOrders;
      }

      return jsonResponse(responseBody);
    } catch (err: any) {
      const statusCode = typeof err?.status === "number" ? err.status : 500;
      const errorMessage = extractErrorMessage(err);

      return jsonResponse(
        {
          ok: false,
          route: "/api/orders/latest",
          error: errorMessage,
        },
        { status: statusCode }
      );
    }
  };
}

export default createOrdersLatestHandler();

async function fetchOrdersForWindow(
  env: AppEnv,
  deps: OrdersLatestDeps,
  windowInfo: OrdersWindow,
  pageSize: number
): Promise<any[]> {
  const { fetcher: getOrders, isOverride } = resolveOrdersFetcher(env, deps);
  const collected: any[] = [];
  const seen = new Set<string>();
  const enforceWindow = !isOverride;

  let page = 1;

  for (let iteration = 0; iteration < MAX_PAGE_FETCHES; iteration += 1) {
    const result = await getOrders(env, {
      startIso: windowInfo.requestStart,
      endIso: windowInfo.requestEnd,
      page,
      pageSize,
      expansions: EXPAND_FULL,
    });

    const orders = Array.isArray(result?.orders) ? result.orders : [];
    for (const order of orders) {
      if (!order || typeof order !== "object") {
        continue;
      }
      const guid = typeof (order as any).guid === "string" ? (order as any).guid : null;
      if (guid && seen.has(guid)) {
        continue;
      }
      if (!isOrderWithinWindow(order, windowInfo, enforceWindow)) {
        continue;
      }
      if (guid) {
        seen.add(guid);
      }
      collected.push(order);
    }

    const nextPage =
      result && typeof result.nextPage === "number" && result.nextPage > page
        ? result.nextPage
        : null;

    if (!nextPage) {
      break;
    }

    page = nextPage;
  }

  return collected;
}

function resolveOrdersFetcher(
  env: AppEnv,
  deps: OrdersLatestDeps
): { fetcher: OrdersLatestDeps["getOrdersBulk"]; isOverride: boolean } {
  const override = (env as any)?.__TEST_GET_ORDERS_BULK;
  if (typeof override === "function") {
    return { fetcher: override as OrdersLatestDeps["getOrdersBulk"], isOverride: true };
  }
  return { fetcher: deps.getOrdersBulk, isOverride: false };
}

function sortOrders(orders: any[]): any[] {
  return [...orders].sort((a, b) => {
    const aOpened = resolveOrderOpenedAt(a).ms ?? 0;
    const bOpened = resolveOrderOpenedAt(b).ms ?? 0;

    if (aOpened !== bOpened) {
      return bOpened - aOpened;
    }

    const aGuid = typeof a?.guid === "string" ? a.guid : "";
    const bGuid = typeof b?.guid === "string" ? b.guid : "";
    return aGuid.localeCompare(bGuid);
  });
}

function isOrderWithinWindow(
  order: any,
  windowInfo: OrdersWindow,
  enforceWindow: boolean
): boolean {
  const openedDetails = resolveOrderOpenedAt(order);
  const openedMs = openedDetails.ms;

  if (enforceWindow && openedMs !== null) {
    if (openedMs < windowInfo.start.getTime() || openedMs >= windowInfo.end.getTime()) {
      return false;
    }
  }

  if (enforceWindow && windowInfo.enforceBusinessDate) {
    const businessDate = resolveBusinessDate(order, openedMs);
    if (businessDate && businessDate !== windowInfo.businessDate) {
      return false;
    }
  }

  return true;
}

function resolveWindow({
  now,
  timeZone,
  businessDate,
  startParam,
  endParam,
  sinceParam,
  minutes,
}: {
  now: Date;
  timeZone: string;
  businessDate: string | null;
  startParam: string | null;
  endParam: string | null;
  sinceParam: string | null;
  minutes: number | null;
}): OrdersWindow {
  const explicitStart = parseAbsoluteDate(startParam);
  const explicitEnd = parseAbsoluteDate(endParam);

  if (explicitStart && explicitEnd && explicitEnd.getTime() > explicitStart.getTime()) {
    return buildExplicitWindow({
      start: explicitStart,
      end: explicitEnd,
      timeZone,
      businessDate: formatBusinessDateFromDate(explicitStart, timeZone),
      enforceBusinessDate: false,
      requestStartInput: startParam,
      requestEndInput: endParam,
    });
  }

  if (typeof minutes === "number" && minutes > 0) {
    const end = new Date(now.getTime());
    const start = new Date(end.getTime() - minutes * 60_000);
    return buildExplicitWindow({
      start,
      end,
      timeZone,
      businessDate: formatBusinessDateFromDate(start, timeZone),
      enforceBusinessDate: false,
      requestStartInput: null,
      requestEndInput: null,
    });
  }

  const sinceDate = parseAbsoluteDate(sinceParam);
  if (sinceDate) {
    const endMs = Math.max(now.getTime(), sinceDate.getTime() + 60_000);
    const end = new Date(endMs);
    return buildExplicitWindow({
      start: sinceDate,
      end,
      timeZone,
      businessDate: formatBusinessDateFromDate(sinceDate, timeZone),
      enforceBusinessDate: false,
      requestStartInput: sinceParam,
      requestEndInput: null,
    });
  }

  if (businessDate) {
    const year = Number(businessDate.slice(0, 4));
    const month = Number(businessDate.slice(4, 6));
    const day = Number(businessDate.slice(6, 8));
    return buildWindow({
      year,
      month,
      day,
      timeZone,
      businessDate,
    });
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = Number(getPart(parts, "year", now.getUTCFullYear()));
  const month = Number(getPart(parts, "month", now.getUTCMonth() + 1));
  const day = Number(getPart(parts, "day", now.getUTCDate()));

  return buildWindow({
    year,
    month,
    day,
    timeZone,
    businessDate: formatBusinessDateParts(year, month, day),
  });
}

function buildWindow({
  year,
  month,
  day,
  timeZone,
  businessDate,
}: {
  year: number;
  month: number;
  day: number;
  timeZone: string;
  businessDate: string;
}): OrdersWindow {
  const safeYear = Number.isFinite(year) ? year : new Date().getUTCFullYear();
  const safeMonth = Number.isFinite(month) ? month : 1;
  const safeDay = Number.isFinite(day) ? day : 1;

  const startApprox = new Date(Date.UTC(safeYear, safeMonth - 1, safeDay, 0, 0, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(startApprox, timeZone);
  const startMs = startApprox.getTime() - offsetMinutes * 60_000;
  const start = new Date(startMs);
  const end = new Date(startMs + 24 * 60 * 60 * 1000);

  return buildExplicitWindow({
    start,
    end,
    timeZone,
    businessDate,
    enforceBusinessDate: true,
    requestStartInput: null,
    requestEndInput: null,
  });
}

function buildExplicitWindow({
  start,
  end,
  timeZone,
  businessDate,
  enforceBusinessDate,
  requestStartInput,
  requestEndInput,
}: {
  start: Date;
  end: Date;
  timeZone: string;
  businessDate: string;
  enforceBusinessDate: boolean;
  requestStartInput: string | null;
  requestEndInput: string | null;
}): OrdersWindow {
  const requestStart = formatRequestString(requestStartInput, start, timeZone);
  const requestEnd = formatRequestString(requestEndInput, end, timeZone);

  return {
    start,
    end,
    requestStart,
    requestEnd,
    displayStart: normalizeToastTimestamp(requestStart) ?? requestStart,
    displayEnd: normalizeToastTimestamp(requestEnd) ?? requestEnd,
    businessDate,
    timeZone,
    minutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)),
    enforceBusinessDate,
  };
}

function getPart(parts: Intl.DateTimeFormatPart[], type: string, fallback: number): string {
  const found = parts.find((part) => part.type === type);
  if (!found) {
    return String(fallback);
  }
  return found.value;
}

function formatBusinessDateParts(year: number, month: number, day: number): string {
  return `${String(Math.abs(Math.trunc(year))).padStart(4, "0")}${String(Math.abs(Math.trunc(month))).padStart(2, "0")}${String(Math.abs(Math.trunc(day))).padStart(2, "0")}`;
}

function formatBusinessDateFromDate(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(getPart(parts, "year", date.getUTCFullYear()));
  const month = Number(getPart(parts, "month", date.getUTCMonth() + 1));
  const day = Number(getPart(parts, "day", date.getUTCDate()));
  return formatBusinessDateParts(year, month, day);
}

function formatRequestString(
  input: string | null,
  date: Date,
  timeZone: string
): string {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed) {
      const normalized = normalizeToastTimestamp(trimmed) ?? trimmed;
      if (normalized.endsWith("Z")) {
        return normalized.replace(/Z$/, "+0000");
      }
      if (/([+-]\d{2}):\d{2}$/.test(normalized)) {
        return normalized.replace(/([+-]\d{2}):(\d{2})$/, "$1$2");
      }
      if (/([+-]\d{2})\d{2}$/.test(normalized)) {
        return normalized;
      }
    }
  }
  return formatToastDate(date, timeZone);
}

function parseAbsoluteDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let normalized = normalizeToastTimestamp(trimmed) ?? trimmed;

  if (/[+-]\d{2}\d{2}$/.test(normalized) && !/[+-]\d{2}:\d{2}$/.test(normalized)) {
    normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  } else if (!/[+-]\d{2}:\d{2}$/.test(normalized) && !normalized.endsWith("Z")) {
    normalized = `${normalized}+00:00`;
  }

  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function formatToastDate(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const year = getPart(parts, "year", date.getUTCFullYear());
  const month = getPart(parts, "month", date.getUTCMonth() + 1);
  const day = getPart(parts, "day", date.getUTCDate());
  const hour = getPart(parts, "hour", date.getUTCHours());
  const minute = getPart(parts, "minute", date.getUTCMinutes());
  const second = getPart(parts, "second", date.getUTCSeconds());

  const ms = String(date.getUTCMilliseconds()).padStart(3, "0");

  const offsetMinutes = getTimeZoneOffsetMinutes(date, timeZone);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absOffset / 60);
  const offsetMins = absOffset % 60;

  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${ms}${sign}${pad(offsetHours)}${pad(offsetMins)}`;
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const year = Number(getPart(parts, "year", date.getUTCFullYear()));
  const month = Number(getPart(parts, "month", date.getUTCMonth() + 1));
  const day = Number(getPart(parts, "day", date.getUTCDate()));
  const hour = Number(getPart(parts, "hour", date.getUTCHours()));
  const minute = Number(getPart(parts, "minute", date.getUTCMinutes()));
  const second = Number(getPart(parts, "second", date.getUTCSeconds()));

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function resolveTimeZone(env: AppEnv, queryValue: string | null): string {
  const candidates: Array<unknown> = [
    queryValue,
    (env as any)?.TOAST_TIME_ZONE,
    (env as any)?.ORDERS_TIME_ZONE,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeTimeZone(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return DEFAULT_TIME_ZONE;
}

function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return null;
  }
}

function normalizeBusinessDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D+/g, "");
  if (digits.length !== 8) {
    return null;
  }

  return digits;
}

function extractErrorMessage(err: any): string {
  if (!err) {
    return "Unknown error";
  }
  if (typeof err === "string") {
    return err;
  }
  if (typeof err.message === "string" && err.message.trim()) {
    return err.message;
  }
  if (typeof err.bodySnippet === "string" && err.bodySnippet.trim()) {
    return err.bodySnippet;
  }
  return "Unknown error";
}

function pad(value: string | number, length = 2): string {
  return String(value).padStart(length, "0");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value: string | null, fallback: number | null): number | null {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}
