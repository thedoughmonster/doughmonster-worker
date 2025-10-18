import type { AppEnv } from "../config/env.js";
import { jsonResponse } from "../lib/http.js";
import menusHandler from "./api/menus.js";
import ordersLatestHandler from "./api/orders/latest.js";
import type { ToastMenuItem, ToastMenusDocument, ToastModifierOption } from "../types/toast-menus.js";
import type { ToastCheck, ToastOrder, ToastSelection } from "../types/toast-orders.js";

const DEFAULT_OUTPUT_LIMIT = 20;
const MAX_OUTPUT_LIMIT = 500;
const ORDERS_UPSTREAM_MAX = 200;
const HANDLER_TIME_BUDGET_MS = 12_000; // allow partial aggregation to complete
const SNIPPET_LENGTH = 256;
const TEXT_ENCODER = new TextEncoder();

interface UpstreamTrace {
  path: "direct" | "network";
  internalFallbackUsed: boolean;
  url: string;
  absoluteUrl: string;
  status: number | null;
  ok: boolean | null;
  bytes: number | null;
  snippet: string | null;
  cacheStatus?: string | null;
  cacheHit?: boolean | null;
  updatedAt?: string | null;
}

type ItemFulfillmentStatus = "NEW" | "HOLD" | "SENT" | "READY";

type OrdersLatestResponse =
  | { ok: true; data?: ToastOrder[]; orders?: ToastOrder[]; window?: { start?: string | null; end?: string | null } }
  | { ok: false; error?: { message?: string } | string | null };

type MenusResponse =
  | { ok: true; menu: ToastMenusDocument | null; metadata?: { lastUpdated?: string | null }; cacheHit?: boolean }
  | { ok: false; error?: { message?: string } | string | null };

interface ExpandedOrderItemModifier {
  id: string | null;
  name: string;
  groupName?: string | null;
  priceCents: number;
  quantity: number;
}

interface ExpandedOrderItemMoney {
  baseItemPriceCents?: number;
  modifierTotalCents?: number;
  totalItemPriceCents?: number;
}

interface ExpandedOrderItem {
  lineItemId: string;
  menuItemId?: string | null;
  itemName: string;
  quantity: number;
  fulfillmentStatus?: string | null;
  modifiers: ExpandedOrderItemModifier[];
  specialInstructions?: string | null;
  money?: ExpandedOrderItemMoney;
}

type OrderType = "TAKEOUT" | "DELIVERY" | "DINE_IN" | "CURBSIDE" | "DRIVE_THRU" | "CATERING" | "UNKNOWN";

interface ExpandedOrder {
  orderData: {
    orderId: string;
    location: { locationId?: string | null };
    orderTime: string;
    timeDue: string | null;
    orderNumber: string | null;
    checkId: string | null;
    status: string | null;
    fulfillmentStatus: string | null;
    customerName: string | null;
    orderType: OrderType;
    diningOptionGuid: string | null;
    deliveryState?: string | null;
    deliveryInfo?: Record<string, unknown> | null;
    curbsidePickupInfo?: Record<string, unknown> | null;
    table?: Record<string, unknown> | null;
    seats?: number[];
    employee?: Record<string, unknown> | null;
    promisedDate?: string | null;
    estimatedFulfillmentDate?: string | null;
  };
  currency?: string | null;
  items: ExpandedOrderItem[];
  totals: {
    baseItemsSubtotalCents: number;
    modifiersSubtotalCents: number;
    discountTotalCents: number;
    serviceChargeCents: number;
    tipCents: number;
    grandTotalCents: number;
  };
}

interface DiagnosticsCounters {
  ordersSeen: number;
  checksSeen: number;
  itemsIncluded: number;
  dropped: { ordersVoided: number; ordersTimeParse: number; selectionsVoided: number; selectionsFiltered: number };
  totals: {
    baseItemsSubtotalCents: number;
    modifiersSubtotalCents: number;
    discountTotalCents: number;
    serviceChargeCents: number;
    tipCents: number;
    grandTotalCents: number;
  };
}

type FetchResult<T> =
  | { ok: true; data: T; trace: UpstreamTrace }
  | { ok: false; error: Error; trace: UpstreamTrace };

interface MenuFetchData {
  payload: MenusResponse;
  document: ToastMenusDocument | null;
  cacheStatus: string | null;
  updatedAt: string | null;
}

