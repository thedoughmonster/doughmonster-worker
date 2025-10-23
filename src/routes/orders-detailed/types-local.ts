import type { ToastMenusDocument } from "../../types/toast-menus.js";
import type { ToastCheck, ToastOrder, ToastSelection } from "../../types/toast-orders.js";

export interface UpstreamTrace {
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

export type ItemFulfillmentStatus = "NEW" | "HOLD" | "SENT" | "READY";

type OrdersLatestWindow = { start?: string | null; end?: string | null };

interface OrdersLatestBaseSuccess {
  ok: true;
  detail?: "ids" | "full";
  ids?: string[];
  window?: OrdersLatestWindow;
}

export interface OrdersLatestSuccessFull extends OrdersLatestBaseSuccess {
  detail?: "full";
  data?: ToastOrder[];
  orders?: ToastOrder[];
}

export interface OrdersLatestSuccessIds extends OrdersLatestBaseSuccess {
  detail: "ids";
  data?: undefined;
  orders?: string[];
}

export type OrdersLatestSuccessResponse = OrdersLatestSuccessFull | OrdersLatestSuccessIds;

export type OrdersLatestResponse =
  | OrdersLatestSuccessResponse
  | { ok: false; error?: { message?: string } | string | null };

export type MenusResponse =
  | { ok: true; menu: ToastMenusDocument | null; metadata?: { lastUpdated?: string | null }; cacheHit?: boolean }
  | { ok: false; error?: { message?: string } | string | null };

export interface ExpandedOrderItemModifier {
  id: string | null;
  name: string;
  groupName?: string | null;
  priceCents: number;
  quantity: number;
}

export interface ExpandedOrderItemMoney {
  baseItemPriceCents?: number;
  modifierTotalCents?: number;
  totalItemPriceCents?: number;
}

export interface ExpandedOrderItem {
  lineItemId: string;
  menuItemId?: string | null;
  itemName: string;
  quantity: number;
  fulfillmentStatus?: string | null;
  modifiers: ExpandedOrderItemModifier[];
  specialInstructions?: string | null;
  money?: ExpandedOrderItemMoney;
}

export type NormalizedOrderType =
  | "TAKEOUT"
  | "DELIVERY"
  | "DINE_IN"
  | "CURBSIDE"
  | "DRIVE_THRU"
  | "CATERING"
  | "UNKNOWN";

export type OrderType = NormalizedOrderType | string;

export interface ExpandedOrder {
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
    orderTypeNormalized?: NormalizedOrderType | null;
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

export interface DiagnosticsCounters {
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

export type FetchResult<T> =
  | { ok: true; data: T; trace: UpstreamTrace }
  | { ok: false; error: Error; trace: UpstreamTrace };

export interface MenuFetchData {
  payload: MenusResponse;
  document: ToastMenusDocument | null;
  cacheStatus: string | null;
  updatedAt: string | null;
}

export interface RawModifier {
  id: string | null;
  name: string;
  groupName: string | null;
  priceCents: number;
  quantity: number;
  unitPriceCents: number | null;
}

export interface ItemSortMeta {
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
