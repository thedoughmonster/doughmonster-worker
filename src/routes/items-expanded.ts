import type { AppEnv } from "../config/env.js";
import { getOrdersBulk, getPublishedMenus } from "../clients/toast.js";
import { jsonResponse } from "../lib/http.js";
import type { ToastMenuItem, ToastMenusDocument, ToastModifierOption } from "../types/toast-menus.js";
import type { ToastCheck, ToastOrder, ToastSelection } from "../types/toast-orders.js";

const DEFAULT_RANGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 500;
const PAGE_SIZE = 100;

export interface ItemsExpandedDeps {
  getOrdersBulk: typeof getOrdersBulk;
  getPublishedMenus: typeof getPublishedMenus;
}

export interface OrderItemModifier {
  id: string | null;
  name: string;
  groupName?: string | null;
  priceCents: number;
  quantity: number;
}

export interface OrderItemMoney {
  baseItemPriceCents?: number;
  modifierTotalCents?: number;
  totalItemPriceCents?: number;
}

export interface ExpandedOrderItem {
  lineItemId: string;
  menuItemId?: string | null;
  itemName: string;
  quantity: number;
  modifiers: OrderItemModifier[];
  specialInstructions?: string | null;
  money?: OrderItemMoney;
}

export type OrderType =
  | "TAKEOUT"
  | "DELIVERY"
  | "DINE_IN"
  | "CURBSIDE"
  | "DRIVE_THRU"
  | "CATERING"
  | "UNKNOWN";