export default async function handleItemsExpanded(env: AppEnv, request: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = Math.random().toString(36).slice(2, 10);
  const url = new URL(request.url);
  const origin = url.origin;

  const debugRequested = url.searchParams.get("debug") === "1";
  const refreshRequested = url.searchParams.get("refresh") === "1";
  const requestedLimit = parseNumber(url.searchParams.get("limit"), DEFAULT_OUTPUT_LIMIT);
  const finalLimit = clamp(requestedLimit, 1, MAX_OUTPUT_LIMIT);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const statusParam = url.searchParams.get("status");
  const locationParam = url.searchParams.get("locationId");
  const detailParam = url.searchParams.get("detail");
  const upstreamLimit = clamp(requestedLimit, 1, ORDERS_UPSTREAM_MAX);

  const ordersUrl = new URL("/api/orders/latest", origin);
  ordersUrl.searchParams.set("limit", String(upstreamLimit));
  ordersUrl.searchParams.set("detail", detailParam ?? "full");
  if (startParam) ordersUrl.searchParams.set("start", startParam);
  if (endParam) ordersUrl.searchParams.set("end", endParam);
  if (statusParam) ordersUrl.searchParams.set("status", statusParam);
  if (locationParam) ordersUrl.searchParams.set("locationId", locationParam);

  const menuUrl = new URL("/api/menus", origin);
  if (refreshRequested) menuUrl.searchParams.set("refresh", "1");

  const [ordersResult, menuResult] = await Promise.all([
    fetchOrdersFromWorker(env, request, ordersUrl),
    fetchMenuFromWorker(env, request, menuUrl),
  ]);

  const timingMs = Date.now() - startedAt;
  const ordersTrace = ordersResult.trace;
  const menuTrace = menuResult.trace;

  const ordersPayload = ordersResult.ok ? ordersResult.data : null;
  const menuPayload = menuResult.ok ? menuResult.data.payload : null;
  const ordersOk = Boolean(ordersPayload && (ordersPayload as OrdersLatestResponse).ok);
  const menuOk = Boolean(menuPayload && (menuPayload as MenusResponse).ok);

  let ordersData: ToastOrder[] | null = null;
  if (ordersOk && ordersPayload) {
    const okPayload = ordersPayload as OrdersLatestResponse & { ok: true };
    ordersData = Array.isArray(okPayload.data)
      ? okPayload.data
      : Array.isArray((okPayload as any).orders)
      ? ((okPayload as any).orders as ToastOrder[])
      : null;
  }
  const upstreamOrdersCount = Array.isArray(ordersData) ? ordersData.length : 0;

  if (!ordersResult.ok || !menuResult.ok || !ordersOk || !menuOk) {
    const ordersBody = ordersOk ? (ordersPayload as OrdersLatestResponse & { ok: true }) : null;
    const debug = buildDebugPayload({
      requestId,
      timingMs,
      ordersTrace,
      menuTrace,
      window: {
        startIso: ordersBody?.window?.start ?? startParam ?? null,
        endIso: ordersBody?.window?.end ?? endParam ?? null,
      },
      limit: finalLimit,
      originSeen: origin,
      lastPage: 1,
      timedOut: false,
    });

    const message = !ordersResult.ok
      ? ordersResult.error.message
      : !menuResult.ok
      ? menuResult.error.message
      : !ordersOk
      ? extractErrorMessage(ordersPayload as OrdersLatestResponse)
      : extractErrorMessage(menuPayload as MenusResponse);

    return jsonResponse(
      {
        error: { message: message ?? "Upstream service unavailable", code: "UPSTREAM_UNAVAILABLE" },
        debug,
      },
      { status: 502 }
    );
  }

  const ordersBody = ordersPayload as OrdersLatestResponse & { ok: true };
  const menuBody = menuPayload as MenusResponse & { ok: true };

  menuTrace.cacheStatus = menuBody.cacheHit ? "hit-fresh" : "miss-network";
  menuTrace.updatedAt = menuBody.metadata?.lastUpdated ?? null;
  menuTrace.cacheHit = Boolean(menuBody.cacheHit);

  const build = buildExpandedOrders({
    ordersPayload: ordersBody,
    menuDocument: menuBody.menu ?? null,
    limit: finalLimit,
    startedAt,
  });

  const response: any = {
    orders: build.orders,
    cacheInfo: {
      menu: menuBody.cacheHit ? "hit-fresh" : "miss-network",
      menuUpdatedAt: menuBody.metadata?.lastUpdated ?? null,
    },
  };

  if (debugRequested) {
    response.debug = buildDebugPayload({
      requestId,
      timingMs,
      ordersTrace,
      menuTrace,
      window: {
        startIso: ordersBody.window?.start ?? startParam ?? null,
        endIso: ordersBody.window?.end ?? endParam ?? null,
      },
      limit: finalLimit,
      originSeen: origin,
      lastPage: 1,
      timedOut: build.timedOut,
      diagnostics: build.diagnostics,
      upstreamOrdersCount,
    });
  }

  return jsonResponse(response);
}

function buildDebugPayload(args: {
  requestId: string;
  timingMs: number;
  ordersTrace: UpstreamTrace;
  menuTrace: UpstreamTrace;
  window: { startIso: string | null; endIso: string | null };
  limit: number;
  originSeen: string;
  lastPage: number;
  timedOut: boolean;
  diagnostics?: DiagnosticsCounters;
  upstreamOrdersCount?: number;
}) {
  return { ...args, ordersUpstream: args.ordersTrace, menuUpstream: args.menuTrace };
}

