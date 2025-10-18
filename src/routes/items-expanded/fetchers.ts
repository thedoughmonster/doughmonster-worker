import type { AppEnv } from "../../config/env.js";
import menusHandler from "../api/menus.js";
import ordersLatestHandler from "../api/orders/latest.js";
import type {
  FetchResult,
  MenuFetchData,
  MenusResponse,
  OrdersLatestResponse,
  UpstreamTrace,
} from "./types-local.js";

const SNIPPET_LENGTH = 256;
const TEXT_ENCODER = new TextEncoder();

export async function fetchOrdersFromWorker(
  env: AppEnv,
  originalRequest: Request,
  url: URL,
  options: { minutes?: number; rangeMode?: boolean } = {}
): Promise<FetchResult<OrdersLatestResponse>> {
  const { minutes, rangeMode: optionsRangeMode = false } = options ?? {};
  if (!optionsRangeMode && typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) {
    url.searchParams.set("minutes", String(minutes));
  }
  const trace = createTrace(url, "direct");

  try {
    const payload = await callOrdersLatestDirect(env, url);
    trace.status = 200;
    trace.ok = Boolean(payload?.ok);
    if (payload && payload.ok) {
      return { ok: true, data: payload, trace };
    }

    throw new Error("Direct orders handler returned non-ok payload");
  } catch (err) {
    const fallback = await fetchJsonFromNetwork<OrdersLatestResponse>(url, originalRequest);
    fallback.trace.internalFallbackUsed = true;
    return fallback;
  }
}

export async function fetchMenuFromWorker(
  env: AppEnv,
  originalRequest: Request,
  url: URL
): Promise<FetchResult<MenuFetchData>> {
  const trace = createTrace(url, "direct");

  try {
    const payload = await callMenusDirect(env, url);
    trace.status = 200;
    trace.ok = Boolean(payload?.ok);

    if (payload && payload.ok) {
      const cacheStatus = payload.cacheHit ? "hit-fresh" : "miss-network";
      const updatedAt = payload.metadata?.lastUpdated ?? null;
      trace.cacheStatus = cacheStatus;
      trace.updatedAt = updatedAt;
      trace.cacheHit = Boolean(payload.cacheHit);

      return {
        ok: true,
        data: {
          payload,
          document: payload.menu ?? null,
          cacheStatus,
          updatedAt,
        },
        trace,
      };
    }

    throw new Error("Direct menu handler returned non-ok payload");
  } catch (err) {
    const fallback = await fetchJsonFromNetwork<MenusResponse>(url, originalRequest);
    fallback.trace.internalFallbackUsed = true;

    if (!fallback.ok) {
      return fallback;
    }

    const payload = fallback.data;
    if (payload && payload.ok) {
      const successPayload = payload as MenusResponse & { ok: true };
      const cacheStatus = successPayload.cacheHit ? "hit-fresh" : "miss-network";
      const updatedAt = successPayload.metadata?.lastUpdated ?? null;
      fallback.trace.cacheStatus = cacheStatus;
      fallback.trace.updatedAt = updatedAt;
      fallback.trace.cacheHit = Boolean(successPayload.cacheHit);

      return {
        ok: true,
        data: {
          payload,
          document: successPayload.menu ?? null,
          cacheStatus,
          updatedAt,
        },
        trace: fallback.trace,
      };
    }

    fallback.trace.cacheStatus = null;
    fallback.trace.updatedAt = null;
    fallback.trace.cacheHit = null;

    return {
      ok: true,
      data: {
        payload,
        document: null,
        cacheStatus: null,
        updatedAt: null,
      },
      trace: fallback.trace,
    };
  }
}

async function callOrdersLatestDirect(env: AppEnv, url: URL): Promise<OrdersLatestResponse> {
  const internalUrl = toInternalUrl(url);
  const response = await ordersLatestHandler(env, new Request(internalUrl.toString(), { method: "GET" }));

  if (!response.ok) {
    const snippet = await response.text().catch(() => "");
    const error = new Error(`Direct call to ${url.pathname} failed with status ${response.status}`);
    (error as any).status = response.status;
    (error as any).body = snippet.slice(0, SNIPPET_LENGTH);
    throw error;
  }

  return (await response.json()) as OrdersLatestResponse;
}

async function callMenusDirect(env: AppEnv, url: URL): Promise<MenusResponse> {
  const internalUrl = toInternalUrl(url);
  const response = await menusHandler(env, new Request(internalUrl.toString(), { method: "GET" }));

  if (!response.ok) {
    const snippet = await response.text().catch(() => "");
    const error = new Error(`Direct call to ${url.pathname} failed with status ${response.status}`);
    (error as any).status = response.status;
    (error as any).body = snippet.slice(0, SNIPPET_LENGTH);
    throw error;
  }

  return (await response.json()) as MenusResponse;
}

async function fetchJsonFromNetwork<T>(url: URL, originalRequest: Request): Promise<FetchResult<T>> {
  const trace = createTrace(url, "network");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: pickForwardHeaders(originalRequest.headers),
    });
    trace.status = response.status;
    trace.ok = response.ok;

    const bodyText = await response.text().catch(() => "");
    trace.bytes = TEXT_ENCODER.encode(bodyText).length;
    trace.snippet = bodyText.slice(0, SNIPPET_LENGTH);

    if (!response.ok) {
      const error = new Error(`Request failed with status ${response.status}`);
      (error as any).upstreamStatus = response.status;
      (error as any).upstreamBody = trace.snippet;
      return { ok: false, error, trace };
    }

    if (!bodyText) {
      return { ok: true, data: {} as T, trace };
    }

    try {
      const parsed = JSON.parse(bodyText) as T;
      return { ok: true, data: parsed, trace };
    } catch (err) {
      const error = new Error("Failed to parse upstream response");
      (error as any).cause = err;
      return { ok: false, error, trace };
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { ok: false, error, trace };
  }
}

function createTrace(url: URL, path: "direct" | "network"): UpstreamTrace {
  return {
    path,
    internalFallbackUsed: false,
    url: `${url.pathname}${url.search}`,
    absoluteUrl: url.toString(),
    status: null,
    ok: null,
    bytes: null,
    snippet: null,
    cacheStatus: null,
    cacheHit: null,
    updatedAt: null,
  };
}

function toInternalUrl(url: URL): URL {
  return new URL(`${url.pathname}${url.search}`, "http://internal.worker");
}

function pickForwardHeaders(headers: Headers): HeadersInit {
  const forwarded = new Headers();
  for (const key of ["authorization", "cookie", "x-forwarded-for", "x-forwarded-proto", "cf-ray", "cf-connecting-ip"]) {
    const value = headers.get(key);
    if (value) forwarded.set(key, value);
  }
  return forwarded;
}
