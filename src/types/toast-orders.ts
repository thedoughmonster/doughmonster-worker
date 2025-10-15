import type {
  ToastConfigReference,
  ToastExternalReference,
  ToastNullableDateTime,
  ToastReference,
} from "./toast-common.js";

/**
 * Lightweight TypeScript representations of the Toast Orders API schema.
 *
 * The structures expose the core fields referenced within the worker while
 * still allowing access to the rich objects returned by the API. When you need
 * an additional property, consult `src/schemas/toast-orders-api.yaml` and extend
 * the relevant type instead of using `any`.
 */

export interface ToastOrder extends ToastExternalReference {
  openedDate?: ToastNullableDateTime;
  modifiedDate?: ToastNullableDateTime;
  promisedDate?: ToastNullableDateTime;
  channelGuid?: string | null;
  diningOption: ToastExternalReference;
  checks: ToastCheck[];
  table?: ToastExternalReference | null;
  serviceArea?: ToastExternalReference | null;
  restaurantService?: ToastExternalReference | null;
  revenueCenter?: ToastExternalReference | null;
  source?: string | null;
  duration?: number | null;
  deliveryInfo?: ToastDeliveryInfo | null;
  requiredPrepTime?: string | null;
  estimatedFulfillmentDate?: ToastNullableDateTime;
  numberOfGuests?: number | null;
  voided?: boolean;
  voidDate?: ToastNullableDateTime;
  voidBusinessDate?: number | null;
  paidDate?: ToastNullableDateTime;
  closedDate?: ToastNullableDateTime;
  deletedDate?: ToastNullableDateTime;
  deleted?: boolean;
  appliedLoyaltyInfo?: ToastAppliedLoyaltyInfo | null;
  appliedPackagingInfo?: ToastAppliedPackagingInfo | null;
  appliedDiscounts?: ToastAppliedDiscount[];
  appliedServiceCharges?: ToastAppliedServiceCharge[];
  payments?: ToastPayment[];
  customers?: ToastCustomer[];
  employee?: ToastExternalReference | null;
  [key: string]: unknown;
}

export interface ToastCheck extends ToastExternalReference {
  createdDate?: ToastNullableDateTime;
  openedDate?: ToastNullableDateTime;
  closedDate?: ToastNullableDateTime;
  modifiedDate?: ToastNullableDateTime;
  deletedDate?: ToastNullableDateTime;
  deleted?: boolean;
  taxExempt?: boolean;
  displayNumber?: string | null;
  selections: ToastSelection[];
  customer?: ToastCustomer | null;
  appliedLoyaltyInfo?: ToastAppliedLoyaltyInfo | null;
  appliedServiceCharges?: ToastAppliedServiceCharge[];
  amount?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  payments?: ToastPayment[];
  tabName?: string | null;
  paymentStatus?: "OPEN" | "PAID" | "CLOSED" | null;
  appliedDiscounts?: ToastAppliedDiscount[];
  voided?: boolean;
  voidDate?: ToastNullableDateTime;
  voidBusinessDate?: number | null;
  paidDate?: ToastNullableDateTime;
  createdDevice?: ToastDevice | null;
  lastModifiedDevice?: ToastDevice | null;
  duration?: number | null;
  openedBy?: ToastExternalReference | null;
  [key: string]: unknown;
}

export interface ToastSelection extends ToastExternalReference {
  item: ToastConfigReference | null;
  itemGroup: ToastConfigReference | null;
  optionGroup?: ToastConfigReference | null;
  preModifier?: ToastConfigReference | null;
  quantity: number;
  unitOfMeasure?: "NONE" | "LB" | "OZ" | "KG" | "G" | null;
  selectionType?:
    | "NONE"
    | "OPEN_ITEM"
    | "SPECIAL_REQUEST"
    | "PORTION"
    | "HOUSE_ACCOUNT_PAY_BALANCE"
    | "TOAST_CARD_SELL"
    | "TOAST_CARD_RELOAD"
    | null;
  modifiers?: ToastSelection[];
  appliedDiscounts?: ToastAppliedDiscount[];
  appliedServiceCharges?: ToastAppliedServiceCharge[];
  appliedTaxes?: ToastAppliedTaxRate[];
  fireStatus?: "NEW" | "HOLD" | "SENT" | "READY" | null;
  priceLevelGuid?: string | null;
  externalPriceAmount?: number | null;
  receiptLinePrice?: number | null;
  taxInclusion?: "INCLUDED" | "NOT_INCLUDED" | "INHERITED" | null;
  [key: string]: unknown;
}

export interface ToastPayment extends ToastReference {
  paymentType?: string | null;
  amount?: number | null;
  tipAmount?: number | null;
  cardType?: string | null;
  cardEntryMode?: string | null;
  last4?: string | null;
  authorizations?: ToastPaymentAuthorization[];
  tenders?: ToastTender[];
  [key: string]: unknown;
}

export interface ToastPaymentAuthorization {
  guid?: string;
  status?: string;
  amount?: number;
  tipAmount?: number | null;
  authorizedDate?: ToastNullableDateTime;
  [key: string]: unknown;
}

export interface ToastTender extends ToastReference {
  amount?: number | null;
  tipAmount?: number | null;
  externalPaymentReference?: string | null;
  [key: string]: unknown;
}

export interface ToastAppliedDiscount extends ToastExternalReference {
  discountAmount?: number | null;
  percentage?: number | null;
  name?: string | null;
  [key: string]: unknown;
}

export interface ToastAppliedServiceCharge extends ToastExternalReference {
  amount?: number | null;
  percentage?: number | null;
  taxable?: boolean;
  [key: string]: unknown;
}

export interface ToastAppliedTaxRate extends ToastExternalReference {
  amount?: number | null;
  rate?: number | null;
  taxableAmount?: number | null;
  [key: string]: unknown;
}

export interface ToastAppliedLoyaltyInfo extends ToastReference {
  loyaltyIdentifier: string;
  maskedLoyaltyIdentifier?: string | null;
  vendor: "TOAST" | "PUNCHH" | "PUNCHH2" | "PAYTRONIX" | "APPFRONT" | "INTEGRATION";
  accrualFamilyGuid?: string | null;
  accrualText?: string | null;
  [key: string]: unknown;
}

export interface ToastDeliveryInfo {
  diningBehavior?: string | null;
  deliveryStatus?: string | null;
  deliveryAddress?: ToastAddress | null;
  specialInstructions?: string | null;
  [key: string]: unknown;
}

export interface ToastAppliedPackagingInfo extends ToastReference {
  appliedPackagingItems: ToastAppliedPackagingItem[];
  [key: string]: unknown;
}

export interface ToastAppliedPackagingItem extends ToastReference {
  itemConfigId: string;
  inclusion: "NONE" | "INCLUDE" | "EXCLUDE";
  quantity?: number | null;
  [key: string]: unknown;
}

export interface ToastCustomer extends ToastReference {
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  [key: string]: unknown;
}

export interface ToastDevice extends ToastReference {
  name?: string | null;
  serialNumber?: string | null;
  [key: string]: unknown;
}

export interface ToastAddress {
  streetAddress?: string | null;
  streetAddress2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  [key: string]: unknown;
}

export type ToastOrdersBulkEnvelope = {
  orders?: ToastOrder[];
  totalCount?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  nextPage?: number | null;
  [key: string]: unknown;
};

export type ToastOrdersBulkResponse = ToastOrder[] | ToastOrdersBulkEnvelope | null;