async function fetchOrdersFromWorker(
  env: AppEnv,
  originalRequest: Request,
  url: URL
): Promise<FetchResult<OrdersLatestResponse>> {
  const trace = createTrace(url, "direct");

  // Respect incoming detail param if present
  const incomingDetail = new URL(originalRequest.url).searchParams.get("detail");
  if (incomingDetail) {
    url.searchParams.set("detail", incomingDetail);
  }

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

async function fetchMenuFromWorker(
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

function buildExpandedOrders(args: {
  ordersPayload: OrdersLatestResponse & { ok: true };
  menuDocument: ToastMenusDocument | null;
  limit: number;
  startedAt: number;
}): { orders: ExpandedOrder[]; diagnostics: DiagnosticsCounters; timedOut: boolean } {
  const diagnostics: DiagnosticsCounters = {
    ordersSeen: 0,
    checksSeen: 0,
    itemsIncluded: 0,
    dropped: { ordersVoided: 0, ordersTimeParse: 0, selectionsVoided: 0, selectionsFiltered: 0 },
    totals: {
      baseItemsSubtotalCents: 0,
      modifiersSubtotalCents: 0,
      discountTotalCents: 0,
      serviceChargeCents: 0,
      tipCents: 0,
      grandTotalCents: 0,
    },
  };

  const menuIndex = createMenuIndex(args.menuDocument);
  const deadline = args.startedAt + HANDLER_TIME_BUDGET_MS;
  const orders = extractOrders(args.ordersPayload);
  const collected: { order: ExpandedOrder; timeMs: number | null }[] = [];
  let timedOut = false;

  outer: for (const order of orders) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    if (!order || typeof (order as any).guid !== "string") continue;
    diagnostics.ordersSeen += 1;
    if (isVoided(order)) {
      diagnostics.dropped.ordersVoided += 1;
      continue;
    }

    const orderTime = extractTimestamp(order, ORDER_TIME_FIELDS);
    if (!orderTime) {
      diagnostics.dropped.ordersTimeParse += 1;
      continue;
    }

    const checks = Array.isArray(order.checks) ? order.checks : [];
    for (const check of checks) {
      if (Date.now() > deadline) {
        timedOut = true;
        break outer;
      }
      if (!check || typeof (check as any).guid !== "string") continue;
      diagnostics.checksSeen += 1;
      if (isVoided(check)) {
        diagnostics.dropped.ordersVoided += 1;
        continue;
      }

      const built = buildOrderFromCheck(order, check, orderTime, menuIndex, diagnostics);
      if (!built) continue;
      collected.push(built);
      if (collected.length >= args.limit) continue outer;
    }
  }

  const sorted = collected
    .sort((a, b) => compareOrders(a.timeMs, b.timeMs, a.order.orderData.orderId, b.order.orderData.orderId, a.order.orderData.checkId, b.order.orderData.checkId))
    .slice(0, args.limit)
    .map((entry) => {
      diagnostics.itemsIncluded += entry.order.items.length;
      diagnostics.totals.baseItemsSubtotalCents += entry.order.totals.baseItemsSubtotalCents;
      diagnostics.totals.modifiersSubtotalCents += entry.order.totals.modifiersSubtotalCents;
      diagnostics.totals.discountTotalCents += entry.order.totals.discountTotalCents;
      diagnostics.totals.serviceChargeCents += entry.order.totals.serviceChargeCents;
      diagnostics.totals.tipCents += entry.order.totals.tipCents;
      diagnostics.totals.grandTotalCents += entry.order.totals.grandTotalCents;
      return entry.order;
    });

  return { orders: sorted, diagnostics, timedOut };
}

function extractOrders(payload: OrdersLatestResponse & { ok: true }): ToastOrder[] {
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray((payload as any).orders)) return (payload as any).orders as ToastOrder[];
  return [];
}