export interface ExpandedOrder {
  orderId: string;
  orderNumber?: string | null;
  checkId?: string | null;
  status?: string | null;
  currency?: string | null;
  customerName?: string | null;
  orderType: OrderType;
  location: { locationId?: string | null };
  times: { orderTime: string; timeDue?: string | null };
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

interface OrderAccumulator {
  key: string;
  orderId: string;
  orderNumber: string | null;
  checkId: string | null;
  status: string | null;
  currency: string | null;
  customerName: string | null;
  orderType: OrderType;
  locationId: string | null;
  orderTime: string;
  orderTimeMs: number | null;
  timeDue: string | null;
  items: ExpandedOrderItem[];
  baseItemsSubtotalCents: number;
  modifiersSubtotalCents: number;
  discountTotalCents: number;
  serviceChargeCents: number;
  tipCents: number;
  checkTotalsHydrated: boolean;
}

export function createItemsExpandedHandler(
  deps: ItemsExpandedDeps = { getOrdersBulk, getPublishedMenus }
) {
  return async function handleItemsExpanded(env: AppEnv, request: Request): Promise<Response> {
    const url = new URL(request.url);

    const now = new Date();
    const endParam = url.searchParams.get("end");
    const startParam = url.searchParams.get("start");
    const statusParam = url.searchParams.get("status");
    const locationParam = url.searchParams.get("locationId");
    const limitParam = url.searchParams.get("limit");

    const parsedEnd = parseDateParam(endParam) ?? now;
    const parsedStart = parseDateParam(startParam) ?? new Date(parsedEnd.getTime() - DEFAULT_RANGE_MS);

    if (!(parsedStart instanceof Date) || isNaN(parsedStart.getTime())) {
      return errorResponse(400, "Invalid start parameter");
    }

    if (!(parsedEnd instanceof Date) || isNaN(parsedEnd.getTime())) {
      return errorResponse(400, "Invalid end parameter");
    }

    if (parsedStart.getTime() >= parsedEnd.getTime()) {
      return errorResponse(400, "start must be before end");
    }

    const limit = clampNumber(
      Number.isFinite(Number(limitParam)) ? Number(limitParam) : DEFAULT_LIMIT,
      1,
      MAX_LIMIT
    );

    const startIso = toToastIsoUtc(parsedStart);
    const endIso = toToastIsoUtc(parsedEnd);

    try {
      const menuDoc = await deps.getPublishedMenus(env);
      const menuIndex = createMenuIndex(menuDoc);

      const aggregates = new Map<string, OrderAccumulator>();
      let page = 1;

      while (true) {
        const { orders, nextPage } = await deps.getOrdersBulk(env, {
          startIso,
          endIso,
          page,
          pageSize: PAGE_SIZE,
        });

        if (!Array.isArray(orders) || orders.length === 0) {
          break;
        }

        for (const order of orders) {
          if (!order || typeof order.guid !== "string") {
            continue;
          }

          if (!orderMatches(order, locationParam, statusParam)) {
            continue;
          }

          const orderTime = extractOrderTime(order);
          if (!orderTime) {
            continue;
          }

          const orderTimeMs = parseToastTimestamp(orderTime);
          const timeDue = extractOrderDueTime(order);
          const orderNumber = extractOrderNumber(order);
          const locationId = extractOrderLocation(order);
          const orderStatus = extractOrderStatus(order);
          const orderCurrency = extractOrderCurrency(order);

          const checks = Array.isArray(order.checks) ? order.checks : [];
          for (const check of checks) {
            if (!check || typeof check.guid !== "string") {
              continue;
            }

            if ((check as any)?.deleted) {
              continue;
            }

            const customerName = extractCustomerName(order, check);
            const orderType = extractOrderType(order, check);
            const key = `${order.guid}:${check.guid}`;
            const accumulator = getOrCreateAccumulator(aggregates, key, {
              orderId: order.guid,
              orderNumber,
              checkId: check.guid ?? null,
              status: orderStatus,
              currency: orderCurrency,
              customerName,
              orderType,
              locationId,
              orderTime,
              orderTimeMs,
              timeDue,
            });

            updateAccumulatorMeta(accumulator, {
              orderNumber,
              status: orderStatus,
              currency: orderCurrency,
              customerName,
              orderType,
              locationId,
              orderTime,
              orderTimeMs,
              timeDue,
            });

            const selections = Array.isArray(check.selections) ? check.selections : [];
            for (const selection of selections) {
              if (!selection || typeof selection.guid !== "string") {
                continue;
              }

              if (!isLineItem(selection)) {
                continue;
              }

              if (isSelectionVoided(selection)) {
                continue;
              }

              const menuItem = menuIndex.findItem(selection.item);
              const itemName =
                getKitchenTicketName(menuItem) ??
                getSelectionDisplayName(selection) ??
                selection.item?.guid ??
                "Unknown item";

              const menuItemId = selection.item?.guid ?? null;
              const quantity = normalizeQuantity(selection.quantity);
              const modifierDetails = collectModifierDetails(selection, menuIndex, quantity);
              const specialInstructions = extractSpecialInstructions(selection, itemName);
              const unitPrice = extractReceiptLinePrice(selection);
              const baseEachCents = unitPrice !== null ? toCents(unitPrice) : null;
              const baseTotalCents = baseEachCents !== null ? baseEachCents * quantity : null;
              const totalItemPriceCents = toCents((selection as any)?.price);
              const computedTotal =
                baseTotalCents !== null
                  ? baseTotalCents + modifierDetails.totalCents
                  : modifierDetails.totalCents !== 0
                  ? modifierDetails.totalCents
                  : null;
              let resolvedTotal: number | null = null;
              if (totalItemPriceCents !== null && computedTotal !== null) {
                resolvedTotal = Math.max(totalItemPriceCents, computedTotal);
              } else {
                resolvedTotal = totalItemPriceCents ?? computedTotal ?? baseTotalCents;
              }
              let resolvedBase = baseTotalCents;
              if (resolvedBase === null && resolvedTotal !== null) {
                resolvedBase = Math.max(resolvedTotal - modifierDetails.totalCents, 0);
              }
              if (resolvedBase !== null) {
                resolvedBase = Math.max(resolvedBase, 0);
              }

              const money: OrderItemMoney = {};
              if (resolvedBase !== null) {
                money.baseItemPriceCents = resolvedBase;
              }
              if (modifierDetails.totalCents !== 0) {
                money.modifierTotalCents = modifierDetails.totalCents;
              }
              if (resolvedTotal !== null) {
                resolvedTotal = Math.max(resolvedTotal, 0);
                money.totalItemPriceCents = resolvedTotal;
              }

              const item: ExpandedOrderItem = {
                lineItemId: selection.guid,
                menuItemId,
                itemName,
                quantity,
                modifiers: modifierDetails.modifiers,
              };

              if (specialInstructions) {
                item.specialInstructions = specialInstructions;
              }

              if (Object.keys(money).length > 0) {
                item.money = money;
              }

              accumulator.items.push(item);

              if (resolvedBase !== null) {
                accumulator.baseItemsSubtotalCents += resolvedBase;
              }

              if (modifierDetails.totalCents !== 0) {
                accumulator.modifiersSubtotalCents += modifierDetails.totalCents;
              }

              const selectionDiscountCents = sumDiscountAmounts((selection as any)?.appliedDiscounts);
              if (selectionDiscountCents > 0) {
                accumulator.discountTotalCents += selectionDiscountCents;
              }
            }

            if (!accumulator.checkTotalsHydrated) {
              const checkDiscountCents = sumDiscountAmounts((check as any)?.appliedDiscounts);
              if (checkDiscountCents > 0) {
                accumulator.discountTotalCents += checkDiscountCents;
              }

              const serviceChargeCents = sumServiceCharges((check as any)?.appliedServiceCharges);
              if (serviceChargeCents > 0) {
                accumulator.serviceChargeCents += serviceChargeCents;
              }

              const tipCents = sumTipAmounts((check as any)?.payments);
              if (tipCents > 0) {
                accumulator.tipCents += tipCents;
              }

              accumulator.checkTotalsHydrated = true;
            }
          }
        }

        const hasMore =
          (typeof nextPage === "number" && nextPage > page) || orders.length === PAGE_SIZE;

        if (!hasMore) {
          break;
        }

        const next = typeof nextPage === "number" && nextPage > page ? nextPage : page + 1;
        if (next === page) {
          break;
        }
        page = next;
      }

      const ordered = Array.from(aggregates.values())
        .filter((entry) => entry.items.length > 0 || hasNonZeroTotals(entry))
        .sort(compareAggregatedOrdersByOrderTime);

      const limited =
        ordered.length > limit ? ordered.slice(Math.max(ordered.length - limit, 0)) : ordered;

      const ordersResponse = limited.map((entry) => toExpandedOrder(entry));

      return jsonResponse({ orders: ordersResponse });
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 500;
      const code = typeof err?.code === "string" ? err.code : status === 500 ? "INTERNAL_ERROR" : "ERROR";
      const message =
        typeof err?.message === "string"
          ? err.message
          : typeof err?.bodySnippet === "string"
          ? err.bodySnippet
          : "Unexpected error";

      return errorResponse(status, message, code);
    }
  };
}

export default createItemsExpandedHandler();

function parseDateParam(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
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

function errorResponse(status: number, message: string, code = "BAD_REQUEST"): Response {
  return jsonResponse({ error: { message, code } }, { status });
}

function createMenuIndex(document: ToastMenusDocument | null) {
  const itemsByGuid = new Map<string, ToastMenuItem>();
  const itemsByMulti = new Map<string, ToastMenuItem>();
  const itemsByReference = new Map<string | number, ToastMenuItem>();
  const modifiersByGuid = new Map<string, ToastModifierOption>();
  const modifiersByMulti = new Map<string, ToastModifierOption>();
  const modifiersByReference = new Map<string | number, ToastModifierOption>();

  if (document) {
    for (const modifier of Object.values(document.modifierOptionReferences ?? {})) {
      const modAny = modifier as any;
      if (modAny?.guid) {
        modifiersByGuid.set(modAny.guid, modifier as ToastModifierOption);
      }
      const multi = modAny?.multiLocationId;
      if (multi) {
        modifiersByMulti.set(String(multi), modifier as ToastModifierOption);
      }
      const referenceId = modAny?.referenceId;
      if (referenceId !== undefined && referenceId !== null) {
        modifiersByReference.set(referenceId, modifier as ToastModifierOption);
      }
    }

    const stack: any[] = [];
    for (const menu of document.menus ?? []) {
      for (const group of menu.menuGroups ?? []) {
        stack.push(group);
      }
    }

    while (stack.length > 0) {
      const group = stack.pop();
      if (!group) {
        continue;
      }

      for (const item of group.items ?? []) {
        const itemAny = item as any;
        if (itemAny?.guid) {
          itemsByGuid.set(itemAny.guid, item as ToastMenuItem);
        }
        const multi = itemAny?.multiLocationId;
        if (multi) {
          itemsByMulti.set(String(multi), item as ToastMenuItem);
        }
        const referenceId = itemAny?.referenceId;
        if (referenceId !== undefined && referenceId !== null) {
          itemsByReference.set(referenceId, item as ToastMenuItem);
        }
      }

      const childGroups = (group as any).menuGroups;
      if (Array.isArray(childGroups)) {
        for (const child of childGroups) {
          stack.push(child);
        }
      }
    }
  }

  return {
    findItem(reference: ToastSelection["item"]): ToastMenuItem | undefined {
      if (!reference) {
        return undefined;
      }

      if (reference.guid && itemsByGuid.has(reference.guid)) {
        return itemsByGuid.get(reference.guid);
      }

      const multi = (reference as any)?.multiLocationId;
      if (multi && itemsByMulti.has(String(multi))) {
        return itemsByMulti.get(String(multi));
      }

      const refId = (reference as any)?.referenceId;
      if (refId !== undefined && refId !== null && itemsByReference.has(refId)) {
        return itemsByReference.get(refId) as ToastMenuItem;
      }

      return undefined;
    },
    findModifier(reference: ToastSelection["item"]): ToastModifierOption | undefined {
      if (!reference) {
        return undefined;
      }

      if (reference.guid && modifiersByGuid.has(reference.guid)) {
        return modifiersByGuid.get(reference.guid);
      }

      const multi = (reference as any)?.multiLocationId;
      if (multi && modifiersByMulti.has(String(multi))) {
        return modifiersByMulti.get(String(multi));
      }

      const refId = (reference as any)?.referenceId;
      if (refId !== undefined && refId !== null && modifiersByReference.has(refId)) {
        return modifiersByReference.get(refId) as ToastModifierOption;
      }

      return undefined;
    },
  };
}

function getOrCreateAccumulator(
  aggregates: Map<string, OrderAccumulator>,
  key: string,
  seed: {
    orderId: string;
    orderNumber: string | null;
    checkId: string | null;
    status: string | null;
    currency: string | null;
    customerName: string | null;
    orderType: OrderType;
    locationId: string | null;
    orderTime: string;
    orderTimeMs: number | null;
    timeDue: string | null;
  }
): OrderAccumulator {
  let existing = aggregates.get(key);
  if (!existing) {
    existing = {
      key,
      orderId: seed.orderId,
      orderNumber: seed.orderNumber ?? null,
      checkId: seed.checkId ?? null,
      status: seed.status ?? null,
      currency: seed.currency ?? null,
      customerName: seed.customerName ?? null,
      orderType: seed.orderType ?? "UNKNOWN",
      locationId: seed.locationId ?? null,
      orderTime: seed.orderTime,
      orderTimeMs: seed.orderTimeMs ?? null,
      timeDue: seed.timeDue ?? null,
      items: [],
      baseItemsSubtotalCents: 0,
      modifiersSubtotalCents: 0,
      discountTotalCents: 0,
      serviceChargeCents: 0,
      tipCents: 0,
      checkTotalsHydrated: false,
    };
    aggregates.set(key, existing);
  }
  return existing;
}

function updateAccumulatorMeta(
  accumulator: OrderAccumulator,
  meta: {
    orderNumber: string | null;
    status: string | null;
    currency: string | null;
    customerName: string | null;
    orderType: OrderType;
    locationId: string | null;
    orderTime: string;
    orderTimeMs: number | null;
    timeDue: string | null;
  }
): void {
  if (meta.orderNumber && !accumulator.orderNumber) {
    accumulator.orderNumber = meta.orderNumber;
  }
  if (meta.status && !accumulator.status) {
    accumulator.status = meta.status;
  }
  if (meta.currency && !accumulator.currency) {
    accumulator.currency = meta.currency;
  }
  if (meta.customerName && !accumulator.customerName) {
    accumulator.customerName = meta.customerName;
  }
  if (meta.orderType && (accumulator.orderType === "UNKNOWN" || !accumulator.orderType)) {
    accumulator.orderType = meta.orderType;
  }
  if (meta.locationId && !accumulator.locationId) {
    accumulator.locationId = meta.locationId;
  }
  if (meta.timeDue && !accumulator.timeDue) {
    accumulator.timeDue = meta.timeDue;
  }
  if (meta.orderTime) {
    accumulator.orderTime = meta.orderTime;
  }
  if (meta.orderTimeMs !== null) {
    accumulator.orderTimeMs = meta.orderTimeMs;
  }
}

function hasNonZeroTotals(entry: OrderAccumulator): boolean {
  return (
    entry.baseItemsSubtotalCents > 0 ||
    entry.modifiersSubtotalCents > 0 ||
    entry.discountTotalCents > 0 ||
    entry.serviceChargeCents > 0 ||
    entry.tipCents > 0
  );
}

function compareAggregatedOrdersByOrderTime(a: OrderAccumulator, b: OrderAccumulator): number {
  const aTime = a.orderTimeMs;
  const bTime = b.orderTimeMs;

  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return aTime - bTime;
  }

  if (aTime !== null && bTime === null) {
    return -1;
  }

  if (aTime === null && bTime !== null) {
    return 1;
  }

  if (a.orderId !== b.orderId) {
    return a.orderId.localeCompare(b.orderId);
  }

  const aCheck = a.checkId ?? "";
  const bCheck = b.checkId ?? "";
  if (aCheck !== bCheck) {
    return aCheck.localeCompare(bCheck);
  }

  return 0;
}

function toExpandedOrder(entry: OrderAccumulator): ExpandedOrder {
  const base = entry.baseItemsSubtotalCents;
  const modifiers = entry.modifiersSubtotalCents;
  const discount = entry.discountTotalCents;
  const service = entry.serviceChargeCents;
  const tip = entry.tipCents;
  const subtotal = base + modifiers;
  const grand = Math.max(subtotal - discount + service + tip, 0);

  const location: { locationId?: string | null } = {};
  if (entry.locationId) {
    location.locationId = entry.locationId;
  }

  const times: { orderTime: string; timeDue?: string | null } = {
    orderTime: entry.orderTime,
  };
  if (entry.timeDue) {
    times.timeDue = entry.timeDue;
  }

  const order: ExpandedOrder = {
    orderId: entry.orderId,
    orderType: entry.orderType ?? "UNKNOWN",
    location,
    times,
    items: entry.items,
    totals: {
      baseItemsSubtotalCents: base,
      modifiersSubtotalCents: modifiers,
      discountTotalCents: discount,
      serviceChargeCents: service,
      tipCents: tip,
      grandTotalCents: grand,
    },
  };

  if (entry.orderNumber) {
    order.orderNumber = entry.orderNumber;
  }
  if (entry.checkId) {
    order.checkId = entry.checkId;
  }
  if (entry.status) {
    order.status = entry.status;
  }
  if (entry.currency) {
    order.currency = entry.currency;
  }
  if (entry.customerName) {
    order.customerName = entry.customerName;
  }

  return order;
}

function collectModifierDetails(
  selection: ToastSelection,
  menuIndex: ReturnType<typeof createMenuIndex>,
  parentQuantity = 1
): { modifiers: OrderItemModifier[]; totalCents: number } {
  const output: OrderItemModifier[] = [];
  let total = 0;
  const modifiers = Array.isArray(selection.modifiers) ? selection.modifiers : [];

  for (const modifier of modifiers) {
    if (!modifier) {
      continue;
    }

    const base = menuIndex.findModifier(modifier.item);
    const name =
      getKitchenTicketName(base) ?? getSelectionDisplayName(modifier) ?? modifier.item?.guid ?? "Unknown modifier";
    const groupName = extractModifierGroupName(modifier, base);
    const id =
      typeof modifier.item?.guid === "string" && modifier.item.guid
        ? modifier.item.guid
        : typeof modifier.guid === "string" && modifier.guid
        ? modifier.guid
        : (base as any)?.guid ?? null;

    const modifierQuantity = normalizeQuantity((modifier as ToastSelection).quantity);
    const ownUnitPrice = resolveModifierUnitPriceCents(modifier as ToastSelection);
    const ownTotalPrice = ownUnitPrice !== null ? ownUnitPrice * modifierQuantity : null;
    const adjustedPrice = ownTotalPrice !== null ? ownTotalPrice * parentQuantity : null;

    output.push({
      id,
      name,
      groupName: groupName ?? null,
      priceCents: adjustedPrice ?? 0,
      quantity: modifierQuantity,
    });

    if (adjustedPrice !== null) {
      total += adjustedPrice;
    }

    if (Array.isArray((modifier as any).modifiers) && (modifier as any).modifiers.length > 0) {
      const nested = collectModifierDetails(
        modifier as unknown as ToastSelection,
        menuIndex,
        parentQuantity * modifierQuantity
      );
      output.push(...nested.modifiers);
      total += nested.totalCents;
    }
  }

  return { modifiers: output, totalCents: total };
}

function sumDiscountAmounts(discounts: unknown): number {
  if (!Array.isArray(discounts)) {
    return 0;
  }

  let total = 0;
  for (const discount of discounts) {
    if (!discount) {
      continue;
    }

    const amount =
      toCents((discount as any)?.discountAmount) ??
      toCents((discount as any)?.amount) ??
      toCents((discount as any)?.value);

    if (amount !== null) {
      total += Math.max(amount, 0);
    }
  }

  return total;
}

function sumServiceCharges(charges: unknown): number {
  if (!Array.isArray(charges)) {
    return 0;
  }

  let total = 0;
  for (const charge of charges) {
    if (!charge) {
      continue;
    }

    const amount = toCents((charge as any)?.chargeAmount) ?? toCents((charge as any)?.amount);
    if (amount !== null) {
      total += amount;
    }
  }

  return total;
}

function sumTipAmounts(payments: unknown): number {
  if (!Array.isArray(payments)) {
    return 0;
  }

  let total = 0;
  for (const payment of payments) {
    if (!payment) {
      continue;
    }

    const tip = toCents((payment as any)?.tipAmount);
    if (tip !== null) {
      total += tip;
    }
  }

  return total;
}

function isSelectionVoided(selection: ToastSelection): boolean {
  return Boolean((selection as any)?.voided);
}

function toCents(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.round(value * 100);
}

function extractModifierGroupName(
  modifier: any,
  base: ToastModifierOption | undefined
): string | null {
  const candidates = [
    typeof modifier?.optionGroup?.name === "string" ? modifier.optionGroup.name : null,
    typeof (base as any)?.optionGroupName === "string" ? (base as any).optionGroupName : null,
    typeof (base as any)?.groupName === "string" ? (base as any).groupName : null,
    typeof (base as any)?.menuOptionGroup?.name === "string" ? (base as any).menuOptionGroup.name : null,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function resolveModifierUnitPriceCents(modifier: ToastSelection): number | null {
  const price = typeof (modifier as any)?.price === "number" ? toCents((modifier as any).price) : null;
  if (price !== null) {
    return price;
  }

  const receiptPrice = extractReceiptLinePrice(modifier);
  if (receiptPrice === null) {
    return null;
  }

  return toCents(receiptPrice);
}

function orderMatches(order: ToastOrder, locationId: string | null, status: string | null): boolean {
  if (isVoidedOrder(order)) {
    return false;
  }

  if (locationId) {
    const value = extractOrderLocation(order);
    if (!value || value !== locationId) {
      return false;
    }
  }

  if (status) {
    const orderStatus = extractOrderStatus(order);
    if (!orderStatus || orderStatus.toLowerCase() !== status.toLowerCase()) {
      return false;
    }
  }

  return true;
}

function isVoidedOrder(order: ToastOrder): boolean {
  return Boolean((order as any)?.voided);
}

function extractOrderTime(order: ToastOrder): string | null {
  const candidates = [order.createdDate, order.openedDate, order.modifiedDate];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }
  return null;
}

function parseToastTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = Date.parse(normalized);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

function extractOrderDueTime(order: ToastOrder): string | null {
  const candidates = [order.promisedDate, order.estimatedFulfillmentDate];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }
  return null;
}

function extractOrderNumber(order: ToastOrder): string | null {
  if (typeof (order as any)?.displayNumber === "string") {
    return (order as any).displayNumber;
  }
  return null;
}

function extractOrderLocation(order: ToastOrder): string | null {
  const maybe = [
    (order as any)?.restaurantLocationGuid,
    (order as any)?.restaurantGuid,
    (order as any)?.locationGuid,
    (order as any)?.locationId,
    (order as any)?.context?.restaurantLocationGuid,
    (order as any)?.context?.locationGuid,
    (order as any)?.context?.locationId,
    order.revenueCenter?.guid,
  ];

  for (const candidate of maybe) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return null;
}

function extractOrderStatus(order: ToastOrder): string | null {
  const maybe = [(order as any)?.status, (order as any)?.orderStatus, (order as any)?.approvalStatus];
  for (const candidate of maybe) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }
  return null;
}

