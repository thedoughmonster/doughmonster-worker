import type { ToastCheck, ToastOrder, ToastSelection } from "../../types/toast-orders.js";
import type { OrderType } from "./types-local.js";

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

export function extractOrderMeta(order: ToastOrder, check: ToastCheck) {
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

export function collectSeats(order: ToastOrder, check: ToastCheck): number[] {
  const seats = new Set<number>();
  for (const path of ORDER_SEAT_FIELDS) {
    const value = getValue(order, check, path);
    if (!Array.isArray(value)) continue;
    for (const seat of value) if (typeof seat === "number" && Number.isFinite(seat)) seats.add(seat);
  }
  return Array.from(seats).sort((a, b) => a - b);
}

export function buildCustomerName(customer: unknown): string | null {
  if (!customer) return null;
  if (typeof customer === "string") {
    const trimmed = customer.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof customer !== "object") return null;

  const direct = firstNonEmpty(
    (customer as any)?.displayName,
    (customer as any)?.name,
    (customer as any)?.fullName,
    (customer as any)?.customerName,
    (customer as any)?.guestName,
    (customer as any)?.nickname,
    (customer as any)?.alias
  );
  if (direct) return direct;

  const first = typeof (customer as any)?.firstName === "string" ? (customer as any).firstName.trim() : "";
  const last = typeof (customer as any)?.lastName === "string" ? (customer as any).lastName.trim() : "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  const alt = firstNonEmpty((customer as any)?.givenName, (customer as any)?.familyName);
  if (alt) return alt;

  return null;
}

export function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    }
  }
  return null;
}

export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function extractCustomerName(order: ToastOrder, check: ToastCheck): string | null {
  const fromCheck = buildCustomerName((check as any)?.customer);
  if (fromCheck) return fromCheck;

  for (const customer of Array.isArray((order as any)?.customers) ? (order as any).customers : []) {
    const name = buildCustomerName(customer);
    if (name) return name;
  }

  const fallbackCandidates: Array<string | null> = [
    normalizeName((check as any)?.tabName),
    normalizeName((check as any)?.guestName),
    normalizeName((order as any)?.guestName),
    normalizeName((order as any)?.tabName),
  ];

  fallbackCandidates.push(
    normalizeName((order as any)?.context?.customerName),
    normalizeName((order as any)?.customerName),
    normalizeName((order as any)?.source?.customerName),
    normalizeName((order as any)?.context?.curbsidePickupInfo?.name)
  );

  const fromDirectFields = fallbackCandidates.find((value) => typeof value === "string" && value) ?? null;
  if (fromDirectFields) return fromDirectFields;

  const deliveryBlocks: any[] = [
    (order as any)?.context?.deliveryInfo,
    (order as any)?.deliveryInfo,
    (check as any)?.deliveryInfo,
    (order as any)?.destination,
    (order as any)?.shippingAddress,
    (order as any)?.deliveryDestination
  ].filter(Boolean);

  for (const block of deliveryBlocks) {
    const recipient = firstNonEmpty(block?.recipientName, block?.name, block?.customerName);
    if (recipient) return recipient;
  }

  const guests = Array.isArray((check as any)?.guests) ? (check as any).guests : [];
  for (const g of guests) {
    const name = buildCustomerName(g);
    if (name) return name;
  }

  const fromLastResort = firstNonEmpty(
    (check as any)?.curbsidePickupInfo?.name,
    (order as any)?.context?.curbsidePickupInfo?.name,
    (order as any)?.context?.pickupName,
    (order as any)?.source?.customerName
  );
  if (fromLastResort) return fromLastResort;

  const firstSelection = Array.isArray((check as any)?.selections)
    ? (check as any).selections.find((selection: unknown) => selection && typeof selection === "object")
    : undefined;
  const specialInstructions = normalizeName((firstSelection as any)?.specialInstructions);
  if (specialInstructions) {
    const match = specialInstructions.match(/\b(?:for|pickup|name)\b[: ]+([^\.\n\r]+)/i);
    if (match) {
      const extracted = normalizeName(match[1]);
      if (extracted) return extracted;
    }
  }

  return null;
}

export function pickString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function pickStringPaths(order: ToastOrder, check: ToastCheck, paths: string[]): string | null {
  for (const path of paths) {
    const value = getValue(order, check, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function pickObjectPaths(order: ToastOrder, check: ToastCheck, paths: string[]): Record<string, unknown> | null {
  for (const path of paths) {
    const value = getValue(order, check, path);
    if (value && typeof value === "object") return value as Record<string, unknown>;
  }
  return null;
}

export function getValue(order: ToastOrder, check: ToastCheck, path: string): any {
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

export function extractNumber(source: any, fields: string[]): number | null {
  for (const field of fields) {
    const value = getNestedValue(source, field);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function extractTimestamp(source: any, fields: string[]): { iso: string; ms: number | null } | null {
  for (const field of fields) {
    const value = getNestedValue(source, field);
    if (typeof value === "string" && value) {
      const parsed = parseToastTimestamp(value);
      if (parsed !== null) return { iso: value, ms: parsed };
    }
  }
  return null;
}

export function getNestedValue(source: any, path: string): unknown {
  if (!source) return undefined;
  if (!path.includes(".")) return source[path];
  let current = source;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

export function normalizeQuantity(quantity: unknown): number {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) return 1;
  return Math.max(1, Math.round(quantity));
}

export function parseToastTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

export function resolveLineItemId(orderId: string, checkId: string | null, selection: ToastSelection, index: number): string | null {
  if (typeof selection.guid === "string" && selection.guid.trim()) return selection.guid;
  const itemGuid = pickString([(selection as any)?.item?.guid]);
  if (itemGuid) return `${orderId}:${checkId ?? ""}:item:${itemGuid}:${index}`;
  const receipt = extractNumber(selection as any, ["receiptLinePosition"]);
  if (receipt !== null) return `${orderId}:${checkId ?? ""}:receipt:${receipt}`;
  return `${orderId}:${checkId ?? ""}:open:${index}`;
}

export function resolveOrderType(order: ToastOrder, check: ToastCheck): OrderType {
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

export function normalizeOrderType(value: unknown): OrderType | null {
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

export function getSpecialRequest(selection: ToastSelection, itemName: string): string | null {
  if (getSelectionType(selection) !== "SPECIAL_REQUEST") return null;
  const display = pickString([(selection as any)?.displayName]);
  return display && display !== itemName ? display : null;
}

export function getSelectionType(selection: ToastSelection): string {
  const raw = (selection as any)?.selectionType ?? selection.selectionType;
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "_") : "";
}

export function getItemType(selection: ToastSelection): string {
  const raw = (selection as any)?.item?.itemType ?? (selection as any)?.item?.type;
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "_") : "";
}

export function isVoided(entity: unknown): boolean {
  return Boolean((entity as any)?.voided || (entity as any)?.deleted);
}