function buildOrderFromCheck(
  order: ToastOrder,
  check: ToastCheck,
  orderTime: { iso: string; ms: number | null },
  menuIndex: ReturnType<typeof createMenuIndex>,
  diagnostics: DiagnosticsCounters
): { order: ExpandedOrder; timeMs: number | null } | null {
  const orderId = pickStringPaths(order, check, ["order.guid", "order.id"]);
  if (!orderId) return null;

  const meta = extractOrderMeta(order, check);
  const checkId = meta.checkId;

  const selections = Array.isArray((check as any).selections) ? ((check as any).selections as ToastSelection[]) : [];
  const items: ExpandedOrderItem[] = [];
  const metas: ItemSortMeta[] = [];
  let baseSubtotal = 0;
  let modifierSubtotal = 0;
  let discountTotal = 0;
  const serviceChargeCents = sumAmounts((check as any)?.appliedServiceCharges, ["chargeAmount", "amount"]);
  const tipCents = sumAmounts((check as any)?.payments, ["tipAmount", "tip", "gratuity"]);

  let hasItemStatus = false;
  let anyNotReady = false;
  let allReady = true;

  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index];
    if (!selection || typeof selection !== "object") continue;
    if (isVoided(selection)) {
      diagnostics.dropped.selectionsVoided += 1;
      continue;
    }
    if (!isLineItem(selection)) {
      diagnostics.dropped.selectionsFiltered += 1;
      continue;
    }

    const lineItemId = resolveLineItemId(orderId, checkId, selection, index);
    if (!lineItemId) {
      diagnostics.dropped.selectionsFiltered += 1;
      continue;
    }

    const menuItem = menuIndex.findItem(selection.item);
    const itemName = pickString([
      (menuItem as any)?.kitchenName,
      (menuItem as any)?.name,
      (selection as any)?.displayName,
      (selection as any)?.name,
      (selection as any)?.item?.name,
      (selection as any)?.item?.kitchenName,
      (selection as any)?.item?.guid,
    ]) ?? "Unknown item";
    const menuItemId = pickString([(selection as any)?.item?.guid]);
    const quantity = normalizeQuantity((selection as any)?.quantity);

    const modifierDetails = collectModifierDetails(selection, menuIndex, quantity);
    modifierSubtotal += modifierDetails.totalCents;

    const unitPrice = extractNumber(selection as any, ["receiptLinePrice", "price"]);
    const baseEachCents = unitPrice !== null ? toCents(unitPrice) : null;
    const baseTotalCents = baseEachCents !== null ? baseEachCents * quantity : null;
    if (baseTotalCents !== null) baseSubtotal += baseTotalCents;

    const explicitTotal = toCents((selection as any)?.price);
    const totalCents = resolveItemTotal(baseTotalCents, modifierDetails.totalCents, explicitTotal);
    if (totalCents !== null && baseTotalCents === null) baseSubtotal += Math.max(totalCents - modifierDetails.totalCents, 0);

    const selectionDiscount = sumAmounts((selection as any)?.appliedDiscounts, ["discountAmount", "amount", "value"]);
    if (selectionDiscount > 0) discountTotal += selectionDiscount;

    const fulfillment = normalizeItemFulfillmentStatus((selection as any)?.fulfillmentStatus);
    if (fulfillment) {
      hasItemStatus = true;
      if (fulfillment === "READY") {
        if (!anyNotReady) allReady = allReady && true;
      } else {
        anyNotReady = true;
        allReady = false;
      }
    }

    const item: ExpandedOrderItem = {
      lineItemId,
      menuItemId,
      itemName,
      quantity,
      modifiers: modifierDetails.modifiers,
    };
    if (fulfillment) item.fulfillmentStatus = fulfillment;

    const specialInstructions = pickString([(selection as any)?.specialInstructions, getSpecialRequest(selection, itemName)]);
    if (specialInstructions) item.specialInstructions = specialInstructions;

    const money: ExpandedOrderItemMoney = {};
    if (baseTotalCents !== null) money.baseItemPriceCents = baseTotalCents;
    else if (baseEachCents !== null) money.baseItemPriceCents = baseEachCents * quantity;
    if (modifierDetails.totalCents > 0) money.modifierTotalCents = modifierDetails.totalCents;
    if (totalCents !== null) money.totalItemPriceCents = totalCents;
    if (Object.keys(money).length > 0) item.money = money;

    items.push(item);
    metas.push(buildItemSortMeta(selection, itemName, menuItemId, lineItemId, index));
  }

  if (items.length === 0 && baseSubtotal === 0 && modifierSubtotal === 0 && discountTotal === 0) return null;

  const checkDiscount = sumAmounts((check as any)?.appliedDiscounts, ["discountAmount", "amount", "value"]);
  if (checkDiscount > 0) discountTotal += checkDiscount;

  const subtotal = baseSubtotal + modifierSubtotal;
  const grandTotal = Math.max(subtotal - discountTotal + serviceChargeCents + tipCents, 0);
  const fulfillmentStatus = resolveFulfillmentStatus(order, check, hasItemStatus, anyNotReady, allReady);
  const sortedItems = sortItems(items, metas);

  const location: { locationId?: string | null } = {};
  if (meta.locationId) location.locationId = meta.locationId;

  const orderData: ExpandedOrder["orderData"] = {
    orderId,
    location,
    orderTime: orderTime.iso,
    timeDue: meta.timeDue ?? null,
    orderNumber: meta.orderNumber ?? null,
    checkId: checkId ?? null,
    status: meta.status ?? null,
    fulfillmentStatus,
    customerName: meta.customerName ?? null,
    orderType: meta.orderType,
    diningOptionGuid: meta.diningOptionGuid ?? null,
  };

  if (meta.deliveryState) orderData.deliveryState = meta.deliveryState;
  if (meta.deliveryInfo) orderData.deliveryInfo = meta.deliveryInfo;
  if (meta.curbsidePickupInfo) orderData.curbsidePickupInfo = meta.curbsidePickupInfo;
  if (meta.table) orderData.table = meta.table;
  if (meta.seats.length > 0) orderData.seats = meta.seats;
  if (meta.employee) orderData.employee = meta.employee;
  if (meta.promisedDate) orderData.promisedDate = meta.promisedDate;
  if (meta.estimatedFulfillmentDate) orderData.estimatedFulfillmentDate = meta.estimatedFulfillmentDate;

  return {
    order: {
      orderData,
      currency: meta.currency ?? null,
      items: sortedItems,
      totals: {
        baseItemsSubtotalCents: baseSubtotal,
        modifiersSubtotalCents: modifierSubtotal,
        discountTotalCents: discountTotal,
        serviceChargeCents,
        tipCents,
        grandTotalCents: grandTotal,
      },
    },
    timeMs: orderTime.ms,
  };
}

const ORDER_TIME_FIELDS = ["createdDate", "openedDate", "promisedDate", "estimatedFulfillmentDate", "readyDate"];
const ORDER_LOCATION_FIELDS = [
  "order.restaurantLocationGuid",
  "order.restaurantGuid",
  "order.locationGuid",
  "order.locationId",
  "order.context.restaurantLocationGuid",
  "order.context.locationGuid",
  "order.context.locationId",
  "order.revenueCenter.guid",
];

const ORDER_META_STRINGS: Record<string, string[]> = {
  orderNumber: ["order.displayNumber", "order.orderNumber"],
  timeDue: ["order.promisedDate", "order.estimatedFulfillmentDate"],
  locationId: ORDER_LOCATION_FIELDS,
  status: ["order.status", "order.orderStatus", "order.approvalStatus"],
  currency: ["order.currency", "order.currencyCode"],
  customerName: ["check.customerName", "check.customer.name", "order.customerName", "order.customer.name", "order.customers.0.name"],
  diningOptionGuid: ["check.diningOptionGuid", "check.diningOption.guid", "order.diningOptionGuid", "order.diningOption.guid", "order.context.diningOption.guid"],
  deliveryState: ["check.deliveryInfo.state", "order.deliveryInfo.state", "order.context.deliveryInfo.state"],
  promisedDate: ["order.promisedDate"],
  estimatedFulfillmentDate: ["order.estimatedFulfillmentDate"],
};

const ORDER_META_OBJECTS: Record<string, string[]> = {
  deliveryInfo: ["check.deliveryInfo", "order.deliveryInfo", "order.context.deliveryInfo"],
  curbsidePickupInfo: ["check.curbsidePickupInfo", "order.curbsidePickupInfo", "order.context.curbsidePickupInfo"],
  table: ["check.table", "order.table", "order.context.table"],
  employee: ["check.employee", "order.employee", "order.context.employee"],
};

const ORDER_SEAT_FIELDS = ["check.seatNumbers", "check.seats", "check.diningContext.seats", "order.context.diningContext.seats"];

