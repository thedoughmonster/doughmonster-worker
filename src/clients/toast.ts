import type { AppEnv } from "../config/env.js";
import { getToastHeaders } from "../lib/auth.js";
import { fetchWithBackoff } from "../lib/http.js";
import type { ToastMenusDocument } from "../types/toast-menus.js";
import type { ToastPrepStation } from "../types/toast-kitchen.js";

const MENU_CACHE_KEY = "menu:published:v1";
const MENU_CACHE_META_KEY = "menu:published:meta:v1";
const MENU_STALE_AFTER_MS = 30 * 60 * 1000;
const MENU_EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000;
const DINING_OPTIONS_CACHE_KEY = "toast:diningOptions:v2";
const DINING_OPTIONS_CACHE_TTL_SECONDS = 30 * 60;

type MenuCacheStatus =
  | "hit-fresh"
  | "hit-stale-revalidate"
  | "miss-network"
  | "manual-refresh"
  | "hit-stale-error";

interface MenuCacheMeta {
  updatedAt: string;
  staleAt: string;
  expireAt: string;
  etag?: string;
}

interface MenuCacheInfo {
  status: MenuCacheStatus;
  updatedAt?: string;
}

const requestMenuCacheInfo = new WeakMap<Request, MenuCacheInfo>();

export function getMenuCacheInfo(request?: Request): MenuCacheInfo | undefined {
  if (!request) {
    return undefined;
  }
  return requestMenuCacheInfo.get(request);
}

function setMenuCacheInfoForRequest(request: Request | undefined, info: MenuCacheInfo): void {
  if (!request) {
    return;
  }
  requestMenuCacheInfo.set(request, info);
}

export interface GetOrdersBulkParams {
  startIso: string;
  endIso: string;
  page: number;
  pageSize?: number;
  expansions?: string[];
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

export interface MenuMetadataResponse {
  restaurantGuid: string;
  lastUpdated: string;
}

export type PublishedMenuResponse = ToastMenusDocument;

export interface DiningOptionConfig {
  guid: string;
  behavior?: string | null;
  name?: string | null;
}

export interface GetPrepStationsParams {
  pageToken?: string | null;
  lastModified?: string | null;
}

export interface PrepStationsResult {
  prepStations: ToastPrepStation[];
  nextPageToken: string | null;
  raw: unknown;
  responseHeaders: Record<string, string>;
}

export async function getOrdersBulk(env: AppEnv, params: GetOrdersBulkParams): Promise<OrdersBulkResult> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = new URL(`${base}/orders/v2/ordersBulk`);
  url.searchParams.set("startDate", params.startIso);
  url.searchParams.set("endDate", params.endIso);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("pageSize", String(params.pageSize ?? 100));

  if (Array.isArray(params.expansions)) {
    for (const expansion of params.expansions) {
      if (typeof expansion === "string" && expansion.trim()) {
        url.searchParams.append("expand", expansion.trim());
      }
    }
  }

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

export async function getPrepStations(
  env: AppEnv,
  params: GetPrepStationsParams = {}
): Promise<PrepStationsResult> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = new URL(`${base}/kitchen/v1/published/prepStations`);

  const pageToken = normalizeString(params.pageToken);
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  const lastModified = normalizeString(params.lastModified);
  if (lastModified) {
    url.searchParams.set("lastModified", lastModified);
  }

  const headers = await getToastHeaders(env);
  const response = await fetchWithBackoff(url.toString(), { method: "GET", headers });
  const text = await response.text();

  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      console.warn("failed to parse prep stations response", { err });
      payload = null;
    }
  }

  const stations = Array.isArray(payload)
    ? (payload as ToastPrepStation[])
    : Array.isArray((payload as any)?.prepStations)
    ? ((payload as any).prepStations as ToastPrepStation[])
    : [];

  const nextPageToken = normalizeString(response.headers.get("Toast-Next-Page-Token"));

  return {
    prepStations: stations,
    nextPageToken,
    raw: payload,
    responseHeaders: headersToObject(response.headers),
  };
}

