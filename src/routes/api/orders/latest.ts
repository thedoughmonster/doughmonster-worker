// src/routes/api/orders/latest.ts
// Fetch full Toast orders for the last ?minutes= (default 60, max 120) with expand.
// Add ?debug=1 to see detailed request/response diagnostics.

import type { ToastEnv } from "../../../lib/env";
import { jsonResponse } from "../../../lib/http";
import { getAccessToken } from "../../../lib/toastAuth";
import { paceBeforeToastCall } from "../../../lib/pacer";

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Toast requires yyyy-MM-dd'T'HH:mm:ss.SSSZ with +0000 suffix for UTC
function toToastIsoUtc(d: Date): string {
  const pad = (x: number, len = 2) => String(x).padStart(len, "0");
  const yyyy = d.getUTCFullYear();
  const MM = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const HH = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  const mmm = pad(d.getUTCMilliseconds(), 3);
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.${mmm}+0000`;
}

const EXPAND_FULL = [
  "checks",
  "items",
  "payments",
  "discounts",
  "serviceCharges",
  "customers",
  "employee",
];

const MAX_RETRIES = 3;
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // safety cap (5k orders in a single window is plenty)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type OrdersBulkPage = {
  orders: any[];
  totalCount?: number;
  page?: number;
  pageSize?: number;
  nextPage?: number | null;
};

async function fetchOrdersBulkPage(
  url: string,
  headers: Headers,
  page: number
): Promise<{ page: OrdersBulkPage; raw: any; responseHeaders: Record<string, string> }> {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    if (attempt > 0) {
      // simple exponential backoff: 250ms, 500ms
      await sleep(250 * Math.pow(2, attempt - 1));
    }

    await paceBeforeToastCall("orders", 220);

    const res = await fetch(url, { method: "GET", headers });
    const retryAfter = res.headers.get("Retry-After");

    if (res.status === 429) {
      await paceBeforeToastCall("orders", 220, retryAfter);
      attempt += 1;
      continue;
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // leave json = null for error reporting
    }

    const responseHeaders = headersToObject(res.headers);

    if (!res.ok) {
      throw {
        status: res.status,
        url,
        body: json ?? (text?.slice(0, 1000) ?? null),
        responseHeaders,
      };
    }

    const orders: any[] = Array.isArray(json?.orders)
      ? json.orders
      : Array.isArray(json)
      ? json
      : [];

    const pageData: OrdersBulkPage = {
      orders,
      totalCount: typeof json?.totalCount === "number" ? json.totalCount : undefined,
      page: typeof json?.page === "number" ? json.page : page,
      pageSize: typeof json?.pageSize === "number" ? json.pageSize : PAGE_SIZE,
      nextPage:
        typeof json?.nextPage === "number"
          ? json.nextPage
          : typeof json?.hasMore === "boolean" && json.hasMore
          ? page + 1
          : undefined,
    };

    return { page: pageData, raw: json, responseHeaders };
  }

  throw {
    status: 429,
    url,
    body: { message: "ordersBulk retry limit exceeded" },
    responseHeaders: {},
  };
}

export default async function handleOrdersLatest(env: ToastEnv, request: Request) {
  const url = new URL(request.url);
  const minutesParam = url.searchParams.get("minutes");
  const minutes = clamp(Number(minutesParam ?? 60) || 60, 1, 120);
  const wantDebug = url.searchParams.has("debug") || url.searchParams.get("debug") === "1";

  try {
    const startedAt = Date.now();
    const now = new Date();
    const start = new Date(now.getTime() - minutes * 60_000);
    const startDateIso = toToastIsoUtc(start);
    const endDateIso = toToastIsoUtc(now);

    console.log(
      `[orders/latest] start ${new Date(startedAt).toISOString()} window=${startDateIso}→${endDateIso}`
    );

    const base = env.TOAST_API_BASE.replace(/\/+$/, "");
    const route = "/orders/v2/ordersBulk";

    const token = await getAccessToken(env);
    const headers = new Headers({
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID,
    });

    const pageDebug: Array<{ page: number; url: string; returned: number }> = [];
    const allOrders: any[] = [];

    let page = 1;
    let lastPageCount = 0;

    while (page <= MAX_PAGES) {
      const pageUrl = new URL(`${base}${route}`);
      pageUrl.searchParams.set("startDate", startDateIso);
      pageUrl.searchParams.set("endDate", endDateIso);
      pageUrl.searchParams.set("pageSize", String(PAGE_SIZE));
      pageUrl.searchParams.set("page", String(page));

      const fullUrl = pageUrl.toString();

      let pageResult: { page: OrdersBulkPage; raw: any; responseHeaders: Record<string, string> };

      try {
        pageResult = await fetchOrdersBulkPage(fullUrl, headers, page);
      } catch (err: any) {
        const status = typeof err?.status === "number" ? err.status : 500;
        const errorBody = {
          ok: false,
          route: "/api/orders/latest",
          minutes,
          window: { start: startDateIso, end: endDateIso },
          error: `Toast error ${status} on ${route}`,
          toast: {
            route,
            url: fullUrl,
            page,
            headerUsed: "Toast-Restaurant-External-ID",
            responseStatus: status,
            responseHeaders: err?.responseHeaders ?? {},
            body: err?.body ?? null,
          },
        };
        return jsonResponse(errorBody, { status });
      }

      const orders = pageResult.page.orders ?? [];
      pageDebug.push({ page, url: fullUrl, returned: orders.length });
      allOrders.push(...orders);

      lastPageCount = orders.length;

      const hasMore =
        (typeof pageResult.page.nextPage === "number" && pageResult.page.nextPage > page) ||
        orders.length === PAGE_SIZE;

      if (!hasMore) {
        break;
      }

      page += 1;
    }

    if (page > MAX_PAGES && lastPageCount === PAGE_SIZE) {
      console.warn(
        `[orders/latest] hit MAX_PAGES=${MAX_PAGES} for window ${startDateIso}→${endDateIso}`
      );
    }

    // Sort by updatedDate desc when available
    const sorted = allOrders.slice().sort((a, b) => {
      const aTime = a?.updatedDate ? Date.parse(a.updatedDate) : 0;
      const bTime = b?.updatedDate ? Date.parse(b.updatedDate) : 0;
      return bTime - aTime;
    });

    const ids = Array.from(new Set(sorted.map((o: any) => o?.guid).filter(Boolean)));

    const responseBody: any = {
      ok: true,
      route: "/api/orders/latest",
      minutes,
      window: { start: startDateIso, end: endDateIso },
      detail: "full",
      expandUsed: EXPAND_FULL,
      count: sorted.length,
      ids,
      orders: ids,
      data: sorted,
    };

    if (wantDebug) {
      responseBody.debug = {
        pages: pageDebug,
        totalReturned: sorted.length,
      };
    }

    const finishedAt = Date.now();
    console.log(
      `[orders/latest] finish ${new Date(finishedAt).toISOString()} count=${sorted.length} pages=${pageDebug.length} duration=${
        finishedAt - startedAt
      }ms`
    );

    return jsonResponse(responseBody);
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    const msg =
      typeof err?.message === "string"
        ? err.message
        : typeof err === "string"
        ? err
        : "Unknown error";
    return jsonResponse(
      {
        ok: false,
        route: "/api/orders/latest",
        error: msg,
      },
      { status }
    );
  }
}
