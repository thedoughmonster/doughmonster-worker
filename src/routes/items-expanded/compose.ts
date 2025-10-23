import type { ToastCheck, ToastOrder, ToastSelection } from "../../types/toast-orders.js";
import type { ToastMenusDocument } from "../../types/toast-menus.js";
import type { MenuIndex } from "../orders-detailed/menu-index.js";
import { getCachedMenuIndex } from "../orders-detailed/menu-index.js";
import {
  extractOrderMeta,
  extractTimestamp,
  extractNumber,
  getSpecialRequest,
  isVoided,
  normalizeQuantity,
  pickString,
  pickStringPaths,
  resolveLineItemId,
} from "../orders-detailed/extractors.js";
import {
  normalizeItemFulfillmentStatus,
  resolveFulfillmentStatus,
  isLineItem,
} from "../orders-detailed/fulfillment.js";
import { collectModifierDetails, resolveItemTotal, sumAmounts, toCents } from "../orders-detailed/money.js";
import { buildItemSortMeta, sortItems } from "../orders-detailed/sort.js";
import type {
  DiagnosticsCounters,
  ExpandedOrder,
  ExpandedOrderItem,
  ExpandedOrderItemMoney,
  ItemSortMeta,
  OrdersLatestSuccessResponse,
} from "../orders-detailed/types-local.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_ENTRIES = 250;

interface CacheEntry {
  fingerprint: string;
  menuVersion: string | null;
  storedAt: number;
  order: ExpandedOrder;
}

interface CacheStats {
  hits: number;
  misses: number;
}

const EXPANDED_ORDER_CACHE = new Map<string, CacheEntry>();
const CACHE_STATS: CacheStats = { hits: 0, misses: 0 };

function toOrderCacheKey(orderId: string, checkId: string | null): string {
  return `${orderId}::${checkId ?? ""}`;
}