const ORDER_TYPE_FIELDS = [
  "check.orderType",
  "check.serviceType",
  "check.orderMode",
  "check.channelType",
  "check.fulfillmentMode",
  "order.orderType",
  "order.serviceType",
  "order.orderMode",
  "order.channelType",
  "order.mode",
  "order.fulfillmentType",
  "order.fulfillmentMode",
  "order.source.orderType",
  "order.source.serviceType",
  "order.source.mode",
  "order.context.orderType",
  "order.context.serviceType",
  "order.context.orderMode",
  "order.context.channelType",
  "order.context.fulfillmentType",
  "order.context.fulfillmentMode",
  "order.context.diningOption",
  "order.context.diningOptionType",
];

const GUEST_FULFILLMENT_FIELDS = [
  "check.guestOrderFulfillmentStatus",
  "check.guestOrderFulfillmentStatus.status",
  "check.guestFulfillmentStatus",
  "check.guestFulfillmentStatus.status",
  "check.fulfillmentStatusWebhook",
  "check.fulfillmentStatusWebhook.status",
  "order.guestOrderFulfillmentStatus",
  "order.guestOrderFulfillmentStatus.status",
  "order.guestFulfillmentStatus",
  "order.guestFulfillmentStatus.status",
  "order.context.guestOrderFulfillmentStatus",
  "order.context.guestOrderFulfillmentStatus.status",
  "order.context.guestFulfillmentStatus",
  "order.context.guestFulfillmentStatus.status",
];

function extractOrderMeta(order: ToastOrder, check: ToastCheck) {
  const strings: Record<string, string | null> = {};
  for (const [key, paths] of Object.entries(ORDER_META_STRINGS)) strings[key] = pickStringPaths(order, check, paths);
  const objects: Record<string, Record<string, unknown> | null> = {};
  for (const [key, paths] of Object.entries(ORDER_META_OBJECTS)) objects[key] = pickObjectPaths(order, check, paths);
  return {
    orderNumber: strings.orderNumber,
    timeDue: strings.timeDue,
    locationId: strings.locationId,
    status: strings.status,
    currency: strings.currency,
    customerName: strings.customerName,
    orderType: resolveOrderType(order, check),
    diningOptionGuid: strings.diningOptionGuid,
    deliveryState: strings.deliveryState,
    deliveryInfo: objects.deliveryInfo,
    curbsidePickupInfo: objects.curbsidePickupInfo,
    table: objects.table,
    employee: objects.employee,
    seats: collectSeats(order, check),
    promisedDate: strings.promisedDate,
    estimatedFulfillmentDate: strings.estimatedFulfillmentDate,
    checkId: pickStringPaths(order, check, ["check.guid", "check.id"]),
  };
}

function collectSeats(order: ToastOrder, check: ToastCheck): number[] {
  const seats = new Set<number>();
  for (const path of ORDER_SEAT_FIELDS) {
    const value = getValue(order, check, path);
    if (!Array.isArray(value)) continue;
    for (const seat of value) if (typeof seat === "number" && Number.isFinite(seat)) seats.add(seat);
  }
  return Array.from(seats).sort((a, b) => a - b);
}

interface RawModifier {
  id: string | null;
  name: string;
  groupName: string | null;
  priceCents: number;
  quantity: number;
  unitPriceCents: number | null;
}

function collectModifierDetails(
  selection: ToastSelection,
  menuIndex: ReturnType<typeof createMenuIndex>,
  parentQuantity: number
): { modifiers: ExpandedOrderItemModifier[]; totalCents: number } {
  const raw: RawModifier[] = [];
  const modifiers = Array.isArray((selection as any)?.modifiers) ? ((selection as any).modifiers as ToastSelection[]) : [];
  for (const modifier of modifiers) {
    if (!modifier) continue;
    const base = menuIndex.findModifier((modifier as any)?.item);
    const name = pickString([
      (base as any)?.kitchenName,
      (base as any)?.name,
      (modifier as any)?.displayName,
      (modifier as any)?.name,
      (modifier as any)?.item?.name,
      (modifier as any)?.item?.guid,
    ]) ?? "Unknown modifier";
    const groupName = pickString([
      (modifier as any)?.optionGroup?.name,
      (base as any)?.optionGroupName,
      (base as any)?.groupName,
      (base as any)?.menuOptionGroup?.name,
    ]);
    const id = pickString([(modifier as any)?.guid, (modifier as any)?.item?.guid, (base as any)?.guid]);
    const quantity = normalizeQuantity((modifier as any)?.quantity);
    const unitPrice = toCents(extractNumber(modifier as any, ["price", "receiptLinePrice"]));
    const totalPrice = unitPrice !== null ? unitPrice * quantity * parentQuantity : 0;
    raw.push({ id: id ?? null, name, groupName: groupName ?? null, priceCents: totalPrice, quantity, unitPriceCents: unitPrice });
    if (Array.isArray((modifier as any)?.modifiers) && (modifier as any).modifiers.length > 0) {
      const nested = collectModifierDetails(modifier as ToastSelection, menuIndex, parentQuantity * quantity);
      for (const entry of nested.modifiers) raw.push({ id: entry.id, name: entry.name, groupName: entry.groupName ?? null, priceCents: entry.priceCents, quantity: entry.quantity, unitPriceCents: null });
    }
  }
  const collapsed = collapseModifiers(raw).sort(compareModifiers);
  return { modifiers: collapsed, totalCents: collapsed.reduce((sum, mod) => sum + mod.priceCents, 0) };
}

