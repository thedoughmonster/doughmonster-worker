import type { ToastEnv } from "../lib/env";
import { getAccessToken } from "../lib/toastAuth";
import { paceBeforeToastCall } from "../lib/pacer";

export interface GetOrdersBulkParams {
  startIso: string;
  endIso: string;
  page: number;
  pageSize?: number;
}

export interface OrdersBulkResult {
  orders: any[];
  totalCount?: number;
  page?: number;
  pageSize?: number;
  nextPage?: number | null;
  raw: any;
  responseHeaders: Record<string, string>;
}

export interface ToastRequestOptions {
  scope?: "global" | "menu" | "orders";
  minGapMs?: number;
  retries?: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
}

export interface ToastRequestResult {
  json: any;
  text: string;
  response: Response;
}

export async function getOrdersBulk(
  env: ToastEnv,
  params: GetOrdersBulkParams,
): Promise<OrdersBulkResult> {
  const { json, response } = await toastRequest(env, "/orders/v2/ordersBulk", {
    query: {
      startDate: params.startIso,
      endDate: params.endIso,
      page: String(params.page),
      pageSize: String(params.pageSize ?? 100),
    },
    options: {
      scope: "orders",
      minGapMs: 220,
      retries: 3,
      backoffBaseMs: 250,
      maxBackoffMs: 8_000,
    },
  });

  const orders = Array.isArray(json?.orders)
    ? json.orders
    : Array.isArray(json)
    ? json
    : [];

  const nextPage =
    typeof json?.nextPage === "number"
      ? json.nextPage
      : typeof json?.hasMore === "boolean" && json.hasMore
      ? params.page + 1
      : null;

  return {
    orders,
    totalCount: typeof json?.totalCount === "number" ? json.totalCount : undefined,
    page: typeof json?.page === "number" ? json.page : params.page,
    pageSize: typeof json?.pageSize === "number" ? json.pageSize : params.pageSize,
    nextPage,
    raw: json,
    responseHeaders: headersToObject(response.headers),
  };
}

export async function getOrderById(env: ToastEnv, guid: string): Promise<any> {
  const { json } = await toastRequest(env, `/orders/v2/orders/${encodeURIComponent(guid)}`, {
    options: { scope: "orders", minGapMs: 220, retries: 2, backoffBaseMs: 250, maxBackoffMs: 4_000 },
  });
  return json;
}

export interface GetMenuItemsParams {
  lastModified?: string;
  pageToken?: string | null;
}

export interface MenuItemsResult {
  items: any[];
  nextPageToken: string | null;
  raw: any;
  responseHeaders: Record<string, string>;
}

export async function getMenuItems(
  env: ToastEnv,
  params: GetMenuItemsParams = {},
): Promise<MenuItemsResult> {
  const { json, response } = await toastRequest(env, "/configuration/v2/menuItems", {
    query: {
      ...(params.lastModified ? { lastModified: params.lastModified } : {}),
      ...(params.pageToken ? { pageToken: params.pageToken } : {}),
    },
    options: {
      scope: "menu",
      minGapMs: 1_100,
      retries: 3,
      backoffBaseMs: 250,
      maxBackoffMs: 8_000,
    },
  });

  const items = Array.isArray(json?.menuItems)
    ? json.menuItems
    : Array.isArray(json)
    ? json
    : [];

  const nextPageHeader = response.headers.get("Toast-Next-Page-Token");
  const nextPageToken = nextPageHeader && nextPageHeader.trim().length > 0 ? nextPageHeader : null;

  return {
    items,
    nextPageToken,
    raw: json,
    responseHeaders: headersToObject(response.headers),
  };
}

export interface SalesCategoriesResult {
  categories: any[];
  nextPageToken: string | null;
  raw: any;
  responseHeaders: Record<string, string>;
}

export interface GetSalesCategoriesParams {
  pageToken?: string | null;
}