export async function getMenuMetadata(env: AppEnv): Promise<MenuMetadataResponse | null> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = `${base}/menus/v2/metadata`;
  const headers = await getToastHeaders(env);

  try {
    const response = await fetchWithBackoff(url, { method: "GET", headers });
    return (await response.json()) as MenuMetadataResponse;
  } catch (err) {
    if (isToastNotFound(err)) {
      return null;
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function getPublishedMenus(env: AppEnv): Promise<PublishedMenuResponse | null> {
  const result = await fetchPublishedMenusFromToast(env);
  return result.document;
}

export async function getPublishedMenusCached(
  env: AppEnv,
  request?: Request
): Promise<ToastMenusDocument | null> {
  const forceRefresh = shouldForceRefresh(request);
  const cache = await readMenuCache(env);
  const { meta } = cache;

  const updatedAtMs = typeof meta?.updatedAt === "string" ? Date.parse(meta.updatedAt) : Number.NaN;
  const hasValidMeta = Boolean(meta?.updatedAt) && !Number.isNaN(updatedAtMs);
  const staleAtMs = hasValidMeta
    ? coerceTime(meta?.staleAt, updatedAtMs + MENU_STALE_AFTER_MS)
    : Number.NaN;
  const expireAtMs = hasValidMeta
    ? coerceTime(meta?.expireAt, updatedAtMs + MENU_EXPIRE_AFTER_MS)
    : Number.NaN;

  if (forceRefresh) {
    try {
      const { document, meta: freshMeta } = await fetchAndCacheMenu(env);
      setMenuCacheInfoForRequest(request, {
        status: "manual-refresh",
        updatedAt: freshMeta.updatedAt,
      });
      return document;
    } catch (err) {
      if (cache.hasDocument && hasValidMeta) {
        console.error("manual menu refresh failed, serving cached copy", { err });
        setMenuCacheInfoForRequest(request, {
          status: "hit-stale-error",
          updatedAt: meta?.updatedAt,
        });
        return cache.document;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  if (cache.hasDocument && hasValidMeta) {
    const nowMs = Date.now();
    if (nowMs <= staleAtMs) {
      setMenuCacheInfoForRequest(request, {
        status: "hit-fresh",
        updatedAt: meta?.updatedAt,
      });
      return cache.document;
    }

    if (nowMs <= expireAtMs) {
      setMenuCacheInfoForRequest(request, {
        status: "hit-stale-revalidate",
        updatedAt: meta?.updatedAt,
      });
      scheduleMenuRefresh(env);
      return cache.document;
    }
  }

  try {
    const { document, meta: freshMeta } = await fetchAndCacheMenu(env);
    setMenuCacheInfoForRequest(request, {
      status: "miss-network",
      updatedAt: freshMeta.updatedAt,
    });
    return document;
  } catch (err) {
    if (cache.hasDocument && hasValidMeta) {
      console.error("menu fetch failed, serving cached copy", { err });
      setMenuCacheInfoForRequest(request, {
        status: "hit-stale-error",
        updatedAt: meta?.updatedAt,
      });
      return cache.document;
    }

    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function getDiningOptions(env: AppEnv): Promise<DiningOptionConfig[]> {
  const cached = await env.CACHE_KV.get(DINING_OPTIONS_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as DiningOptionConfig[];
      }
    } catch (err) {
      console.warn("invalid cached dining options, ignoring", { err });
    }
  }

  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = `${base}/config/v2/diningOptions`;
  const headers = await getToastHeaders(env);
  headers["content-type"] = "application/json";

  const externalId = normalizeString((env as any)?.TOAST_RESTAURANT_EXTERNAL_ID);
  if (externalId) {
    headers["Toast-Restaurant-External-ID"] = externalId;
  }

  try {
    const response = await fetchWithBackoff(url, { method: "GET", headers });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;

    const rawOptions = Array.isArray(json?.diningOptions)
      ? (json.diningOptions as any[])
      : Array.isArray(json)
      ? (json as any[])
      : [];

    const normalized = rawOptions
      .map((option) => normalizeDiningOption(option))
      .filter((option): option is DiningOptionConfig => option !== null);

    await env.CACHE_KV.put(DINING_OPTIONS_CACHE_KEY, JSON.stringify(normalized), {
      expirationTtl: DINING_OPTIONS_CACHE_TTL_SECONDS,
    });

    return normalized;
  } catch (err) {
    if (isToastNotFound(err)) {
      return [];
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function refreshMenu(env: AppEnv): Promise<void> {
  try {
    await fetchAndCacheMenu(env);
  } catch (err) {
    console.error("failed to refresh published menu", { err });
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

interface MenuCacheReadResult {
  document: ToastMenusDocument | null;
  meta: MenuCacheMeta | null;
  hasDocument: boolean;
}

async function fetchAndCacheMenu(env: AppEnv): Promise<{
  document: ToastMenusDocument | null;
  meta: MenuCacheMeta;
}> {
  const { document, etag } = await fetchPublishedMenusFromToast(env);
  const meta = await writeMenuCache(env, document, etag ?? undefined);
  return { document, meta };
}

async function readMenuCache(env: AppEnv): Promise<MenuCacheReadResult> {
  const [rawDocument, rawMeta] = await Promise.all([
    env.CACHE_KV.get(MENU_CACHE_KEY),
    env.CACHE_KV.get(MENU_CACHE_META_KEY),
  ]);

  let hasDocument = false;
  let document: ToastMenusDocument | null = null;

  if (rawDocument !== null) {
    try {
      document = rawDocument ? (JSON.parse(rawDocument) as ToastMenusDocument) : null;
      hasDocument = true;
    } catch (err) {
      console.warn("invalid cached menu document, ignoring", { err });
      document = null;
      hasDocument = false;
    }
  }

  const meta = parseMenuCacheMeta(rawMeta);

  return { document, meta, hasDocument };
}

async function writeMenuCache(
  env: AppEnv,
  document: ToastMenusDocument | null,
  etag?: string
): Promise<MenuCacheMeta> {
  const now = Date.now();
  const meta: MenuCacheMeta = {
    updatedAt: new Date(now).toISOString(),
    staleAt: new Date(now + MENU_STALE_AFTER_MS).toISOString(),
    expireAt: new Date(now + MENU_EXPIRE_AFTER_MS).toISOString(),
  };

  if (etag) {
    meta.etag = etag;
  }

  const payload = JSON.stringify(document ?? null);
  await Promise.all([
    env.CACHE_KV.put(MENU_CACHE_KEY, payload),
    env.CACHE_KV.put(MENU_CACHE_META_KEY, JSON.stringify(meta)),
  ]);

  return meta;
}

function scheduleMenuRefresh(env: AppEnv): void {
  const promise = refreshMenu(env);
  if (typeof env.waitUntil === "function") {
    env.waitUntil(promise);
  }
}

function shouldForceRefresh(request?: Request): boolean {
  if (!request) {
    return false;
  }

  try {
    const url = new URL(request.url);
    return url.searchParams.get("refresh") === "1";
  } catch {
    return false;
  }
}

function coerceTime(value: string | undefined, fallbackMs: number): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallbackMs;
}

function parseMenuCacheMeta(value: string | null): MenuCacheMeta | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.updatedAt === "string" &&
      typeof parsed.staleAt === "string" &&
      typeof parsed.expireAt === "string"
    ) {
      const meta: MenuCacheMeta = {
        updatedAt: parsed.updatedAt,
        staleAt: parsed.staleAt,
        expireAt: parsed.expireAt,
      };
      if (typeof parsed.etag === "string" && parsed.etag) {
        meta.etag = parsed.etag;
      }
      return meta;
    }
  } catch (err) {
    console.warn("invalid cached menu metadata, ignoring", { err });
  }

  return null;
}

function normalizeDiningOption(value: any): DiningOptionConfig | null {
  const guid = normalizeString(value?.guid) ?? normalizeString(value?.id);
  if (!guid) {
    return null;
  }

  const behaviorCandidate =
    normalizeString(value?.behavior) ??
    normalizeString(value?.type) ??
    normalizeString(value?.mode);
  const nameCandidate = normalizeString(value?.name) ?? normalizeString(value?.displayName);

  return {
    guid,
    behavior: behaviorCandidate ?? null,
    name: nameCandidate ?? null,
  };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function fetchPublishedMenusFromToast(
  env: AppEnv
): Promise<{ document: ToastMenusDocument | null; etag?: string | null }> {
  const base = env.TOAST_API_BASE.replace(/\/+$/, "");
  const url = `${base}/menus/v2/menus`;
  const headers = await getToastHeaders(env);

  try {
    const response = await fetchWithBackoff(url, { method: "GET", headers });
    const etag = response.headers.get("etag");
    const text = await response.text();
    const document = text ? (JSON.parse(text) as ToastMenusDocument) : null;
    return { document, etag };
  } catch (err) {
    if (isToastNotFound(err)) {
      return { document: null, etag: null };
    }

    throw err instanceof Error ? err : new Error(String(err));
  }
}