function resolveItemTotal(baseTotal: number | null, modifiersTotal: number, explicitTotal: number | null): number | null {
  if (explicitTotal !== null && baseTotal !== null) return Math.max(explicitTotal, baseTotal + modifiersTotal);
  if (explicitTotal !== null) return explicitTotal;
  if (baseTotal !== null) return baseTotal + modifiersTotal;
  return modifiersTotal > 0 ? modifiersTotal : null;
}

function collapseModifiers(modifiers: RawModifier[]): ExpandedOrderItemModifier[] {
  const aggregated = new Map<string, RawModifier>();
  for (const modifier of modifiers) {
    const identifier = modifier.id ? `id:${modifier.id}` : `name:${modifier.name.toLowerCase()}`;
    const group = (modifier.groupName ?? "").toLowerCase();
    const unit = modifier.unitPriceCents ?? -1;
    const key = `${identifier}|${group}|${unit}`;
    const existing = aggregated.get(key);
    if (!existing) aggregated.set(key, { ...modifier });
    else {
      existing.quantity += modifier.quantity;
      existing.priceCents += modifier.priceCents;
      if ((!existing.groupName || existing.groupName.length === 0) && modifier.groupName) existing.groupName = modifier.groupName;
      if (!existing.id && modifier.id) existing.id = modifier.id;
    }
  }
  return Array.from(aggregated.values()).map((entry) => ({ id: entry.id ?? null, name: entry.name, groupName: entry.groupName, priceCents: entry.priceCents, quantity: entry.quantity }));
}

function compareModifiers(a: ExpandedOrderItemModifier, b: ExpandedOrderItemModifier): number {
  const groupA = (a.groupName ?? "").toLowerCase();
  const groupB = (b.groupName ?? "").toLowerCase();
  if (groupA !== groupB) return groupA < groupB ? -1 : 1;
  const nameA = a.name.toLowerCase();
  const nameB = b.name.toLowerCase();
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  return (a.id ?? "").localeCompare(b.id ?? "");
}

interface ItemSortMeta {
  displayOrder: number | null;
  createdTime: number | null;
  receiptPosition: number | null;
  selectionIndex: number | null;
  iteration: number;
  seatNumber: number | null;
  itemNameLower: string;
  menuItemId: string | null | undefined;
  lineItemId: string;
}

function buildItemSortMeta(
  selection: ToastSelection,
  itemName: string,
  menuItemId: string | null | undefined,
  lineItemId: string,
  iteration: number
): ItemSortMeta {
  return {
    displayOrder: extractNumber(selection as any, ["displaySequence", "displayOrder", "displayIndex", "displayPosition", "sequence", "sequenceNumber", "position", "context.displayOrder", "context.displaySequence"]),
    createdTime: extractTimestamp(selection as any, ["createdDate", "createdAt", "creationDate", "createdTime", "fireTime", "timestamp", "time"])?.ms ?? null,
    receiptPosition: extractNumber(selection as any, ["receiptLinePosition", "receiptLineIndex", "receiptPosition", "receiptIndex"]),
    selectionIndex: extractNumber(selection as any, ["selectionIndex"]),
    iteration,
    seatNumber: extractNumber(selection as any, ["seatNumber", "seat", "seatPosition", "seatNum", "context.seatNumber"]),
    itemNameLower: itemName.toLowerCase(),
    menuItemId,
    lineItemId,
  };
}

function sortItems(items: ExpandedOrderItem[], metas: ItemSortMeta[]): ExpandedOrderItem[] {
  return items
    .map((item, index) => ({ item, meta: metas[index] }))
    .sort((a, b) => compareItemMeta(a.meta, b.meta))
    .map((entry) => entry.item);
}

function compareItemMeta(a: ItemSortMeta, b: ItemSortMeta): number {
  for (const key of ["displayOrder", "createdTime", "receiptPosition", "selectionIndex"] as const) {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal !== null && bVal !== null && aVal !== bVal) return aVal - bVal;
    if (aVal !== null && bVal === null) return -1;
    if (aVal === null && bVal !== null) return 1;
  }
  if (a.iteration !== b.iteration) return a.iteration - b.iteration;
  if (a.seatNumber !== null || b.seatNumber !== null) {
    if (a.seatNumber !== null && b.seatNumber !== null && a.seatNumber !== b.seatNumber) return a.seatNumber - b.seatNumber;
    if (a.seatNumber !== null) return -1;
    if (b.seatNumber !== null) return 1;
  }
  if (a.itemNameLower !== b.itemNameLower) return a.itemNameLower < b.itemNameLower ? -1 : 1;
  const menuA = a.menuItemId ?? "";
  const menuB = b.menuItemId ?? "";
  if (menuA !== menuB) return menuA.localeCompare(menuB);
  return a.lineItemId.localeCompare(b.lineItemId);
}

function resolveFulfillmentStatus(
  order: ToastOrder,
  check: ToastCheck,
  hasItemStatus: boolean,
  anyNotReady: boolean,
  allReady: boolean
): string | null {
  const guest = pickStringPaths(order, check, GUEST_FULFILLMENT_FIELDS);
  if (guest) return guest;
  if (!hasItemStatus) return null;
  if (anyNotReady) return "IN_PREPARATION";
  if (allReady) return "READY_FOR_PICKUP";
  return null;
}

