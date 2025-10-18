import type { ToastCheck, ToastOrder, ToastSelection } from "../../types/toast-orders.js";
import type { ToastMenusDocument } from "../../types/toast-menus.js";
import type { MenuIndex } from "./menu-index.js";
import { createMenuIndex } from "./menu-index.js";
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
} from "./extractors.js";
import {
  normalizeItemFulfillmentStatus,
  resolveFulfillmentStatus,
  isLineItem,
} from "./fulfillment.js";
import { collectModifierDetails, resolveItemTotal, sumAmounts, toCents } from "./money.js";
import { buildItemSortMeta, sortItems } from "./sort.js";
import type {
  DiagnosticsCounters,
  ExpandedOrder,
  ExpandedOrderItem,
  ExpandedOrderItemMoney,
  ItemSortMeta,
  OrdersLatestResponse,
} from "./types-local.js";

interface BuildArgs {
  ordersPayload: OrdersLatestResponse & { ok: true };
  menuDocument: ToastMenusDocument | null;
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

  const menuIndex = createMenuIndex(args.menuDocument ?? null);
  const deadline = args.startedAt + args.timeBudgetMs;
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

export function extractOrders(payload: OrdersLatestResponse & { ok: true }): ToastOrder[] {
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray((payload as any).orders)) return (payload as any).orders as ToastOrder[];
  return [];
}

function buildOrderFromCheck(
  order: ToastOrder,
  check: ToastCheck,
  orderTime: { iso: string; ms: number | null },
  menuIndex: MenuIndex,
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