function extractOrderCurrency(order: ToastOrder): string | null {
  const maybe = [(order as any)?.currency, (order as any)?.currencyCode];
  for (const candidate of maybe) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }
  return null;
}

function extractCustomerName(order: ToastOrder, check: ToastCheck): string | null {
  const fromCheck = buildCustomerName(check.customer);
  if (fromCheck) {
    return fromCheck;
  }

  for (const customer of Array.isArray(order.customers) ? order.customers : []) {
    const name = buildCustomerName(customer);
    if (name) {
      return name;
    }
  }

  const fallbackCandidates = [
    normalizeName((check as any)?.tabName),
    normalizeName((check as any)?.curbsidePickupInfo?.name),
    normalizeName((order as any)?.context?.deliveryInfo?.recipientName),
    extractFirstGuestName(check),
  ];

  for (const candidate of fallbackCandidates) {
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function buildCustomerName(customer: unknown): string | null {
  if (!customer) {
    return null;
  }

  if (typeof customer === "string") {
    return normalizeName(customer);
  }

  const first = normalizeName((customer as any)?.firstName);
  const last = normalizeName((customer as any)?.lastName);
  const combined = [first, last].filter(Boolean).join(" ").trim();

  if (combined) {
    return combined;
  }

  const name = normalizeName((customer as any)?.name);
  if (name) {
    return name;
  }

  return null;
}

function extractFirstGuestName(check: ToastCheck): string | null {
  const guests = Array.isArray((check as any)?.guests) ? (check as any).guests : [];
  for (const guest of guests) {
    const name = buildCustomerName(guest);
    if (name) {
      return name;
    }
  }
  return null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function extractOrderType(order: ToastOrder, check: ToastCheck): OrderType {
  if ((check as any)?.curbsidePickupInfo) {
    return "CURBSIDE";
  }

  const candidates = new Set<OrderType>();

  if ((order as any)?.context?.deliveryInfo || (order as any)?.isDelivery === true || (check as any)?.isDelivery === true) {
    candidates.add("DELIVERY");
  }

  if ((order as any)?.isDriveThru === true || (check as any)?.isDriveThru === true) {
    candidates.add("DRIVE_THRU");
  }

  if ((order as any)?.isCatering === true || (check as any)?.isCatering === true) {
    candidates.add("CATERING");
  }

  for (const value of gatherOrderTypeCandidates(order, check)) {
    const normalized = normalizeOrderType(value);
    if (normalized) {
      candidates.add(normalized);
    }
  }

  if (candidates.has("CURBSIDE")) {
    return "CURBSIDE";
  }
  if (candidates.has("DRIVE_THRU")) {
    return "DRIVE_THRU";
  }
  if (candidates.has("CATERING")) {
    return "CATERING";
  }
  if (candidates.has("DELIVERY")) {
    return "DELIVERY";
  }
  if (candidates.has("DINE_IN")) {
    return "DINE_IN";
  }
  if (candidates.has("TAKEOUT")) {
    return "TAKEOUT";
  }

  return "UNKNOWN";
}

function gatherOrderTypeCandidates(order: ToastOrder, check: ToastCheck): unknown[] {
  const values: unknown[] = [];
  const push = (...items: unknown[]) => {
    for (const item of items) {
      if (item !== undefined && item !== null) {
        values.push(item);
      }
    }
  };

  push(
    (check as any)?.orderType,
    (check as any)?.serviceType,
    (check as any)?.orderMode,
    (check as any)?.channelType,
    (check as any)?.fulfillmentMode,
    (order as any)?.orderType,
    (order as any)?.serviceType,
    (order as any)?.orderMode,
    (order as any)?.channelType,
    (order as any)?.mode,
    (order as any)?.fulfillmentType,
    (order as any)?.fulfillmentMode,
    (order as any)?.fulfillment,
    (order as any)?.source?.orderType,
    (order as any)?.source?.serviceType,
    (order as any)?.source?.mode,
    (order as any)?.context?.orderType,
    (order as any)?.context?.serviceType,
    (order as any)?.context?.orderMode,
    (order as any)?.context?.channelType,
    (order as any)?.context?.fulfillmentType,
    (order as any)?.context?.fulfillmentMode,
    (order as any)?.context?.diningOption,
    (order as any)?.context?.diningOptionType
  );

  return values;
}

function normalizeOrderType(value: unknown): OrderType | null {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    const candidate =
      typeof (value as any)?.type === "string"
        ? (value as any).type
        : typeof (value as any)?.name === "string"
        ? (value as any).name
        : null;
    if (candidate) {
      return normalizeOrderType(candidate);
    }
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

  const directMap: Record<string, OrderType> = {
    TAKEOUT: "TAKEOUT",
    TAKE_OUT: "TAKEOUT",
    TAKEAWAY: "TAKEOUT",
    TAKE_AWAY: "TAKEOUT",
    PICKUP: "TAKEOUT",
    PICK_UP: "TAKEOUT",
    PICK_UP_ORDER: "TAKEOUT",
    PICKUP_ORDER: "TAKEOUT",
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
    DRIVE_THRUGH: "DRIVE_THRU",
    DRIVETHRU: "DRIVE_THRU",
    DRIVE_THROUGH: "DRIVE_THRU",
    CATERING: "CATERING",
    DELIVERY: "DELIVERY",
    DELIVER: "DELIVERY",
  };

  if (directMap[normalized]) {
    return directMap[normalized];
  }

  if (normalized.includes("CURBSIDE")) {
    return "CURBSIDE";
  }
  if (normalized.includes("DRIVE")) {
    return "DRIVE_THRU";
  }
  if (normalized.includes("CATER")) {
    return "CATERING";
  }
  if (normalized.includes("DELIVER")) {
    return "DELIVERY";
  }
  if (normalized.includes("DINE") || normalized.includes("EAT_IN") || normalized.includes("EATIN") || normalized.includes("ON_PREMISE")) {
    return "DINE_IN";
  }
  if (
    normalized.includes("TAKE") ||
    normalized.includes("PICKUP") ||
    normalized.includes("PICK_UP") ||
    normalized.includes("PICK-UP") ||
    normalized.includes("TOGO") ||
    normalized.includes("TO_GO")
  ) {
    return "TAKEOUT";
  }

  return null;
}

function isLineItem(selection: ToastSelection): boolean {
  const selectionType = getSelectionType(selection);
  if (selectionType && DISALLOWED_SELECTION_TYPES.has(selectionType)) {
    return false;
  }

  const item = (selection as any)?.item;
  if (!item || typeof item !== "object") {
    return false;
  }

  const itemType = getItemType(selection);
  if (itemType && DISALLOWED_ITEM_TYPES.has(itemType)) {
    return false;
  }

  if (selectionType && ALLOWED_SELECTION_TYPES.has(selectionType)) {
    return true;
  }

  if (itemType && ALLOWED_ITEM_TYPES.has(itemType)) {
    return true;
  }

  const hasGuid =
    (typeof item.guid === "string" && item.guid.trim() !== "") ||
    (typeof item.guid === "number" && Number.isFinite(item.guid));
  const hasReference =
    hasGuid ||
    item.multiLocationId !== undefined && item.multiLocationId !== null ||
    item.referenceId !== undefined && item.referenceId !== null;

  if (hasReference) {
    return true;
  }

  const price = extractReceiptLinePrice(selection);
  return price !== null;
}

const DISALLOWED_SELECTION_TYPES = new Set([
  "SPECIAL_REQUEST",
  "NOTE",
  "TEXT",
  "FEE",
  "SURCHARGE",
  "SERVICE_CHARGE",
  "TIP",
  "TAX",
  "PAYMENT",
  "DEPOSIT",
]);

const ALLOWED_SELECTION_TYPES = new Set(["MENU_ITEM", "ITEM", "STANDARD", "OPEN_ITEM", "CUSTOM_ITEM", "RETAIL_ITEM"]);

const DISALLOWED_ITEM_TYPES = new Set([
  "SPECIAL_REQUEST",
  "NOTE",
  "TEXT",
  "FEE",
  "SURCHARGE",
  "SERVICE_CHARGE",
  "TIP",
  "TAX",
]);

const ALLOWED_ITEM_TYPES = new Set([
  "MENU_ITEM",
  "ITEM",
  "ENTREE",
  "PRODUCT",
  "OPEN_ITEM",
  "RETAIL",
  "RETAIL_ITEM",
  "BEVERAGE",
]);

function getSelectionType(selection: ToastSelection): string {
  const raw = (selection as any)?.selectionType ?? selection.selectionType;
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim().toUpperCase().replace(/\s+/g, "_");
}

function getItemType(selection: ToastSelection): string {
  const raw = (selection as any)?.item?.itemType ?? (selection as any)?.item?.type;
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim().toUpperCase().replace(/\s+/g, "_");
}

function getKitchenTicketName(entity: unknown): string | undefined {
  if (!entity || typeof entity !== "object") {
    return undefined;
  }

  const kitchenName = typeof (entity as any).kitchenName === "string" ? (entity as any).kitchenName.trim() : "";
  if (kitchenName) {
    return kitchenName;
  }

  const displayName = typeof (entity as any).name === "string" ? (entity as any).name.trim() : "";
  if (displayName) {
    return displayName;
  }

  return undefined;
}

function getSelectionDisplayName(selection: ToastSelection): string | undefined {
  const displayName = typeof (selection as any)?.displayName === "string" ? (selection as any).displayName.trim() : "";
  if (displayName) {
    return displayName;
  }
  return undefined;
}

function normalizeQuantity(quantity: number | undefined): number {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(quantity));
}

function extractSpecialInstructions(selection: ToastSelection, itemName: string): string | null {
  const explicit = typeof (selection as any)?.specialInstructions === "string" ? (selection as any).specialInstructions : null;
  if (explicit) {
    return explicit;
  }

  const selectionType = getSelectionType(selection);
  if (selectionType === "SPECIAL_REQUEST") {
    const display = getSelectionDisplayName(selection);
    if (display && display !== itemName) {
      return display;
    }
  }

  return null;
}

function extractReceiptLinePrice(selection: ToastSelection): number | null {
  const priceCandidate =
    typeof selection.receiptLinePrice === "number"
      ? selection.receiptLinePrice
      : typeof (selection as any)?.price === "number"
      ? (selection as any).price
      : undefined;

  if (priceCandidate === undefined || Number.isNaN(priceCandidate)) {
    return null;
  }

  return priceCandidate;
}
