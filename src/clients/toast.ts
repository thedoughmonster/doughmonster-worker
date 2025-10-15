import type { AppEnv } from "../config/env.js";
import { getToastHeaders } from "../lib/auth.js";
import { fetchWithBackoff } from "../lib/http.js";
import type {
  ToastMenuMetadata,
  ToastMenusDocument,
} from "../types/toast-menus.js";
import type {
  ToastOrder,
  ToastOrdersBulkEnvelope,
  ToastOrdersBulkResponse,
} from "../types/toast-orders.js";

export interface GetOrdersBulkParams {
  startIso: string;
  endIso: string;
  page: number;
  pageSize?: number;
}

export interface OrdersBulkResult {
  orders: ToastOrder[];
  totalCount?: number;
  page?: number;
  pageSize?: number;
  nextPage?: number | null;
  raw: ToastOrdersBulkResponse;
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

  let json: ToastOrdersBulkResponse = null;
  try {
    json = text ? (JSON.parse(text) as ToastOrdersBulkResponse) : null;
  } catch {
    json = null;
  }

  const orders = Array.isArray((json as ToastOrdersBulkEnvelope | null)?.orders)
    ? ((json as ToastOrdersBulkEnvelope).orders ?? [])
    : Array.isArray(json)
    ? json
    : [];

  const nextPage =
    typeof (json as ToastOrdersBulkEnvelope | null)?.nextPage === "number"
      ? (json as ToastOrdersBulkEnvelope).nextPage
      : typeof (json as ToastOrdersBulkEnvelope | null)?.hasMore === "boolean" &&
        Boolean((json as ToastOrdersBulkEnvelope).hasMore)
      ? params.page + 1
      : null;

  return {
    orders,
    totalCount:
      typeof (json as ToastOrdersBulkEnvelope | null)?.totalCount === "number"
        ? (json as ToastOrdersBulkEnvelope).totalCount
        : undefined,
    page:
      typeof (json as ToastOrdersBulkEnvelope | null)?.page === "number"
        ? (json as ToastOrdersBulkEnvelope).page
        : params.page,
    pageSize:
      typeof (json as ToastOrdersBulkEnvelope | null)?.pageSize === "number"
        ? (json as ToastOrdersBulkEnvelope).pageSize
        : params.pageSize,
    nextPage,
    raw: json,
    responseHeaders: headersToObject(response.headers),
  };
}

export async function getOrderById(env: AppEnv, guid: string): Promise<ToastOrder> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = `${base}/orders/v2/orders/${encodeURIComponent(guid)}`;
  const headers = await getToastHeaders(env);
  const response = await fetchWithBackoff(url, { method: "GET", headers });
  return (await response.json()) as ToastOrder;
}

export async function getMenuMetadata(env: AppEnv): Promise<ToastMenuMetadata | null> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = `${base}/menus/v2/metadata`;
  const headers = await getToastHeaders(env);

  try {
    const response = await fetchWithBackoff(url, { method: "GET", headers });
    return (await response.json()) as ToastMenuMetadata;
  } catch (err) {
    if (isToastNotFound(err)) {
      return null;
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function getPublishedMenus(env: AppEnv): Promise<ToastMenusDocument | null> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = `${base}/menus/v2/menus`;
  const headers = await getToastHeaders(env);

  try {
    const response = await fetchWithBackoff(url, { method: "GET", headers });
    const text = await response.text();
    return text ? (JSON.parse(text) as ToastMenusDocument) : null;
  } catch (err) {
    if (isToastNotFound(err)) {
      return null;
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function isToastNotFound(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as any).status;
    return typeof status === "number" && status === 404;
  }
  return false;
}