const DISALLOWED_SELECTION_TYPES = new Set(["SPECIAL_REQUEST", "NOTE", "TEXT", "FEE", "SURCHARGE", "SERVICE_CHARGE", "TIP", "TAX", "PAYMENT", "DEPOSIT"]);
const ALLOWED_SELECTION_TYPES = new Set(["MENU_ITEM", "ITEM", "STANDARD", "OPEN_ITEM", "CUSTOM_ITEM", "RETAIL_ITEM"]);
const DISALLOWED_ITEM_TYPES = new Set(["SPECIAL_REQUEST", "NOTE", "TEXT", "FEE", "SURCHARGE", "SERVICE_CHARGE", "TIP", "TAX"]);
const ALLOWED_ITEM_TYPES = new Set(["MENU_ITEM", "ITEM", "ENTREE", "PRODUCT", "OPEN_ITEM", "RETAIL", "RETAIL_ITEM", "BEVERAGE"]);

function isLineItem(selection: ToastSelection): boolean {
  const type = getSelectionType(selection);
  if (type && DISALLOWED_SELECTION_TYPES.has(type)) return false;
  const item = (selection as any)?.item;
  if (!item || typeof item !== "object") return false;
  const itemType = getItemType(selection);
  if (itemType && DISALLOWED_ITEM_TYPES.has(itemType)) return false;
  if (type && ALLOWED_SELECTION_TYPES.has(type)) return true;
  if (itemType && ALLOWED_ITEM_TYPES.has(itemType)) return true;
  const hasReference =
    (typeof item.guid === "string" && item.guid.trim()) ||
    (typeof item.guid === "number" && Number.isFinite(item.guid)) ||
    item.multiLocationId !== undefined ||
    item.referenceId !== undefined;
  if (hasReference) return true;
  return extractNumber(selection as any, ["receiptLinePrice", "price"]) !== null;
}

function getSelectionType(selection: ToastSelection): string {
  const raw = (selection as any)?.selectionType ?? selection.selectionType;
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "_") : "";
}

function getItemType(selection: ToastSelection): string {
  const raw = (selection as any)?.item?.itemType ?? (selection as any)?.item?.type;
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "_") : "";
}

function getSpecialRequest(selection: ToastSelection, itemName: string): string | null {
  if (getSelectionType(selection) !== "SPECIAL_REQUEST") return null;
  const display = pickString([(selection as any)?.displayName]);
  return display && display !== itemName ? display : null;
}

function resolveOrderType(order: ToastOrder, check: ToastCheck): OrderType {
  if ((order as any)?.context?.curbsidePickupInfo || (check as any)?.curbsidePickupInfo) return "CURBSIDE";
  if ((order as any)?.isDriveThru === true || (check as any)?.isDriveThru === true) return "DRIVE_THRU";
  if ((order as any)?.isDelivery === true || (check as any)?.isDelivery === true) return "DELIVERY";
  if ((order as any)?.isCatering === true || (check as any)?.isCatering === true) return "CATERING";
  for (const path of ORDER_TYPE_FIELDS) {
    const value = getValue(order, check, path);
    const normalized = normalizeOrderType(value);
    if (normalized) return normalized;
  }
  return "UNKNOWN";
}

