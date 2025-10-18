import type { ToastCheck, ToastOrder, ToastSelection } from "../../types/toast-orders.js";
import { extractNumber, getItemType, getSelectionType, pickStringPaths } from "./extractors.js";
import type { ItemFulfillmentStatus } from "./types-local.js";

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
const DISALLOWED_ITEM_TYPES = new Set(["SPECIAL_REQUEST", "NOTE", "TEXT", "FEE", "SURCHARGE", "SERVICE_CHARGE", "TIP", "TAX"]);
const ALLOWED_ITEM_TYPES = new Set(["MENU_ITEM", "ITEM", "ENTREE", "PRODUCT", "OPEN_ITEM", "RETAIL", "RETAIL_ITEM", "BEVERAGE"]);

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

export function normalizeItemFulfillmentStatus(value: unknown): ItemFulfillmentStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized === "NEW" || normalized === "HOLD" || normalized === "SENT" || normalized === "READY"
    ? (normalized as ItemFulfillmentStatus)
    : null;
}

export function resolveFulfillmentStatus(
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

export function isLineItem(selection: ToastSelection): boolean {
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
