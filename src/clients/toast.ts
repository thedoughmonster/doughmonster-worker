import type { AppEnv } from "../config/env.js";
import { getToastHeaders } from "../lib/auth.js";
import { fetchWithBackoff } from "../lib/http.js";

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

export async function getOrdersBulk(env: AppEnv, params: GetOrdersBulkParams): Promise<OrdersBulkResult> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = new URL(`${base}/orders/v2/ordersBulk`);
  url.searchParams.set("startDate", params.startIso);
  url.searchParams.set("endDate", params.endIso);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("pageSize", String(params.pageSize ?? 100));

  const headers = await getToastHeaders(env);
  const response = await fetchWithBackoff(url.toString(), { method: "GET", headers });
  const text = await response.text();

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

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

export async function getOrderById(env: AppEnv, guid: string): Promise<any> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = `${base}/orders/v2/orders/${encodeURIComponent(guid)}`;
  const headers = await getToastHeaders(env);
  const response = await fetchWithBackoff(url, { method: "GET", headers });
  return response.json();
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

export async function getMenuItems(env: AppEnv, params: GetMenuItemsParams = {}): Promise<MenuItemsResult> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = new URL(`${base}/configuration/v2/menuItems`);

  if (params.lastModified) {
    url.searchParams.set("lastModified", params.lastModified);
  }

  const headers = await getToastHeaders(env);

  if (params.pageToken) {
    headers["Toast-Next-Page-Token"] = params.pageToken;
  }

  const response = await fetchWithBackoff(url.toString(), { method: "GET", headers });
  const text = await response.text();

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

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
  raw: any;
  responseHeaders: Record<string, string>;
}

export async function getSalesCategories(env: AppEnv): Promise<SalesCategoriesResult> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = `${base}/configuration/v2/salesCategories`;
  const headers = await getToastHeaders(env);
  const response = await fetchWithBackoff(url, { method: "GET", headers });
  const text = await response.text();

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  const categories = Array.isArray(json?.salesCategories)
    ? json.salesCategories
    : Array.isArray(json)
    ? json
    : [];

  return {
    categories,
    raw: json,
    responseHeaders: headersToObject(response.headers),
  };
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