function normalizeOrderType(value: unknown): OrderType | null {
  if (!value) return null;
  if (typeof value === "object") {
    const candidate = (value as any)?.type ?? (value as any)?.name;
    return typeof candidate === "string" ? normalizeOrderType(candidate) : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const map: Record<string, OrderType> = {
    TAKEOUT: "TAKEOUT",
    TAKE_OUT: "TAKEOUT",
    TAKEAWAY: "TAKEOUT",
    TAKE_AWAY: "TAKEOUT",
    PICKUP: "TAKEOUT",
    PICK_UP: "TAKEOUT",
    PICKUP_ORDER: "TAKEOUT",
    PICK_UP_ORDER: "TAKEOUT",
    TOGO: "TAKEOUT",
    TO_GO: "TAKEOUT",
    DINE_IN: "DINE_IN",
    DINEIN: "DINE_IN",
    ON_PREMISE: "DINE_IN",
    ONPREMISE: "DINE_IN",
    EAT_IN: "DINE_IN",
    CURBSIDE: "CURBSIDE",
    CURB_SIDE: "CURBSIDE",
    CURBSIDE_PICKUP: "CURBSIDE",
    DRIVE_THRU: "DRIVE_THRU",
    DRIVETHRU: "DRIVE_THRU",
    DRIVE_THROUGH: "DRIVE_THRU",
    CATERING: "CATERING",
    DELIVERY: "DELIVERY",
    DELIVER: "DELIVERY",
  };
  if (map[normalized]) return map[normalized];
  if (normalized.includes("CURBSIDE")) return "CURBSIDE";
  if (normalized.includes("DRIVE")) return "DRIVE_THRU";
  if (normalized.includes("CATER")) return "CATERING";
  if (normalized.includes("DELIVER")) return "DELIVERY";
  if (normalized.includes("DINE") || normalized.includes("EAT_IN") || normalized.includes("EATIN") || normalized.includes("ON_PREMISE")) return "DINE_IN";
  if (normalized.includes("TAKE") || normalized.includes("PICKUP") || normalized.includes("TOGO") || normalized.includes("TO_GO")) return "TAKEOUT";
  return null;
}

function compareOrders(a: number | null, b: number | null, orderA: string, orderB: string, checkA: string | null, checkB: string | null): number {
  if (a !== null && b !== null && a !== b) return b - a;
  if (a !== null && b === null) return -1;
  if (a === null && b !== null) return 1;
  if (orderA !== orderB) return orderA.localeCompare(orderB);
  return (checkA ?? "").localeCompare(checkB ?? "");
}

function resolveLineItemId(orderId: string, checkId: string | null, selection: ToastSelection, index: number): string | null {
  if (typeof selection.guid === "string" && selection.guid.trim()) return selection.guid;
  const itemGuid = pickString([(selection as any)?.item?.guid]);
  if (itemGuid) return `${orderId}:${checkId ?? ""}:item:${itemGuid}:${index}`;
  const receipt = extractNumber(selection as any, ["receiptLinePosition"]);
  if (receipt !== null) return `${orderId}:${checkId ?? ""}:receipt:${receipt}`;
  return `${orderId}:${checkId ?? ""}:open:${index}`;
}

function createMenuIndex(document: ToastMenusDocument | null) {
  const itemsByGuid = new Map<string, ToastMenuItem>();
  const itemsByMulti = new Map<string, ToastMenuItem>();
  const itemsByRef = new Map<string | number, ToastMenuItem>();
  const modifiersByGuid = new Map<string, ToastModifierOption>();
  const modifiersByMulti = new Map<string, ToastModifierOption>();
  const modifiersByRef = new Map<string | number, ToastModifierOption>();

  if (document) {
    for (const modifier of Object.values(document.modifierOptionReferences ?? {})) {
      const any = modifier as any;
      if (typeof any?.guid === "string") modifiersByGuid.set(any.guid, modifier as ToastModifierOption);
      if (any?.multiLocationId !== undefined) modifiersByMulti.set(String(any.multiLocationId), modifier as ToastModifierOption);
      if (any?.referenceId !== undefined && any.referenceId !== null) modifiersByRef.set(any.referenceId, modifier as ToastModifierOption);
    }

    const stack: any[] = [];
    for (const menu of document.menus ?? []) for (const group of menu.menuGroups ?? []) stack.push(group);
    while (stack.length > 0) {
      const group = stack.pop();
      if (!group) continue;
      for (const item of group.items ?? []) {
        const any = item as any;
        if (typeof any?.guid === "string") itemsByGuid.set(any.guid, item as ToastMenuItem);
        if (any?.multiLocationId !== undefined) itemsByMulti.set(String(any.multiLocationId), item as ToastMenuItem);
        if (any?.referenceId !== undefined && any.referenceId !== null) itemsByRef.set(any.referenceId, item as ToastMenuItem);
      }
      for (const child of group.menuGroups ?? []) stack.push(child);
    }
  }

  return {
    findItem(reference: ToastSelection["item"]): ToastMenuItem | undefined {
      if (!reference) return undefined;
      if (reference.guid && itemsByGuid.has(reference.guid)) return itemsByGuid.get(reference.guid);
      const multi = (reference as any)?.multiLocationId;
      if (multi !== undefined && itemsByMulti.has(String(multi))) return itemsByMulti.get(String(multi));
      const refId = (reference as any)?.referenceId;
      if (refId !== undefined && refId !== null && itemsByRef.has(refId)) return itemsByRef.get(refId);
      return undefined;
    },
    findModifier(reference: ToastSelection["item"]): ToastModifierOption | undefined {
      if (!reference) return undefined;
      if (reference.guid && modifiersByGuid.has(reference.guid)) return modifiersByGuid.get(reference.guid);
      const multi = (reference as any)?.multiLocationId;
      if (multi !== undefined && modifiersByMulti.has(String(multi))) return modifiersByMulti.get(String(multi));
      const refId = (reference as any)?.referenceId;
      if (refId !== undefined && refId !== null && modifiersByRef.has(refId)) return modifiersByRef.get(refId);
      return undefined;
    },
  };
}

function pickString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickStringPaths(order: ToastOrder, check: ToastCheck, paths: string[]): string | null {
  for (const path of paths) {
    const value = getValue(order, check, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickObjectPaths(order: ToastOrder, check: ToastCheck, paths: string[]): Record<string, unknown> | null {
  for (const path of paths) {
    const value = getValue(order, check, path);
    if (value && typeof value === "object") return value as Record<string, unknown>;
  }
  return null;
}

function getValue(order: ToastOrder, check: ToastCheck, path: string): any {
  const [root, ...rest] = path.split(".");
  const source = root === "order" ? (order as any) : root === "check" ? (check as any) : undefined;
  if (!source) return undefined;
  let current = source;
  for (const part of rest) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function sumAmounts(collection: unknown, fields: string[]): number {
  if (!Array.isArray(collection)) return 0;
  let total = 0;
  for (const entry of collection) {
    const cents = toCents(extractNumber(entry as any, fields));
    if (cents !== null) total += Math.max(cents, 0);
  }
  return total;
}

function extractNumber(source: any, fields: string[]): number | null {
  for (const field of fields) {
    const value = getNestedValue(source, field);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function extractTimestamp(source: any, fields: string[]): { iso: string; ms: number | null } | null {
  for (const field of fields) {
    const value = getNestedValue(source, field);
    if (typeof value === "string" && value) {
      const parsed = parseToastTimestamp(value);
      if (parsed !== null) return { iso: value, ms: parsed };
    }
  }
  return null;
}

function getNestedValue(source: any, path: string): unknown {
  if (!source) return undefined;
  if (!path.includes(".")) return source[path];
  let current = source;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function normalizeQuantity(quantity: unknown): number {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) return 1;
  return Math.max(1, Math.round(quantity));
}

function normalizeItemFulfillmentStatus(value: unknown): ItemFulfillmentStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized === "NEW" || normalized === "HOLD" || normalized === "SENT" || normalized === "READY"
    ? (normalized as ItemFulfillmentStatus)
    : null;
}

function parseToastTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function toCents(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

function isVoided(entity: unknown): boolean {
  return Boolean((entity as any)?.voided || (entity as any)?.deleted);
}

function extractErrorMessage(response: OrdersLatestResponse | MenusResponse | null): string | null {
  if (!response) return null;
  if (typeof response === "string") return response;
  const error = (response as any)?.error;
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