export async function getSalesCategories(
  env: ToastEnv,
  params: GetSalesCategoriesParams = {},
): Promise<SalesCategoriesResult> {
  const { json, response } = await toastRequest(env, "/configuration/v2/salesCategories", {
    query: {
      ...(params.pageToken ? { pageToken: params.pageToken } : {}),
    },
    options: {
      scope: "menu",
      minGapMs: 1_100,
      retries: 3,
      backoffBaseMs: 250,
      maxBackoffMs: 8_000,
    },
  });

  const categories = Array.isArray(json?.salesCategories)
    ? json.salesCategories
    : Array.isArray(json)
    ? json
    : [];

  const nextPageHeader = response.headers.get("Toast-Next-Page-Token");
  const nextPageToken = nextPageHeader && nextPageHeader.trim().length > 0 ? nextPageHeader : null;

  return {
    categories,
    nextPageToken,
    raw: json,
    responseHeaders: headersToObject(response.headers),
  };
}

async function toastRequest(
  env: ToastEnv,
  route: string,
  {
    query = {},
    options = {},
  }: {
    query?: Record<string, string>;
    options?: ToastRequestOptions;
  },
): Promise<ToastRequestResult> {
  const { scope = "global", minGapMs = 600, retries = 2, backoffBaseMs = 250, maxBackoffMs = 8_000 } = options;
  const base = env.TOAST_API_BASE?.replace(/\/+$/, "");
  if (!base) {
    throw new Error("TOAST_API_BASE is not configured.");
  }

  const url = new URL(route.startsWith("http") ? route : `${base}${route.startsWith("/") ? route : `/${route}`}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= retries) {
    await paceBeforeToastCall(scope as any, minGapMs);

    let response: Response;
    try {
      const token = await getAccessToken(env);
      const headers = new Headers({
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
      });
      response = await fetch(url.toString(), { method: "GET", headers });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= retries) {
        throw lastError;
      }
      await wait(Math.min(maxBackoffMs, backoffBaseMs * 2 ** attempt));
      attempt += 1;
      continue;
    }

    const retryAfter = response.headers.get("Retry-After");

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const toastError = buildToastError(route, response, text);

      const shouldRetry =
        response.status === 429 || (response.status >= 500 && response.status < 600);

      if (shouldRetry && attempt < retries) {
        await paceBeforeToastCall(scope as any, minGapMs, retryAfter);
        await wait(computeRetryDelay(attempt, retryAfter, backoffBaseMs, maxBackoffMs));
        attempt += 1;
        lastError = toastError;
        continue;
      }

      throw toastError;
    }

    const text = await response.text().catch(() => "");
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    return { json, text, response };
  }

  throw lastError ?? new Error(`Toast request failed for ${route}`);
}

function buildToastError(route: string, response: Response, text: string): Error {
  const error = new Error(`Toast error ${response.status} on ${route}`);
  const headers = headersToObject(response.headers);
  (error as any).status = response.status;
  (error as any).bodySnippet = text.slice(0, 512);
  (error as any).responseHeaders = headers;
  const toastRequestId = response.headers.get("Toast-Request-Id") ?? headers["toast-request-id"];
  if (toastRequestId) {
    (error as any).toastRequestId = toastRequestId;
  }
  return error;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function computeRetryDelay(
  attempt: number,
  retryAfter: string | null,
  backoffBaseMs: number,
  maxBackoffMs: number,
): number {
  const baseDelay = Math.min(maxBackoffMs, backoffBaseMs * 2 ** attempt);
  if (!retryAfter) {
    return baseDelay;
  }

  const numeric = Number(retryAfter);
  if (!Number.isNaN(numeric) && numeric >= 0) {
    return Math.max(baseDelay, numeric * 1000);
  }

  const asDate = Date.parse(retryAfter);
  if (!Number.isNaN(asDate)) {
    const diff = asDate - Date.now();
    if (diff > 0) {
      return Math.max(baseDelay, diff);
    }
  }

  return baseDelay;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