function deepClone<T>(value: T): T {
  const impl: typeof structuredClone | undefined = (globalThis as any)?.structuredClone;
  if (typeof impl === "function") {
    return impl(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function pruneExpiredEntries(now: number) {
  for (const [key, entry] of EXPANDED_ORDER_CACHE.entries()) {
    if (now - entry.storedAt > CACHE_TTL_MS) {
      EXPANDED_ORDER_CACHE.delete(key);
    }
  }
}

function enforceSizeLimit() {
  if (EXPANDED_ORDER_CACHE.size <= CACHE_MAX_ENTRIES) return;
  const iterator = EXPANDED_ORDER_CACHE.keys();
  while (EXPANDED_ORDER_CACHE.size > CACHE_MAX_ENTRIES) {
    const next = iterator.next();
    if (next.done) break;
    EXPANDED_ORDER_CACHE.delete(next.value);
  }
}

function tryReadFromCache(
  cacheKey: string,
  fingerprint: string,
  menuVersion: string | null,
  now: number
): ExpandedOrder | null {
  const entry = EXPANDED_ORDER_CACHE.get(cacheKey);
  if (!entry) return null;
  if (now - entry.storedAt > CACHE_TTL_MS) {
    EXPANDED_ORDER_CACHE.delete(cacheKey);
    return null;
  }
  if (entry.fingerprint !== fingerprint || entry.menuVersion !== menuVersion) {
    return null;
  }
  CACHE_STATS.hits += 1;
  return deepClone(entry.order);
}

function writeCacheEntry(
  cacheKey: string,
  fingerprint: string,
  menuVersion: string | null,
  order: ExpandedOrder,
  now: number
) {
  pruneExpiredEntries(now);
  if (EXPANDED_ORDER_CACHE.size >= CACHE_MAX_ENTRIES) enforceSizeLimit();
  const cachedOrder = deepClone(order);
  EXPANDED_ORDER_CACHE.set(cacheKey, { fingerprint, menuVersion, storedAt: now, order: cachedOrder });
  CACHE_STATS.misses += 1;
}

function computeSelectionsDigest(
  selections: ToastSelection[],
  orderId: string,
  checkId: string | null
): string {
  const parts: string[] = [];
  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index] as any;
    if (!selection || typeof selection !== "object") {
      parts.push("invalid");
      continue;
    }
    const voided = isVoided(selection);
    const isRenderable = isLineItem(selection);
    const lineItemId = isRenderable ? resolveLineItemId(orderId, checkId, selection, index) : null;
    const quantity = normalizeQuantity(selection?.quantity);
    const receiptLinePrice = extractNumber(selection as any, ["receiptLinePrice", "price"]);
    const explicitTotal = toCents(selection?.price);
    const selectionDiscount = sumAmounts(selection?.appliedDiscounts, ["discountAmount", "amount", "value"]);
    const fulfillment = normalizeItemFulfillmentStatus(selection?.fulfillmentStatus) ?? "";
    const baseId = typeof selection?.guid === "string" ? selection.guid : "";
    const itemGuid = typeof selection?.item?.guid === "string" ? selection.item.guid : "";
    const modifiersDigest = Array.isArray((selection as any)?.modifiers)
      ? String((selection as any).modifiers.length)
      : "0";
    parts.push(
      [
        baseId,
        itemGuid,
        lineItemId ?? "",
        voided ? "voided" : "active",
        isRenderable ? "line" : "other",
        quantity,
        receiptLinePrice !== null ? receiptLinePrice : "",
        explicitTotal !== null ? explicitTotal : "",
        selectionDiscount,
        fulfillment,
        modifiersDigest,
      ].join(":")
    );
  }
  return parts.join("|");
}

function computeCheckFingerprint(
  orderId: string,
  checkId: string | null,
  check: ToastCheck
): string {
  const selections = Array.isArray((check as any)?.selections)
    ? ((check as any).selections as ToastSelection[])
    : [];
  const digest = computeSelectionsDigest(selections, orderId, checkId);
  const serviceChargeCents = sumAmounts((check as any)?.appliedServiceCharges, ["chargeAmount", "amount"]);
  const tipCents = sumAmounts((check as any)?.payments, ["tipAmount", "tip", "gratuity"]);
  const checkDiscount = sumAmounts((check as any)?.appliedDiscounts, ["discountAmount", "amount", "value"]);
  const lastModified = typeof (check as any)?.lastModifiedDate === "string" ? (check as any).lastModifiedDate : "";
  const version =
    typeof (check as any)?.version === "string" || typeof (check as any)?.version === "number"
      ? String((check as any).version)
      : "";
  return [lastModified, version, serviceChargeCents, tipCents, checkDiscount, digest].join("::");
}

interface BuildArgs {
  ordersPayload: OrdersLatestSuccessResponse;
  menuDocument: ToastMenusDocument | null;
  menuUpdatedAt: string | null;
  limit: number;
  startedAt: number;
  timeBudgetMs: number;
}

export function buildExpandedOrders(args: BuildArgs): {
  orders: ExpandedOrder[];
  diagnostics: DiagnosticsCounters;
  timedOut: boolean;
} {
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

  const menuIndex = getCachedMenuIndex(args.menuDocument ?? null, args.menuUpdatedAt ?? null);
  const deadline = args.startedAt + args.timeBudgetMs;
  const orders = extractOrders(args.ordersPayload);
  const candidates: Array<{
    order: ToastOrder;
    check: ToastCheck;
    orderTime: { iso: string; ms: number | null };
    orderId: string;
    checkId: string | null;
    hasRenderableSelections: boolean;
  }> = [];
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

    const orderTime = extractTimestamp(order, ["createdDate", "openedDate", "promisedDate", "estimatedFulfillmentDate", "readyDate"]);
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

      const orderId = pickStringPaths(order, check, ["order.guid", "order.id"]);
      if (!orderId) continue;

      const checkId = pickStringPaths(order, check, ["check.guid", "check.id"]);

      const selections = Array.isArray((check as any)?.selections) ? ((check as any).selections as ToastSelection[]) : [];
      let hasRenderableSelections = false;
      for (let index = 0; index < selections.length; index += 1) {
        const selection = selections[index];
        if (!selection || typeof selection !== "object") continue;
        if (isVoided(selection)) continue;
        if (!isLineItem(selection)) continue;
        const lineItemId = resolveLineItemId(orderId, checkId ?? null, selection, index);
        if (!lineItemId) continue;
        hasRenderableSelections = true;
        break;
      }

      candidates.push({
        order,
        check,
        orderTime,
        orderId,
        checkId: checkId ?? null,
        hasRenderableSelections,
      });
    }
  }

  const sortedCandidates = candidates.sort((a, b) =>
    compareOrders(
      a.orderTime.ms,
      b.orderTime.ms,
      a.orderId,
      b.orderId,
      a.checkId,
      b.checkId
    )
  );

  const prioritizedCandidates: typeof candidates = [];
  const fallbackCandidates: typeof candidates = [];

  for (const candidate of sortedCandidates) {
    if (candidate.hasRenderableSelections && prioritizedCandidates.length < args.limit) {
      prioritizedCandidates.push(candidate);
      continue;
    }
    fallbackCandidates.push(candidate);
  }

  const candidateQueue = prioritizedCandidates.slice(0, args.limit);
  let fallbackIndex = 0;

  while (candidateQueue.length < args.limit && fallbackIndex < fallbackCandidates.length) {
    candidateQueue.push(fallbackCandidates[fallbackIndex]);
    fallbackIndex += 1;
  }

  const builtOrders: ExpandedOrder[] = [];

  for (let queueIndex = 0; queueIndex < candidateQueue.length; queueIndex += 1) {
    const candidate = candidateQueue[queueIndex];
    if (builtOrders.length >= args.limit) break;
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }

    const built = buildOrderFromCheck(
      candidate.order,
      candidate.check,
      candidate.orderTime,
      args.menuUpdatedAt ?? null,
      menuIndex,
      diagnostics
    );
    if (!built) {
      if (fallbackIndex < fallbackCandidates.length) {
        candidateQueue.push(fallbackCandidates[fallbackIndex]);
        fallbackIndex += 1;
      }
      continue;
    }

    diagnostics.itemsIncluded += built.order.items.length;
    diagnostics.totals.baseItemsSubtotalCents += built.order.totals.baseItemsSubtotalCents;
    diagnostics.totals.modifiersSubtotalCents += built.order.totals.modifiersSubtotalCents;
    diagnostics.totals.discountTotalCents += built.order.totals.discountTotalCents;
    diagnostics.totals.serviceChargeCents += built.order.totals.serviceChargeCents;
    diagnostics.totals.tipCents += built.order.totals.tipCents;
    diagnostics.totals.grandTotalCents += built.order.totals.grandTotalCents;

    builtOrders.push(built.order);
  }

  return { orders: builtOrders, diagnostics, timedOut };
}

