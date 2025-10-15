import type { AppEnv } from "../../../config/env.js";
import { getOrdersBulk } from "../../../clients/toast.js";
import { jsonResponse } from "../../../lib/http.js";

const EXPAND_FULL = [
  "checks",
  "items",
  "payments",
  "discounts",
  "serviceCharges",
  "customers",
  "employee",
];

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export interface OrdersLatestDeps {
  getOrdersBulk: typeof getOrdersBulk;
}

export function createOrdersLatestHandler(
  deps: OrdersLatestDeps = { getOrdersBulk }
) {
  return async function handleOrdersLatest(env: AppEnv, request: Request) {
    const url = new URL(request.url);
    const minutesParam = url.searchParams.get("minutes");
    const minutes = clamp(Number(minutesParam ?? 60) || 60, 1, 120);
    const wantDebug = url.searchParams.get("debug") === "1" || url.searchParams.has("debug");

    try {
      const startedAt = Date.now();
      const now = new Date();
      const start = new Date(now.getTime() - minutes * 60_000);
      const startDateIso = toToastIsoUtc(start);
      const endDateIso = toToastIsoUtc(now);

      console.log(
        `[orders/latest] start ${new Date(startedAt).toISOString()} window=${startDateIso}→${endDateIso}`
      );

      const pageDebug: Array<{ page: number; url: string; returned: number }> = [];
      const allOrders: any[] = [];

      let page = 1;
      let lastPageCount = 0;

      while (page <= MAX_PAGES) {
        const { orders, nextPage } = await deps.getOrdersBulk(env, {
          startIso: startDateIso,
          endIso: endDateIso,
          page,
          pageSize: PAGE_SIZE,
        });

        const requestUrl = buildOrdersBulkUrl(env.TOAST_API_BASE, {
          startIso: startDateIso,
          endIso: endDateIso,
          page,
          pageSize: PAGE_SIZE,
        });

        pageDebug.push({ page, url: requestUrl, returned: orders.length });
        allOrders.push(...orders);
        lastPageCount = orders.length;

        const hasMore =
          (typeof nextPage === "number" && nextPage > page) || orders.length === PAGE_SIZE;

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

      const sorted = allOrders.slice().sort((a, b) => {
        const aTime = a?.updatedDate ? Date.parse(a.updatedDate) : 0;
        const bTime = b?.updatedDate ? Date.parse(b.updatedDate) : 0;
        return bTime - aTime;
      });

      const ids = Array.from(new Set(sorted.map((order: any) => order?.guid).filter(Boolean)));

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
      const snippet = err?.bodySnippet ?? err?.message ?? String(err ?? "Unknown error");

      return jsonResponse(
        {
          ok: false,
          route: "/api/orders/latest",
          error: typeof snippet === "string" ? snippet : "Unknown error",
        },
        { status }
      );
    }
  };
}

export default createOrdersLatestHandler();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toToastIsoUtc(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const yyyy = date.getUTCFullYear();
  const MM = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const HH = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  const mmm = pad(date.getUTCMilliseconds(), 3);
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.${mmm}+0000`;
}

function buildOrdersBulkUrl(base: string, params: { startIso: string; endIso: string; page: number; pageSize: number }): string {
  const normalized = base.replace(/\/+$/, "");
  const url = new URL(`${normalized}/orders/v2/ordersBulk`);
  url.searchParams.set("startDate", params.startIso);
  url.searchParams.set("endDate", params.endIso);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("pageSize", String(params.pageSize));
  return url.toString();
}
