import type { AppEnv } from "../config/env.js";
import { getDiningOptions, getOrdersBulk, getPublishedMenus } from "../clients/toast.js";
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
  getDiningOptions: typeof getDiningOptions;
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
  fulfillmentStatus: ItemFulfillmentStatus | null;
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

type ItemFulfillmentStatus = "NEW" | "HOLD" | "SENT" | "READY";

const FULFILLMENT_STATUS_RANK: Record<ItemFulfillmentStatus, number> = {
  NEW: 0,
  HOLD: 1,
  SENT: 2,
  READY: 3,
};

function normalizeItemFulfillmentStatus(value: unknown): ItemFulfillmentStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed === "NEW" || trimmed === "HOLD" || trimmed === "SENT" || trimmed === "READY") {
    return trimmed as ItemFulfillmentStatus;
  }

  return null;
}

function mergeFulfillmentStatuses(
  current: ItemFulfillmentStatus | null,
  next: ItemFulfillmentStatus | null
): ItemFulfillmentStatus | null {
  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  const nextRank = FULFILLMENT_STATUS_RANK[next];
  const currentRank = FULFILLMENT_STATUS_RANK[current];

  if (nextRank >= currentRank) {
    return next;
  }

  return current;
}

export interface OrderDataBlock {
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
  deliveryInfo?: Record<string, unknown>;
  curbsidePickupInfo?: Record<string, unknown>;
  table?: Record<string, unknown>;
  seats?: number[];
  employee?: Record<string, unknown>;
  promisedDate?: string;
  estimatedFulfillmentDate?: string;
}