export function extractOrders(payload: OrdersLatestSuccessResponse): ToastOrder[] {
  if (Array.isArray(payload.data)) {
    return payload.data.filter((order): order is ToastOrder => Boolean(order) && typeof order === "object");
  }
  if (Array.isArray(payload.orders)) {
    return (payload.orders as unknown[]).filter(
      (order): order is ToastOrder => Boolean(order) && typeof order === "object"
    );
  }
  return [];
}

function buildOrderFromCheck(
  order: ToastOrder,
  check: ToastCheck,
  orderTime: { iso: string; ms: number | null },
  menuVersion: string | null,
  menuIndex: MenuIndex,
  diagnostics: DiagnosticsCounters
): { order: ExpandedOrder; timeMs: number | null } | null {
  const orderId = pickStringPaths(order, check, ["order.guid", "order.id"]);
  if (!orderId) return null;

  const meta = extractOrderMeta(order, check);
  const checkId = meta.checkId;

  const cacheKey = toOrderCacheKey(orderId, checkId ?? null);
  const now = Date.now();
  const fingerprint = computeCheckFingerprint(orderId, checkId ?? null, check);
  const cachedOrder = tryReadFromCache(cacheKey, fingerprint, menuVersion, now);
  if (cachedOrder) {
    return { order: cachedOrder, timeMs: orderTime.ms };
  }

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
    const selection = selections[index] as any;
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
    const itemName =
      pickString([
        (menuItem as any)?.kitchenName,
        (menuItem as any)?.name,
        selection?.displayName,
        selection?.name,
        selection?.item?.name,
        selection?.item?.kitchenName,
        selection?.item?.guid,
      ]) ?? "Unknown item";
    const menuItemId = pickString([selection?.item?.guid]);
    const quantity = normalizeQuantity(selection?.quantity);

    const modifierDetails = collectModifierDetails(selection, menuIndex, quantity);
    modifierSubtotal += modifierDetails.totalCents;

    const unitPrice = extractNumber(selection as any, ["receiptLinePrice", "price"]);
    const baseEachCents = unitPrice !== null ? toCents(unitPrice) : null;
    const baseTotalCents = baseEachCents !== null ? baseEachCents * quantity : null;
    if (baseTotalCents !== null) baseSubtotal += baseTotalCents;

    const explicitTotal = toCents(selection?.price);
    const totalCents = resolveItemTotal(baseTotalCents, modifierDetails.totalCents, explicitTotal);
    if (totalCents !== null && baseTotalCents === null) baseSubtotal += Math.max(totalCents - modifierDetails.totalCents, 0);

    const selectionDiscount = sumAmounts(selection?.appliedDiscounts, ["discountAmount", "amount", "value"]);
    if (selectionDiscount > 0) discountTotal += selectionDiscount;

    const fulfillment = normalizeItemFulfillmentStatus(selection?.fulfillmentStatus);
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

    const specialInstructions = pickString([selection?.specialInstructions, getSpecialRequest(selection, itemName)]);
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

  if (meta.orderTypeNormalized) {
    orderData.orderTypeNormalized = meta.orderTypeNormalized;
  }

  if (meta.deliveryState) orderData.deliveryState = meta.deliveryState;
  if (meta.deliveryInfo) orderData.deliveryInfo = meta.deliveryInfo;
  if (meta.curbsidePickupInfo) orderData.curbsidePickupInfo = meta.curbsidePickupInfo;
  if (meta.table) orderData.table = meta.table;
  if (meta.seats.length > 0) orderData.seats = meta.seats;
  if (meta.employee) orderData.employee = meta.employee;
  if (meta.promisedDate) orderData.promisedDate = meta.promisedDate;
  if (meta.estimatedFulfillmentDate) orderData.estimatedFulfillmentDate = meta.estimatedFulfillmentDate;

  const orderResult: { order: ExpandedOrder; timeMs: number | null } = {
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

  writeCacheEntry(cacheKey, fingerprint, menuVersion, orderResult.order, now);

  return orderResult;
}

function compareOrders(
  a: number | null,
  b: number | null,
  orderA: string,
  orderB: string,
  checkA: string | null,
  checkB: string | null
): number {
  if (a !== null && b !== null && a !== b) return b - a;
  if (a !== null && b === null) return -1;
  if (a === null && b !== null) return 1;
  if (orderA !== orderB) return orderA.localeCompare(orderB);
  return (checkA ?? "").localeCompare(checkB ?? "");
}

export const __private = {
  resetOrderCacheForTests() {
    EXPANDED_ORDER_CACHE.clear();
    CACHE_STATS.hits = 0;
    CACHE_STATS.misses = 0;
  },
  getOrderCacheStats() {
    return {
      hits: CACHE_STATS.hits,
      misses: CACHE_STATS.misses,
      size: EXPANDED_ORDER_CACHE.size,
    };
  },
};
