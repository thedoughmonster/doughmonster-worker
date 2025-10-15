import type { AppEnv } from "../config/env.js";
import { getOrdersBulk, getPublishedMenus } from "../clients/toast.js";
import { jsonResponse } from "../lib/http.js";
import type { ToastMenuItem, ToastMenusDocument, ToastModifierOption } from "../types/toast-menus.js";
import type { ToastCheck, ToastOrder, ToastSelection } from "../types/toast-orders.js";

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const PAGE_SIZE = 100;

export interface ItemsExpandedDeps {
  getOrdersBulk: typeof getOrdersBulk;
  getPublishedMenus: typeof getPublishedMenus;
}

export interface ExpandedItem {
  orderId: string;
  orderNumber?: string | null;
  checkId?: string | null;
  lineItemId: string;
  menuItemId?: string | null;
  order: {
    customerName?: string | null;
    locationId?: string | null;
    status?: string | null;
  };
  times: { orderTime: string; timeDue?: string | null };
  item: {
    itemName: string;
    itemModifiers: string[];
    quantity: 1;
    specialInstructions?: string | null;
  };
  money?: { itemPrice?: number | null; currency?: string | null };
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

      const expanded: ExpandedItem[] = [];
      let page = 1;

      while (expanded.length < limit) {
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

          const timeDue = extractOrderDueTime(order);
          const orderNumber = extractOrderNumber(order);
          const locationId = extractOrderLocation(order);
          const orderStatus = extractOrderStatus(order);
          const orderCurrency = extractOrderCurrency(order);

          for (const check of Array.isArray(order.checks) ? order.checks : []) {
            if (!check || typeof check.guid !== "string") {
              continue;
            }

            const customerName = extractCustomerName(order, check);

            for (const selection of Array.isArray(check.selections) ? check.selections : []) {
              if (!selection || typeof selection.guid !== "string") {
                continue;
              }

              if (!isLineItem(selection)) {
                continue;
              }

              const menuItem = menuIndex.findItem(selection.item);
              const itemName =
                getKitchenTicketName(menuItem) ??
                getSelectionDisplayName(selection) ??
                selection.item?.guid ??
                "Unknown item";

              const modifiers = collectModifierNames(selection, menuIndex);
              const specialInstructions = extractSpecialInstructions(selection, itemName);
              const unitPrice = extractReceiptLinePrice(selection);
              const menuItemId = selection.item?.guid ?? null;

              const quantity = normalizeQuantity(selection.quantity);

              for (let i = 0; i < quantity && expanded.length < limit; i += 1) {
                const item: ExpandedItem = {
                  orderId: order.guid,
                  orderNumber,
                  checkId: check.guid ?? null,
                  lineItemId: selection.guid,
                  menuItemId,
                  order: {
                    customerName,
                    locationId,
                    status: orderStatus,
                  },
                  times: { orderTime, timeDue },
                  item: {
                    itemName,
                    itemModifiers: modifiers,
                    quantity: 1,
                    specialInstructions,
                  },
                  money: unitPrice !== null || orderCurrency
                    ? { itemPrice: unitPrice, currency: orderCurrency }
                    : undefined,
                };

                if (!item.item.specialInstructions) {
                  delete item.item.specialInstructions;
                }

                if (!item.money) {
                  delete item.money;
                }

                expanded.push(item);
              }

              if (expanded.length >= limit) {
                break;
              }
            }

            if (expanded.length >= limit) {
              break;
            }
          }

          if (expanded.length >= limit) {
            break;
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

      return jsonResponse({ items: expanded });
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
      if (modifier?.guid) {
        modifiersByGuid.set(modifier.guid, modifier);
      }
      const multi = (modifier as any)?.multiLocationId;
      if (multi) {
        modifiersByMulti.set(String(multi), modifier);
      }
      const referenceId = (modifier as any)?.referenceId;
      if (referenceId !== undefined && referenceId !== null) {
        modifiersByReference.set(referenceId, modifier);
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
        if (item?.guid) {
          itemsByGuid.set(item.guid, item);
        }
        const multi = (item as any)?.multiLocationId;
        if (multi) {
          itemsByMulti.set(String(multi), item);
        }
        const referenceId = (item as any)?.referenceId;
        if (referenceId !== undefined && referenceId !== null) {
          itemsByReference.set(referenceId, item);
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

function orderMatches(order: ToastOrder, locationId: string | null, status: string | null): boolean {
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

function extractOrderTime(order: ToastOrder): string | null {
  const candidates = [order.createdDate, order.openedDate, order.modifiedDate];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }
  return null;
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
  return null;
}

function buildCustomerName(customer: unknown): string | null {
  if (!customer) {
    return null;
  }

  const first = typeof (customer as any)?.firstName === "string" ? (customer as any).firstName : "";
  const last = typeof (customer as any)?.lastName === "string" ? (customer as any).lastName : "";
  const combined = `${first} ${last}`.trim();

  if (combined) {
    return combined;
  }

  if (typeof (customer as any)?.name === "string" && (customer as any).name) {
    return (customer as any).name;
  }

  return null;
}

function isLineItem(selection: ToastSelection): boolean {
  const selectionType = selection.selectionType ?? (selection as any)?.selectionType;
  return selectionType !== "SPECIAL_REQUEST";
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

function collectModifierNames(selection: ToastSelection, menuIndex: ReturnType<typeof createMenuIndex>): string[] {
  const names: string[] = [];
  const modifiers = Array.isArray(selection.modifiers) ? selection.modifiers : [];

  for (const modifier of modifiers) {
    if (!modifier) {
      continue;
    }

    const base = menuIndex.findModifier(modifier.item);
    const display = getKitchenTicketName(base) ?? getSelectionDisplayName(modifier) ?? modifier.item?.guid;

    const quantity = normalizeQuantity(modifier.quantity);

    if (display) {
      for (let i = 0; i < quantity; i += 1) {
        names.push(display);
      }
    }

    if (modifier.modifiers && modifier.modifiers.length > 0) {
      names.push(...collectModifierNames(modifier, menuIndex));
    }
  }

  return names;
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

  const display = getSelectionDisplayName(selection);
  if (display && display !== itemName) {
    return display;
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