export interface ExpandedOrder {
  orderData: OrderDataBlock;
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

interface OrderAccumulator {
  key: string;
  orderId: string;
  orderNumber: string | null;
  checkId: string | null;
  status: string | null;
  webhookFulfillmentStatus: string | null;
  selectionFulfillmentStatus: ItemFulfillmentStatus | null;
  hasItemFulfillmentStatuses: boolean;
  anyItemStatusNotReady: boolean;
  allItemStatusesReady: boolean;
  currency: string | null;
  customerName: string | null;
  orderType: OrderType;
  diningOptionGuid: string | null;
  locationId: string | null;
  orderTime: string;
  orderTimeMs: number | null;
  timeDue: string | null;
  deliveryState: string | null;
  deliveryInfo?: Record<string, unknown> | null;
  curbsidePickupInfo?: Record<string, unknown> | null;
  dineInTable?: Record<string, unknown> | null;
  dineInSeatNumbers: Set<number>;
  dineInEmployee?: Record<string, unknown> | null;
  takeoutPromisedDate: string | null;
  takeoutEstimatedFulfillmentDate: string | null;
  items: ExpandedOrderItem[];
  baseItemsSubtotalCents: number;
  modifiersSubtotalCents: number;
  discountTotalCents: number;
  serviceChargeCents: number;
  tipCents: number;
  checkTotalsHydrated: boolean;
}

interface OrderBehaviorMetadata {
  orderType: OrderType;
  diningOptionGuid: string | null;
  deliveryState?: string | null;
  deliveryInfo?: Record<string, unknown> | null;
  curbsidePickupInfo?: Record<string, unknown> | null;
  dineInTable?: Record<string, unknown> | null;
  dineInSeats?: number[];
  dineInEmployee?: Record<string, unknown> | null;
  takeoutPromisedDate?: string | null;
  takeoutEstimatedFulfillmentDate?: string | null;
}

interface DiningOptionRecord {
  guid: string;
  behavior: string | null;
  name: string | null;
}

export function createItemsExpandedHandler(
  deps: ItemsExpandedDeps = { getOrdersBulk, getPublishedMenus, getDiningOptions }
) {
  const diningOptionResolver = createDiningOptionResolver(deps.getDiningOptions);
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
            const behaviorMeta = await resolveOrderBehavior(
              env,
              order,
              check,
              diningOptionResolver
            );
            const initialFulfillmentStatus = extractOrderFulfillmentStatus(order, check);
            const webhookFulfillmentStatus = extractGuestOrderFulfillmentStatus(order, check);
            const key = `${order.guid}:${check.guid}`;
            const accumulator = getOrCreateAccumulator(aggregates, key, {
              orderId: order.guid,
              orderNumber,
              checkId: check.guid ?? null,
              status: orderStatus,
              webhookFulfillmentStatus: webhookFulfillmentStatus ?? null,
              selectionFulfillmentStatus: initialFulfillmentStatus ?? null,
              currency: orderCurrency,
              customerName,
              orderType: behaviorMeta.orderType,
              diningOptionGuid: behaviorMeta.diningOptionGuid,
              locationId,
              orderTime,
              orderTimeMs,
              timeDue,
              deliveryState: behaviorMeta.deliveryState ?? null,
              deliveryInfo: behaviorMeta.deliveryInfo ?? null,
              curbsidePickupInfo: behaviorMeta.curbsidePickupInfo ?? null,
              dineInTable: behaviorMeta.dineInTable ?? null,
              dineInSeats: behaviorMeta.dineInSeats ?? [],
              dineInEmployee: behaviorMeta.dineInEmployee ?? null,
              takeoutPromisedDate: behaviorMeta.takeoutPromisedDate ?? null,
              takeoutEstimatedFulfillmentDate:
                behaviorMeta.takeoutEstimatedFulfillmentDate ?? null,
            });

            updateAccumulatorMeta(accumulator, {
              orderNumber,
              status: orderStatus,
              webhookFulfillmentStatus: webhookFulfillmentStatus ?? null,
              selectionFulfillmentStatus: initialFulfillmentStatus ?? null,
              currency: orderCurrency,
              customerName,
              orderType: behaviorMeta.orderType,
              diningOptionGuid: behaviorMeta.diningOptionGuid,
              locationId,
              orderTime,
              orderTimeMs,
              timeDue,
              deliveryState: behaviorMeta.deliveryState ?? null,
              deliveryInfo: behaviorMeta.deliveryInfo ?? null,
              curbsidePickupInfo: behaviorMeta.curbsidePickupInfo ?? null,
              dineInTable: behaviorMeta.dineInTable ?? null,
              dineInSeats: behaviorMeta.dineInSeats ?? [],
              dineInEmployee: behaviorMeta.dineInEmployee ?? null,
              takeoutPromisedDate: behaviorMeta.takeoutPromisedDate ?? null,
              takeoutEstimatedFulfillmentDate:
                behaviorMeta.takeoutEstimatedFulfillmentDate ?? null,
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

              const selectionFulfillmentStatus = normalizeItemFulfillmentStatus(
                (selection as any)?.fulfillmentStatus
              );
              if (selectionFulfillmentStatus) {
                accumulator.selectionFulfillmentStatus = mergeFulfillmentStatuses(
                  accumulator.selectionFulfillmentStatus,
                  selectionFulfillmentStatus
                );
                accumulator.hasItemFulfillmentStatuses = true;
                if (selectionFulfillmentStatus === "READY") {
                  if (!accumulator.anyItemStatusNotReady) {
                    accumulator.allItemStatusesReady = true;
                  }
                } else {
                  accumulator.anyItemStatusNotReady = true;
                  accumulator.allItemStatusesReady = false;
                }
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
                fulfillmentStatus: selectionFulfillmentStatus,
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
    webhookFulfillmentStatus?: string | null;
    selectionFulfillmentStatus?: ItemFulfillmentStatus | null;
    currency: string | null;
    customerName: string | null;
    orderType: OrderType;
    diningOptionGuid: string | null;
    locationId: string | null;
    orderTime: string;
    orderTimeMs: number | null;
    timeDue: string | null;
    deliveryState?: string | null;
    deliveryInfo?: Record<string, unknown> | null;
    curbsidePickupInfo?: Record<string, unknown> | null;
    dineInTable?: Record<string, unknown> | null;
    dineInSeats?: number[];
    dineInEmployee?: Record<string, unknown> | null;
    takeoutPromisedDate?: string | null;
    takeoutEstimatedFulfillmentDate?: string | null;
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
      webhookFulfillmentStatus: seed.webhookFulfillmentStatus ?? null,
      selectionFulfillmentStatus: seed.selectionFulfillmentStatus ?? null,
      hasItemFulfillmentStatuses: false,
      anyItemStatusNotReady: false,
      allItemStatusesReady: true,
      currency: seed.currency ?? null,
      customerName: seed.customerName ?? null,
      orderType: seed.orderType ?? "UNKNOWN",
      diningOptionGuid: seed.diningOptionGuid ?? null,
      locationId: seed.locationId ?? null,
      orderTime: seed.orderTime,
      orderTimeMs: seed.orderTimeMs ?? null,
      timeDue: seed.timeDue ?? null,
      deliveryState: seed.deliveryState ?? null,
      deliveryInfo: seed.deliveryInfo ?? null,
      curbsidePickupInfo: seed.curbsidePickupInfo ?? null,
      dineInTable: seed.dineInTable ?? null,
      dineInSeatNumbers: new Set(Array.isArray(seed.dineInSeats) ? seed.dineInSeats : []),
      dineInEmployee: seed.dineInEmployee ?? null,
      takeoutPromisedDate: seed.takeoutPromisedDate ?? null,
      takeoutEstimatedFulfillmentDate: seed.takeoutEstimatedFulfillmentDate ?? null,
      items: [],
      baseItemsSubtotalCents: 0,
      modifiersSubtotalCents: 0,
      discountTotalCents: 0,
      serviceChargeCents: 0,
      tipCents: 0,
      checkTotalsHydrated: false,
    };
    aggregates.set(key, existing);
  } else {
    if (Array.isArray(seed.dineInSeats) && seed.dineInSeats.length > 0) {
      for (const seat of seed.dineInSeats) {
        if (typeof seat === "number" && Number.isFinite(seat)) {
          existing.dineInSeatNumbers.add(seat);
        }
      }
    }
  }
  return existing;
}

function updateAccumulatorMeta(
  accumulator: OrderAccumulator,
  meta: {
    orderNumber: string | null;
    status: string | null;
    webhookFulfillmentStatus?: string | null;
    selectionFulfillmentStatus?: ItemFulfillmentStatus | null;
    currency: string | null;
    customerName: string | null;
    orderType: OrderType;
    diningOptionGuid: string | null;
    locationId: string | null;
    orderTime: string;
    orderTimeMs: number | null;
    timeDue: string | null;
    deliveryState?: string | null;
    deliveryInfo?: Record<string, unknown> | null;
    curbsidePickupInfo?: Record<string, unknown> | null;
    dineInTable?: Record<string, unknown> | null;
    dineInSeats?: number[];
    dineInEmployee?: Record<string, unknown> | null;
    takeoutPromisedDate?: string | null;
    takeoutEstimatedFulfillmentDate?: string | null;
  }
): void {
  if (meta.orderNumber && !accumulator.orderNumber) {
    accumulator.orderNumber = meta.orderNumber;
  }
  if (meta.status && !accumulator.status) {
    accumulator.status = meta.status;
  }
  if (meta.webhookFulfillmentStatus && !accumulator.webhookFulfillmentStatus) {
    accumulator.webhookFulfillmentStatus = meta.webhookFulfillmentStatus;
  }
  if (meta.selectionFulfillmentStatus) {
    accumulator.selectionFulfillmentStatus = mergeFulfillmentStatuses(
      accumulator.selectionFulfillmentStatus,
      meta.selectionFulfillmentStatus
    );
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
  if (meta.diningOptionGuid && !accumulator.diningOptionGuid) {
    accumulator.diningOptionGuid = meta.diningOptionGuid;
  }
  if (meta.locationId && !accumulator.locationId) {
    accumulator.locationId = meta.locationId;
  }
  if (meta.timeDue && !accumulator.timeDue) {
    accumulator.timeDue = meta.timeDue;
  }
  if (meta.deliveryState && !accumulator.deliveryState) {
    accumulator.deliveryState = meta.deliveryState;
  }
  if (meta.deliveryInfo && !accumulator.deliveryInfo) {
    accumulator.deliveryInfo = meta.deliveryInfo;
  }
  if (meta.curbsidePickupInfo && !accumulator.curbsidePickupInfo) {
    accumulator.curbsidePickupInfo = meta.curbsidePickupInfo;
  }
  if (meta.dineInTable && !accumulator.dineInTable) {
    accumulator.dineInTable = meta.dineInTable;
  }
  if (meta.dineInEmployee && !accumulator.dineInEmployee) {
    accumulator.dineInEmployee = meta.dineInEmployee;
  }
  if (Array.isArray(meta.dineInSeats) && meta.dineInSeats.length > 0) {
    for (const seat of meta.dineInSeats) {
      if (typeof seat === "number" && Number.isFinite(seat)) {
        accumulator.dineInSeatNumbers.add(seat);
      }
    }
  }
  if (meta.takeoutPromisedDate && !accumulator.takeoutPromisedDate) {
    accumulator.takeoutPromisedDate = meta.takeoutPromisedDate;
  }
  if (meta.takeoutEstimatedFulfillmentDate && !accumulator.takeoutEstimatedFulfillmentDate) {
    accumulator.takeoutEstimatedFulfillmentDate = meta.takeoutEstimatedFulfillmentDate;
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
  const orderDataLocation: { locationId?: string | null } = {};
  if (entry.locationId) {
    orderDataLocation.locationId = entry.locationId;
  }

  const orderData: OrderDataBlock = {
    orderId: entry.orderId,
    location: orderDataLocation,
    orderTime: entry.orderTime,
    timeDue: entry.timeDue ?? null,
    orderNumber: entry.orderNumber ?? null,
    checkId: entry.checkId ?? null,
    status: entry.status ?? null,
    fulfillmentStatus: deriveOrderFulfillmentStatus(entry),
    customerName: entry.customerName ?? null,
    orderType: entry.orderType ?? "UNKNOWN",
    diningOptionGuid: entry.diningOptionGuid ?? null,
  };

  if (entry.deliveryState) {
    orderData.deliveryState = entry.deliveryState;
  }
  if (entry.deliveryInfo) {
    orderData.deliveryInfo = entry.deliveryInfo;
  }
  if (entry.curbsidePickupInfo) {
    orderData.curbsidePickupInfo = entry.curbsidePickupInfo;
  }
  if (entry.dineInTable) {
    orderData.table = entry.dineInTable;
  }
  const dineInSeats = Array.from(entry.dineInSeatNumbers)
    .filter((seat): seat is number => typeof seat === "number" && Number.isFinite(seat))
    .sort((a, b) => a - b);
  if (dineInSeats.length > 0) {
    orderData.seats = dineInSeats;
  }
  if (entry.dineInEmployee) {
    orderData.employee = entry.dineInEmployee;
  }
  if (entry.takeoutPromisedDate) {
    orderData.promisedDate = entry.takeoutPromisedDate;
  }
  if (entry.takeoutEstimatedFulfillmentDate) {
    orderData.estimatedFulfillmentDate = entry.takeoutEstimatedFulfillmentDate;
  }

  const order: ExpandedOrder = {
    orderData,
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

  if (entry.currency) {
    order.currency = entry.currency;
  }

  return order;
}

function deriveOrderFulfillmentStatus(entry: OrderAccumulator): string | null {
  if (entry.webhookFulfillmentStatus) {
    const normalized = normalizeGuestFulfillmentStatus(entry.webhookFulfillmentStatus);
    if (normalized) {
      return normalized;
    }
  }

  if (entry.hasItemFulfillmentStatuses) {
    if (entry.anyItemStatusNotReady) {
      return "IN_PREPARATION";
    }
    if (entry.allItemStatusesReady) {
      return "READY_FOR_PICKUP";
    }
  }

  return null;
}

function normalizeGuestFulfillmentStatus(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidates = [
    (value as any)?.status,
    (value as any)?.currentStatus,
    (value as any)?.value,
    (value as any)?.state,
    (value as any)?.fulfillmentStatus,
    (value as any)?.newStatus,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

function collectModifierDetails(
  selection: ToastSelection,
  menuIndex: ReturnType<typeof createMenuIndex>,
  parentQuantity = 1
): { modifiers: OrderItemModifier[]; totalCents: number } {
  const output: OrderItemModifier[] = [];
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

    if (Array.isArray((modifier as any).modifiers) && (modifier as any).modifiers.length > 0) {
      const nested = collectModifierDetails(
        modifier as unknown as ToastSelection,
        menuIndex,
        parentQuantity * modifierQuantity
      );
      output.push(...nested.modifiers);
    }
  }

  const collapsed = collapseOrderItemModifiers(output);
  const totalCents = collapsed.reduce((sum, mod) => sum + mod.priceCents, 0);

  return { modifiers: collapsed, totalCents };
}

function collapseOrderItemModifiers(modifiers: OrderItemModifier[]): OrderItemModifier[] {
  const aggregated: OrderItemModifier[] = [];

  for (const modifier of modifiers) {
    const candidateId = modifier.id ?? null;
    const candidateName = modifier.name;
    const candidateGroup = modifier.groupName ?? null;

    const existing = aggregated.find((entry) => {
      if (entry.id !== candidateId) {
        return false;
      }
      if (entry.name !== candidateName) {
        return false;
      }

      if (entry.groupName === candidateGroup) {
        return true;
      }

      if (entry.groupName === null || candidateGroup === null) {
        return true;
      }

      return false;
    });

    if (!existing) {
      aggregated.push({
        id: candidateId,
        name: candidateName,
        groupName: candidateGroup,
        priceCents: modifier.priceCents,
        quantity: modifier.quantity,
      });
      continue;
    }

    existing.quantity += modifier.quantity;
    existing.priceCents += modifier.priceCents;

    if ((existing.groupName === null || existing.groupName === undefined) && candidateGroup) {
      existing.groupName = candidateGroup;
    }
  }

  return aggregated.map((entry) => ({
    id: entry.id ?? null,
    name: entry.name,
    groupName: entry.groupName ?? null,
    priceCents: entry.priceCents,
    quantity: entry.quantity,
  }));
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

function extractOrderFulfillmentStatus(order: ToastOrder, check: ToastCheck): ItemFulfillmentStatus | null {
  const candidates: unknown[] = [
    (check as any)?.fulfillmentStatus,
    (check as any)?.fulfillment?.status,
    (order as any)?.fulfillmentStatus,
    (order as any)?.fulfillment?.status,
    (order as any)?.context?.fulfillmentStatus,
    (order as any)?.context?.fulfillment?.status,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeItemFulfillmentStatus(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractGuestOrderFulfillmentStatus(order: ToastOrder, check: ToastCheck): string | null {
  const directCandidates: unknown[] = [];
  const push = (value: unknown) => {
    if (value !== undefined && value !== null) {
      directCandidates.push(value);
    }
  };

  push((check as any)?.guestOrderFulfillmentStatus);
  push((check as any)?.guestOrderFulfillmentStatus?.status);
  push((check as any)?.guestFulfillmentStatus);
  push((check as any)?.guestFulfillmentStatus?.status);
  push((check as any)?.fulfillmentStatusWebhook);
  push((check as any)?.fulfillmentStatusWebhook?.status);
  push((order as any)?.guestOrderFulfillmentStatus);
  push((order as any)?.guestOrderFulfillmentStatus?.status);
  push((order as any)?.guestFulfillmentStatus);
  push((order as any)?.guestFulfillmentStatus?.status);
  push((order as any)?.context?.guestOrderFulfillmentStatus);
  push((order as any)?.context?.guestOrderFulfillmentStatus?.status);
  push((order as any)?.context?.guestFulfillmentStatus);
  push((order as any)?.context?.guestFulfillmentStatus?.status);

  for (const candidate of directCandidates) {
    const normalized = normalizeGuestFulfillmentStatus(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const historySources: unknown[] = [
    (check as any)?.guestOrderFulfillmentStatusHistory,
    (check as any)?.guestFulfillmentStatusHistory,
    (check as any)?.fulfillmentStatusHistory,
    (order as any)?.guestOrderFulfillmentStatusHistory,
    (order as any)?.guestFulfillmentStatusHistory,
    (order as any)?.fulfillmentStatusHistory,
    (order as any)?.context?.guestOrderFulfillmentStatusHistory,
    (order as any)?.context?.guestFulfillmentStatusHistory,
    (order as any)?.context?.fulfillmentStatusHistory,
  ];

  for (const source of historySources) {
    if (!Array.isArray(source)) {
      continue;
    }

    for (let i = source.length - 1; i >= 0; i -= 1) {
      const entry = source[i];
      const normalized = normalizeGuestFulfillmentStatus(entry);
      if (normalized) {
        return normalized;
      }

      if (entry && typeof entry === "object") {
        const nested = normalizeGuestFulfillmentStatus((entry as any)?.payload);
        if (nested) {
          return nested;
        }
      }
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

function createDiningOptionResolver(fetcher: ItemsExpandedDeps["getDiningOptions"]) {
  const cache = new Map<string, DiningOptionRecord>();
  let inFlight: Promise<void> | null = null;

  const prime = (value: unknown) => {
    const normalized = normalizeDiningOptionRecord(value);
    if (normalized) {
      cache.set(normalized.guid, normalized);
    }
    if (value && typeof value === "object") {
      const nested = (value as any)?.diningOption;
      if (nested && nested !== value) {
        prime(nested);
      }
    }
  };

  const load = async (env: AppEnv) => {
    if (!fetcher) {
      return;
    }
    if (!inFlight) {
      inFlight = (async () => {
        try {
          const options = await fetcher(env);
          if (Array.isArray(options)) {
            for (const option of options) {
              prime(option);
            }
          }
        } catch {
          // Swallow errors so order processing can continue with fallbacks.
        } finally {
          inFlight = null;
        }
      })();
    }

    if (inFlight) {
      try {
        await inFlight;
      } catch {
        // ignore fetch failures, fallback logic will handle UNKNOWN behavior.
      }
    }
  };

  return {
    prime,
    async resolve(env: AppEnv, guid: string | null): Promise<DiningOptionRecord | null> {
      if (!guid) {
        return null;
      }
      let record = cache.get(guid) ?? null;
      if (!record || !record.behavior) {
        await load(env);
        record = cache.get(guid) ?? record;
      }
      return record ?? null;
    },
  };
}

async function resolveOrderBehavior(
  env: AppEnv,
  order: ToastOrder,
  check: ToastCheck,
  resolver: ReturnType<typeof createDiningOptionResolver>
): Promise<OrderBehaviorMetadata> {
  const candidates = gatherDiningOptionCandidates(order, check);
  let diningOptionGuid: string | null = null;
  let behavior: string | null = null;

  for (const candidate of candidates) {
    resolver.prime(candidate);
    if (!behavior) {
      const candidateBehavior = extractBehaviorString(candidate);
      if (candidateBehavior) {
        behavior = candidateBehavior;
      }
    }
    if (!diningOptionGuid) {
      const normalized = normalizeDiningOptionRecord(candidate);
      if (normalized?.guid) {
        diningOptionGuid = normalized.guid;
        if (!behavior && normalized.behavior) {
          behavior = normalized.behavior;
        }
      }
    }
  }

  let resolvedRecord: DiningOptionRecord | null = null;
  if (diningOptionGuid) {
    resolvedRecord = await resolver.resolve(env, diningOptionGuid);
    if (resolvedRecord) {
      if (!behavior && resolvedRecord.behavior) {
        behavior = resolvedRecord.behavior;
      }
      if (!diningOptionGuid && resolvedRecord.guid) {
        diningOptionGuid = resolvedRecord.guid;
      }
    }
  }

  const normalizedBehavior = mapBehaviorToOrderType(behavior);
  const fallbackType = inferOrderTypeFromContext(order, check);
  const orderType = normalizedBehavior ?? fallbackType ?? "UNKNOWN";

  const enrichment = collectBehaviorEnrichments(order, check, orderType);

  return {
    orderType,
    diningOptionGuid: diningOptionGuid ?? resolvedRecord?.guid ?? null,
    ...enrichment,
  };
}

function collectBehaviorEnrichments(
  order: ToastOrder,
  check: ToastCheck,
  orderType: OrderType
): Partial<Omit<OrderBehaviorMetadata, "orderType" | "diningOptionGuid">> {
  const enrichment: Partial<Omit<OrderBehaviorMetadata, "orderType" | "diningOptionGuid">> = {};

  if (orderType === "DELIVERY") {
    const delivery = extractDeliveryInfo(order, check);
    if (delivery) {
      enrichment.deliveryInfo = delivery;
    }
    const deliveryState = extractDeliveryState(order, check);
    if (deliveryState) {
      enrichment.deliveryState = deliveryState;
    }
  }

  if (orderType === "CURBSIDE") {
    const curbside = extractCurbsidePickupInfo(order, check);
    if (curbside) {
      enrichment.curbsidePickupInfo = curbside;
    }
  }

  if (orderType === "DINE_IN") {
    const dineIn = extractDineInDetails(order, check);
    if (dineIn.table) {
      enrichment.dineInTable = dineIn.table;
    }
    if (dineIn.seats && dineIn.seats.length > 0) {
      enrichment.dineInSeats = dineIn.seats;
    }
    if (dineIn.employee) {
      enrichment.dineInEmployee = dineIn.employee;
    }
  }

  if (orderType === "TAKEOUT") {
    const takeout = extractTakeoutTiming(order, check);
    if (takeout?.promisedDate) {
      enrichment.takeoutPromisedDate = takeout.promisedDate;
    }
    if (takeout?.estimatedFulfillmentDate) {
      enrichment.takeoutEstimatedFulfillmentDate = takeout.estimatedFulfillmentDate;
    }
  }

  return enrichment;
}

function extractDeliveryInfo(order: ToastOrder, check: ToastCheck): Record<string, unknown> | null {
  const info: Record<string, unknown> = {};
  let hasInfo = false;

  const assignString = (key: string, value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (info[key] === undefined) {
      info[key] = trimmed;
      hasInfo = true;
    }
  };

  const assignNumber = (key: string, value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value) && info[key] === undefined) {
      info[key] = value;
      hasInfo = true;
    }
  };

  const addAddress = (source: any) => {
    if (!source || typeof source !== "object") {
      return;
    }
    assignString("address1", source.address1 ?? source.line1 ?? source.street1);
    assignString("address2", source.address2 ?? source.line2 ?? source.street2);
    assignString("city", source.city ?? source.town);
    assignString("state", source.state ?? source.region ?? source.province);
    assignString("zipCode", source.zipCode ?? source.postalCode ?? source.zip ?? source.postcode);
    assignString("country", source.country ?? source.countryCode);
    assignString("administrativeArea", source.administrativeArea ?? source.county);
    assignNumber("latitude", source.latitude);
    assignNumber("longitude", source.longitude);
  };

  const sources: any[] = [];
  const push = (value: any) => {
    if (value && typeof value === "object") {
      sources.push(value);
    }
  };

  push((order as any)?.context?.deliveryInfo);
  push((order as any)?.deliveryInfo);
  push((order as any)?.destination);
  push((order as any)?.shippingAddress);
  push((order as any)?.deliveryDestination);
  push((check as any)?.deliveryInfo);
  push((check as any)?.destination);

  for (const source of sources) {
    assignString("recipientName", source.recipientName ?? source.name ?? source.customerName);
    assignString("instructions", source.instructions ?? source.deliveryInstructions ?? source.dropoffInstructions);
    assignString("notes", source.notes ?? source.deliveryNotes ?? source.customerNotes);
    assignString("status", source.status ?? source.deliveryStatus ?? source.fulfillmentStatus);
    assignString("quotedDeliveryDate", source.quotedDeliveryDate ?? source.quotedDate ?? source.quotedAt);
    assignString("estimatedDeliveryDate", source.estimatedDeliveryDate ?? source.estimatedDate ?? source.estimatedArrivalDate);
    assignString("promisedDate", source.promisedDate ?? source.promisedDeliveryDate);
    assignString("readyDate", source.readyDate ?? source.readyTime);
    assignString("contactPhone", source.contactPhone ?? source.phoneNumber ?? source.customerPhone);
    assignString("contactEmail", source.contactEmail ?? source.email);
    addAddress(source);
    addAddress(source.address);
    addAddress(source.deliveryAddress);
  }

  const timeSources = [order as any, (order as any)?.context, check as any];
  for (const source of timeSources) {
    if (!source) {
      continue;
    }
    assignString("promisedDate", source.promisedDate);
    assignString("estimatedFulfillmentDate", source.estimatedFulfillmentDate);
    assignString("quotedDeliveryDate", source.quotedDeliveryDate);
    assignString("estimatedDeliveryDate", source.estimatedDeliveryDate);
    assignString("readyDate", source.readyDate);
  }

  return hasInfo ? info : null;
}

function extractDeliveryState(order: ToastOrder, check: ToastCheck): string | null {
  const sources = [
    (order as any)?.deliveryInfo,
    (order as any)?.context?.deliveryInfo,
    (check as any)?.deliveryInfo,
  ];

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const state = (source as any)?.deliveryState ?? (source as any)?.state;
    if (typeof state === "string") {
      const trimmed = state.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

function extractCurbsidePickupInfo(order: ToastOrder, check: ToastCheck): Record<string, unknown> | null {
  const sources = [
    (check as any)?.curbsidePickupInfo,
    (order as any)?.curbsidePickupInfo,
    (order as any)?.context?.curbsidePickupInfo,
  ];

  const info: Record<string, unknown> = {};
  let hasInfo = false;

  const assign = (key: string, value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (info[key] === undefined) {
      info[key] = trimmed;
      hasInfo = true;
    }
  };

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    assign("name", source.name);
    assign("transportColor", source.transportColor);
    assign("transportDescription", source.transportDescription ?? source.vehicleDescription);
    assign("vehicleColor", source.vehicleColor ?? source.color);
    assign("vehicleMake", source.vehicleMake ?? source.make);
    assign("vehicleModel", source.vehicleModel ?? source.model);
    assign(
      "licensePlate",
      source.licensePlate ?? source.plateNumber ?? source.vehicleLicensePlate ?? source.plate
    );
    assign("notes", source.notes ?? source.instructions ?? source.comments);
    assign("parkingSpot", source.parkingSpot ?? source.pickupSpot ?? source.spotNumber);
    assign("contactPhone", source.contactPhone ?? source.phoneNumber ?? source.customerPhone);
    const vehicle = (source as any)?.vehicle;
    if (vehicle && typeof vehicle === "object") {
      assign("vehicleColor", vehicle.color ?? vehicle.vehicleColor ?? vehicle.paint);
      assign("vehicleMake", vehicle.make ?? vehicle.brand);
      assign("vehicleModel", vehicle.model ?? vehicle.description);
      assign("licensePlate", vehicle.licensePlate ?? vehicle.plate);
    }
  }

  return hasInfo ? info : null;
}

function extractDineInDetails(
  order: ToastOrder,
  check: ToastCheck
): { table?: Record<string, unknown>; seats?: number[]; employee?: Record<string, unknown> } {
  const result: { table?: Record<string, unknown>; seats?: number[]; employee?: Record<string, unknown> } = {};

  const tableCandidates = [
    (check as any)?.table,
    (order as any)?.table,
    (order as any)?.context?.table,
    (check as any)?.tableAssignment,
  ];
  for (const candidate of tableCandidates) {
    const sanitized = sanitizeReference(candidate);
    if (sanitized) {
      result.table = sanitized;
      break;
    }
  }

  const seatNumbers = new Set<number>();
  const addSeat = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      seatNumbers.add(value);
    }
  };
  const selections = Array.isArray(check.selections) ? check.selections : [];
  for (const selection of selections) {
    addSeat((selection as any)?.seatNumber);
  }
  const explicitSeats = Array.isArray((check as any)?.seatNumbers) ? (check as any).seatNumbers : [];
  for (const seat of explicitSeats) {
    addSeat(seat);
  }
  if (seatNumbers.size > 0) {
    result.seats = Array.from(seatNumbers).sort((a, b) => a - b);
  }

  const employeeCandidates: unknown[] = [
    (check as any)?.openedBy,
    (check as any)?.server,
    (check as any)?.owner,
    (order as any)?.openedBy,
    (order as any)?.createdBy,
    (order as any)?.server,
  ];
  const employeeArrays = [
    (check as any)?.servers,
    (check as any)?.employees,
    (order as any)?.servers,
    (order as any)?.employees,
  ];
  for (const collection of employeeArrays) {
    if (Array.isArray(collection)) {
      for (const candidate of collection) {
        employeeCandidates.push(candidate);
      }
    }
  }

  for (const candidate of employeeCandidates) {
    const sanitized = sanitizeReference(candidate, [
      "employeeNumber",
      "employeeId",
      "displayName",
      "id",
      "externalEmployeeId",
    ]);
    if (sanitized) {
      result.employee = sanitized;
      break;
    }
  }

  return result;
}

function extractTakeoutTiming(
  order: ToastOrder,
  check: ToastCheck
): { promisedDate?: string; estimatedFulfillmentDate?: string } | null {
  const data: { promisedDate?: string; estimatedFulfillmentDate?: string } = {};
  const assign = (key: "promisedDate" | "estimatedFulfillmentDate", value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (data[key] === undefined) {
      data[key] = trimmed;
    }
  };

  assign("promisedDate", (check as any)?.promisedDate);
  assign("promisedDate", (order as any)?.promisedDate);
  assign("promisedDate", (order as any)?.context?.promisedDate);
  assign("promisedDate", (order as any)?.expectedReadyDate);

  assign("estimatedFulfillmentDate", (check as any)?.estimatedFulfillmentDate);
  assign("estimatedFulfillmentDate", (order as any)?.estimatedFulfillmentDate);
  assign("estimatedFulfillmentDate", (order as any)?.context?.estimatedFulfillmentDate);
  assign("estimatedFulfillmentDate", (order as any)?.readyDate);

  return Object.keys(data).length > 0 ? data : null;
}

function gatherDiningOptionCandidates(order: ToastOrder, check: ToastCheck): unknown[] {
  const values: unknown[] = [];
  const push = (...items: unknown[]) => {
    for (const item of items) {
      if (item !== undefined && item !== null) {
        values.push(item);
      }
    }
  };

  push(
    (check as any)?.diningOption,
    (check as any)?.diningOptionInfo,
    (order as any)?.diningOption,
    (order as any)?.context?.diningOption,
    (order as any)?.context?.diningOptionInfo,
    (order as any)?.source?.diningOption,
    (order as any)?.fulfillment?.diningOption
  );
  push((check as any)?.diningOptionGuid, (order as any)?.diningOptionGuid, (order as any)?.context?.diningOptionGuid);

  return values;
}

function normalizeDiningOptionRecord(value: unknown): DiningOptionRecord | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (looksLikeGuid(trimmed)) {
      return { guid: trimmed, behavior: null, name: null };
    }
    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const obj = value as any;

  if (obj?.diningOption && obj.diningOption !== value) {
    const nested = normalizeDiningOptionRecord(obj.diningOption);
    if (nested) {
      return nested;
    }
  }

  const guidCandidates = [obj.guid, obj.diningOptionGuid, obj.optionGuid, obj.id];
  let guid: string | null = null;
  for (const candidate of guidCandidates) {
    if (typeof candidate === "string" && looksLikeGuid(candidate)) {
      guid = candidate.trim();
      break;
    }
  }

  if (!guid) {
    return null;
  }

  const behaviorCandidates = [
    obj.behavior,
    obj.diningOptionBehavior,
    obj.optionBehavior,
    obj.type,
    obj.mode,
    obj.behaviour,
  ];
  let behavior: string | null = null;
  for (const candidate of behaviorCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      behavior = candidate.trim();
      break;
    }
  }

  const nameCandidates = [obj.name, obj.displayName, obj.label, obj.diningOptionName];
  let name: string | null = null;
  for (const candidate of nameCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      name = candidate.trim();
      break;
    }
  }

  return { guid, behavior, name };
}

function looksLikeGuid(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (!/[0-9-]/.test(trimmed)) {
    return false;
  }
  return /^[0-9a-zA-Z-]+$/.test(trimmed);
}

function extractBehaviorString(candidate: unknown): string | null {
  if (!candidate) {
    return null;
  }
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = normalizeOrderType(trimmed);
    return normalized ? trimmed : null;
  }
  if (typeof candidate !== "object") {
    return null;
  }
  const obj = candidate as any;
  const behaviorCandidates = [
    obj.behavior,
    obj.diningOptionBehavior,
    obj.optionBehavior,
    obj.type,
    obj.mode,
    obj.behaviour,
  ];
  for (const value of behaviorCandidates) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      const normalized = normalizeOrderType(trimmed);
      if (normalized) {
        return trimmed;
      }
    }
  }
  return null;
}

function mapBehaviorToOrderType(behavior: string | null): OrderType | null {
  if (!behavior) {
    return null;
  }
  return normalizeOrderType(behavior);
}

function sanitizeReference(value: unknown, extraKeys: string[] = []): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? { name: trimmed } : null;
  }
  if (typeof value !== "object") {
    return null;
  }

  const baseKeys = new Set(["guid", "name", "externalId", "entityType", "displayName", "id"]);
  for (const key of extraKeys) {
    baseKeys.add(key);
  }

  const output: Record<string, unknown> = {};
  for (const key of baseKeys) {
    const candidate = (value as any)[key];
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) {
        output[key] = trimmed;
      }
    }
  }

  return Object.keys(output).length > 0 ? output : null;
}

function inferOrderTypeFromContext(order: ToastOrder, check: ToastCheck): OrderType {
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
