/**
 * Toast platform entity reference with a GUID and optional type discriminator.
 * Derived from the Orders API `ToastReference` definition.
 */
export interface ToastReference {
  /** Toast-maintained GUID. */
  guid: string;
  /** Type of referenced entity (response-only discriminator). */
  entityType?: string;
}

/**
 * Reference wrapper that adds an external identifier. Mirrors the Orders API `ExternalReference` schema.
 */
export interface ToastExternalReference extends ToastReference {
  /** External identifier prefixed by the naming authority. */
  externalId?: string | null;
}

/**
 * Reference wrapper with menu configuration metadata (Orders API `ConfigReference`).
 */
export interface ToastConfigReference extends ToastReference {
  /** Multilocation identifier shared across restaurant locations. */
  multiLocationId?: string | null;
  /** Deprecated external identifier (may be omitted in modern payloads). */
  externalId?: string | null;
}

/**
 * Toast POS device identifier (`Device` in the Orders API).
 */
export interface ToastDevice {
  /** Physical Toast POS device identifier. */
  id?: string | null;
}

/**
 * Delivery destination metadata for delivery dining options (Orders API `DeliveryInfo`).
 */
export interface ToastDeliveryInfo {
  /** First line of the delivery street address. */
  address1: string;
  /** Second line of the delivery street address. */
  address2?: string;
  /** City or town for the delivery destination. */
  city: string;
  /** Optional geographic administrative area (county, region, etc.). */
  administrativeArea?: string;
  /** Two-letter ISO 3166-2 state or province code. */
  state: string;
  /** Postal or ZIP code for the delivery destination. */
  zipCode: string;
  /** Two-letter ISO 3166-2 country code. */
  country?: string;
  /** Latitude of the delivery destination in decimal degrees. */
  latitude?: number;
  /** Longitude of the delivery destination in decimal degrees. */
  longitude?: number;
  /** Additional delivery instructions supplied by the guest. */
  notes?: string;
  /** Timestamp when staff marked the order as delivered (response only). */
  deliveredDate?: string;
  /** Timestamp when the order was dispatched for delivery. */
  dispatchedDate?: string;
  /** Employee assigned to deliver the order. */
  deliveryEmployee?: ToastExternalReference;
  /** Toast internal delivery state enumeration. */
  deliveryState?: "PENDING" | "IN_PROGRESS" | "PICKED_UP" | "DELIVERED";
}

/**
 * Guest curbside pickup identifiers (Orders API `CurbsidePickupInfo`).
 */
export interface ToastCurbsidePickupInfo extends ToastReference {
  /** Vehicle color supplied by the guest. */
  transportColor?: string;
  /** Description of the vehicle or arrival method. */
  transportDescription?: string;
  /** Free-form additional notes. */
  notes?: string;
}

/**
 * Refund metadata applied to selections, modifiers, or service charges.
 */
export interface ToastRefundDetails {
  /** Refunded amount before tax (includes nested modifier upcharges). */
  refundAmount?: number;
  /** Refunded tax amount. */
  taxRefundAmount?: number;
  /** Refunded tip amount. */
  tipRefundAmount?: number;
  /** Identifier linking refund transactions across entities. */
  refundTransaction?: ToastReference;
}

/**
 * Loyalty program application metadata (`AppliedLoyaltyInfo`).
 */
export interface ToastAppliedLoyaltyInfo extends ToastReference {
  /** Loyalty account identifier transmitted to the program provider. */
  loyaltyIdentifier: string;
  /** Securely displayable identifier value (for example, masked card number). */
  maskedLoyaltyIdentifier?: string;
  /** Loyalty program vendor backing the identifier. */
  vendor: "TOAST" | "PUNCHH" | "PUNCHH2" | "PAYTRONIX" | "APPFRONT" | "INTEGRATION";
  /** Internal Toast accrual identifier (response only). */
  accrualFamilyGuid?: string;
  /** Receipt description for the loyalty transaction (response only). */
  accrualText?: string;
}

/**
 * Applied service charge details for a check (`AppliedServiceCharge`).
 */
export interface ToastAppliedServiceCharge extends ToastExternalReference {
  /** Final service charge amount excluding tax. */
  chargeAmount?: number;
  /** Reference to the configured service charge definition. */
  serviceCharge: ToastExternalReference;
  /** Service charge calculation mode (response only). */
  chargeType?: "FIXED" | "PERCENT" | "OPEN";
  /** Human-readable label configured for the service charge (response only). */
  name?: string;
  /** Indicates delivery-specific service charge (response only). */
  delivery?: boolean;
  /** Indicates takeout-specific service charge (response only). */
  takeout?: boolean;
  /** Indicates dine-in-specific service charge (response only). */
  dineIn?: boolean;
  /** Indicates gratuity service charge (response only). */
  gratuity?: boolean;
  /** Indicates taxability of the service charge (response only). */
  taxable?: boolean;
  /** Taxes applied to the service charge. */
  appliedTaxes?: ToastAppliedTaxRate[];
  /** Defines whether percentage charges apply pre- or post-discount. */
  serviceChargeCalculation?: "PRE_DISCOUNT" | "POST_DISCOUNT";
  /** Refund metadata for the applied service charge. */
  refundDetails?: ToastRefundDetails;
  /** Categorization configured in Toast (response only). */
  serviceChargeCategory?: string;
}

/**
 * Applied discount details (`AppliedDiscount`).
 */
export interface ToastAppliedDiscount extends ToastExternalReference {
  /** Reference to the originating discount configuration. */
  discount?: ToastReference;
  /** Discount amount applied at the check or item level. */
  amount?: number;
  /** Percentage discount applied. */
  percentage?: number;
  /** Optional reason metadata returned by Toast. */
  reason?: ToastAppliedDiscountReason;
  /** Optional trigger metadata returned by Toast. */
  trigger?: ToastAppliedDiscountTrigger;
}

/** Reason metadata for applied discounts. */
export interface ToastAppliedDiscountReason extends ToastReference {
  /** Textual description explaining why the discount applied. */
  description?: string;
}

/** Trigger metadata for applied discounts. */
export interface ToastAppliedDiscountTrigger extends ToastReference {
  /** Programmatic identifier describing the trigger. */
  triggerType?: string;
}

/**
 * Customer information attached to a check (`Customer`).
 */
export interface ToastCustomer extends ToastReference {
  /** Guest first name. */
  firstName: string;
  /** Guest last name. */
  lastName: string;
  /** Guest email address. */
  email: string;
  /** Guest primary phone number. */
  phone: string;
  /** International phone country code. */
  phoneCountryCode?: string;
}

/**
 * Toast payment data for a check (`Payment`).
 */
export interface ToastPayment extends ToastExternalReference {
  /** Date the payment was made. */
  paidDate?: string;
  /** Business date (yyyyMMdd) the payment was first applied (response only). */
  paidBusinessDate?: number;
  /** Payment method used. */
  type: "CASH" | "CREDIT" | "GIFTCARD" | "HOUSE_ACCOUNT" | "REWARDCARD" | "LEVELUP" | "TOAST_SV" | "OTHER" | "UNDETERMINED";
  /** Tip amount on the payment. */
  tipAmount: number;
  /** Currency amount tendered excluding tips. */
  amount: number;
  /** Amount tendered for the payment (exclusive of tips). */
  amountTendered?: number;
  /** How the card data was captured (response only). */
  cardEntryMode?:
    | "SWIPED"
    | "KEYED"
    | "ONLINE"
    | "EMV_CHIP_SIGN"
    | "TOKENIZED"
    | "PRE_AUTHED"
    | "SAVED_CARD"
    | "FUTURE_ORDER"
    | "CONTACTLESS"
    | "APPLE_PAY_CNP"
    | "GOOGLE_PAY_CNP"
    | "INCREMENTAL_PRE_AUTHED"
    | "PARTNER_ECOM_COF"
    | "CLICK_TO_PAY_CNP";
  /** Toast-classified refund status for the payment (response only). */
  refundStatus?: "NONE" | "PARTIAL" | "FULL";
  /** Toast POS device that created the payment. */
  createdDevice?: ToastDevice;
  /** Toast POS device that last modified the payment. */
  lastModifiedDevice?: ToastDevice;
  /** Reference to the associated server (response only). */
  server?: ToastExternalReference;
  /** Refund amounts applied to the payment. */
  refunds?: ToastRefund[];
  /** Additional arbitrary fields surfaced by Toast. */
  [key: string]: unknown;
}

/**
 * Individual payment refund record (`Refund`).
 */
export interface ToastRefund {
  /** Amount refunded excluding the tip. */
  refundAmount?: number;
  /** Refunded tip amount. */
  tipRefundAmount?: number;
  /** Timestamp when the refund occurred. */
  refundDate?: string;
  /** Business date (yyyyMMdd) when the refund was created. */
  refundBusinessDate?: number;
  /** Identifier linking refund-related entities. */
  refundTransaction?: ToastReference;
}

/**
 * Applied tax information (`AppliedTaxRate`).
 */
export interface ToastAppliedTaxRate extends ToastReference {
  /** Nested reference to the configured tax rate. */
  taxRate: ToastReference;
  /** Human-readable tax name. */
  name?: string;
  /** Tax rate expressed as a numeric value. */
  rate?: number;
  /** Actual tax amount collected for this rate. */
  taxAmount?: number;
  /** Tax type indicator. */
  type?: "PERCENT" | "FIXED" | "NONE" | "TABLE" | "EXTERNAL";
  /** Indicates marketplace facilitator tax remittance. */
  facilitatorCollectAndRemitTax?: boolean;
  /** Display-friendly tax name (response only). */
  displayName?: string;
}

/**
 * Toast selection object describing menu items and modifiers (`Selection`).
 */
export interface ToastSelection extends ToastExternalReference {
  /** Reference to the selected menu item. */
  item: ToastConfigReference | null;
  /** Menu group reference where the item was chosen. */
  itemGroup: ToastConfigReference | null;
  /** Modifier group reference when the selection is a modifier. */
  optionGroup?: ToastConfigReference | null;
  /** Selected pre-modifier reference. */
  preModifier?: ToastConfigReference | null;
  /** Quantity ordered (supports decimals for weighted items). */
  quantity: number;
  /** Seat assignment for the selection (response only). */
  seatNumber?: number;
  /** Unit of measure required for weighed items. */
  unitOfMeasure?: "NONE" | "LB" | "OZ" | "KG" | "G";
  /** Selection classification. */
  selectionType?:
    | "NONE"
    | "OPEN_ITEM"
    | "SPECIAL_REQUEST"
    | "PORTION"
    | "HOUSE_ACCOUNT_PAY_BALANCE"
    | "TOAST_CARD_SELL"
    | "TOAST_CARD_RELOAD";
  /** Sales category reference (response only). */
  salesCategory?: ToastConfigReference | null;
  /** Discounts applied directly to this selection (response only). */
  appliedDiscounts?: ToastAppliedDiscount[];
  /** Marks deferred-revenue transactions such as gift card sales. */
  deferred?: boolean;
  /** Gross sale price prior to discounts (response only). */
  preDiscountPrice?: number;
  /** Net price after discounts and modifiers (response only). */
  price?: number;
  /** Total tax collected for this selection (response only). */
  tax?: number;
  /** Indicates whether the selection was voided (response only). */
  voided?: boolean;
  /** Date/time when the selection was voided (response only). */
  voidDate?: string;
  /** Business date (yyyyMMdd) when the selection was voided (response only). */
  voidBusinessDate?: number;
  /** Reason reference explaining why the selection was voided (response only). */
  voidReason?: ToastExternalReference;
  /** Refund metadata applied to the selection. */
  refundDetails?: ToastRefundDetails;
  /** Display name for the selection (for example, special request text). */
  displayName?: string;
  /** Timestamp when the selection was created. */
  createdDate?: string;
  /** Timestamp when the selection was last modified. */
  modifiedDate?: string;
  /** Nested modifiers applied to this selection. */
  modifiers?: ToastSelection[];
  /** Kitchen fulfillment status (response only). */
  fulfillmentStatus?: "NEW" | "HOLD" | "SENT" | "READY";
  /** Fulfillment requirements for the selection (response only). */
  fulfillment?: ToastFulfillment;
  /** Indicates whether the selection price includes tax. */
  taxInclusion?: "INCLUDED" | "NOT_INCLUDED" | "INHERITED";
  /** Tax breakdown applied to the selection (response only). */
  appliedTaxes?: ToastAppliedTaxRate[];
  /** Dining option reference applied to the selection (response only). */
  diningOption?: ToastExternalReference;
  /** Open-price override amount supplied at order time (POST only). */
  openPriceAmount?: number;
  /** Base price prior to quantity, taxes, or discounts. */
  receiptLinePrice?: number;
  /** Pricing mode inherited from the modifier group configuration. */
  optionGroupPricingMode?:
    | "INCLUDED"
    | "FIXED_PRICE"
    | "ADJUSTS_PRICE"
    | "REPLACES_PRICE"
    | "LOCATION_SPECIFIC_PRICE";
  /** Marketplace facilitator price override (POST only). */
  externalPriceAmount?: number;
  /** Reserved Toast reference for split operations. */
  splitOrigin?: ToastReference;
  /** Arbitrary additional properties returned by Toast. */
  [key: string]: unknown;
}

/**
 * Fulfillment metadata for a selection (`Fulfillment`).
 */
export interface ToastFulfillment {
  /** Quantity required for fulfillment. */
  quantity?: number;
  /** Unit of measure associated with the fulfillment quantity. */
  unit?: string;
  /** Completed timestamp when provided. */
  completedDate?: string;
  /** Ready timestamp when provided. */
  readyDate?: string;
  /** Actual fulfillment timestamp when provided. */
  actualFulfillmentDate?: string;
}

/**
 * Toast check object grouping selections and payments (`Check`).
 */
export interface ToastCheck extends ToastExternalReference {
  /** Timestamp Toast received the check. */
  createdDate?: string;
  /** Timestamp the check was opened (defaults to current time). */
  openedDate?: string;
  /** Timestamp when the check reached `CLOSED` payment status. */
  closedDate?: string;
  /** Most recent modification timestamp. */
  modifiedDate?: string;
  /** Timestamp when the check was deleted. */
  deletedDate?: string;
  /** Indicates whether the check was deleted. */
  deleted?: boolean;
  /** Menu selections contained in the check. */
  selections: ToastSelection[];
  /** Guest information associated with the check. */
  customer?: ToastCustomer | null;
  /** Loyalty program metadata applied to the check. */
  appliedLoyaltyInfo?: ToastAppliedLoyaltyInfo;
  /** Whether the check is tax exempt. */
  taxExempt?: boolean;
  /** Display number shown on receipts and KDS. */
  displayNumber?: string;
  /** Service charges applied to the check. */
  appliedServiceCharges?: ToastAppliedServiceCharge[];
  /** Calculated total excluding gratuity and taxes (response only). */
  amount?: number;
  /** Calculated tax amount (response only). */
  taxAmount?: number;
  /** Total amount including discounts and taxes. */
  totalAmount?: number;
  /** Payments applied to the check. */
  payments?: ToastPayment[];
  /** Check tab name displayed on the KDS. */
  tabName?: string;
  /** Payment status lifecycle indicator (response only). */
  paymentStatus?: "OPEN" | "PAID" | "CLOSED";
  /** Discounts applied to the check. */
  appliedDiscounts?: ToastAppliedDiscount[];
  /** Indicates whether the check was voided (response only). */
  voided?: boolean;
  /** Date the check was voided (response only). */
  voidDate?: string;
  /** Business date (yyyyMMdd) of the void (response only). */
  voidBusinessDate?: number;
  /** Latest payment timestamp (defaults to current time on POST). */
  paidDate?: string;
  /** POS device that created the check. */
  createdDevice?: ToastDevice;
  /** POS device that last modified the check. */
  lastModifiedDevice?: ToastDevice;
  /** Seconds between creation and payment (response only). */
  duration?: number;
  /** Employee who opened the check. */
  openedBy?: ToastExternalReference;
  /** Delivery metadata scoped to the check when present. */
  deliveryInfo?: ToastDeliveryInfo;
  /** Curbside pickup metadata scoped to the check. */
  curbsidePickupInfo?: ToastCurbsidePickupInfo;
  /** Table reference associated with the check. */
  table?: ToastExternalReference;
  /** Additional Toast-provided fields. */
  [key: string]: unknown;
}

/**
 * Marketplace facilitator tax metadata provided on orders (POST only).
 */
export interface ToastMarketplaceFacilitatorTaxInfo {
  /** Indicates the facilitator calculated and remitted taxes on behalf of the restaurant. */
  facilitatorCollectAndRemitTaxOrder?: boolean;
  /** Applied tax rates supplied by the facilitator. */
  taxes?: ToastAppliedTaxRate[];
}

/**
 * Packaging preference metadata applied to an order (`AppliedPackagingInfo`).
 */
export interface ToastAppliedPackagingInfo extends ToastReference {
  /** Guest choices for individual packaging items. */
  appliedPackagingItems?: ToastAppliedPackagingItem[];
}

/**
 * Packaging preference choice for a specific item (`AppliedPackagingItem`).
 */
export interface ToastAppliedPackagingItem extends ToastReference {
  /** GUID of the packaging preference option. */
  itemConfigId: string;
  /** Guest inclusion preference captured at order time. */
  inclusion: "YES" | "NO";
  /** Toast-classified item types (response only). */
  itemTypes?: string[];
  /** Guest-facing display name configured in Toast (response only). */
  guestDisplayName?: string;
}

/**
 * Toast order structure derived from the Orders API `Order` definition.
 */
export interface ToastOrder extends ToastExternalReference {
  /** Business date for the order. */
  openedDate?: string;
  /** Timestamp when the order or nested entities were last modified. */
  modifiedDate?: string;
  /** Scheduled fulfillment timestamp for future orders. */
  promisedDate?: string;
  /** Reserved for future use (UUID). */
  channelGuid?: string;
  /** Dining option assigned to the order. */
  diningOption: ToastExternalReference;
  /** Checks that make up the order. */
  checks: ToastCheck[];
  /** Table where the order was placed. */
  table?: ToastExternalReference;
  /** Service area metadata (response only). */
  serviceArea?: ToastExternalReference;
  /** Meal service metadata (response only). */
  restaurantService?: ToastExternalReference;
  /** Revenue center associated with the order. */
  revenueCenter?: ToastExternalReference;
  /** Ordering channel classification (response only). */
  source?: string;
  /** Seconds between creation and payment (response only). */
  duration?: number;
  /** Delivery metadata for delivery orders. */
  deliveryInfo?: ToastDeliveryInfo;
  /** Required prep time override expressed as ISO-8601 duration. */
  requiredPrepTime?: string;
  /** Expected ready or delivery timestamp (response only). */
  estimatedFulfillmentDate?: string;
  /** Guest count assigned to the order. */
  numberOfGuests?: number;
  /** Indicates the order was voided (response only). */
  voided?: boolean;
  /** Date the order was voided (response only). */
  voidDate?: string;
  /** Business date (yyyyMMdd) for the void (response only). */
  voidBusinessDate?: number;
  /** Latest payment timestamp (defaults to now on POST). */
  paidDate?: string;
  /** Timestamp when the order reached the closed state. */
  closedDate?: string;
  /** Timestamp when the order was deleted. */
  deletedDate?: string;
  /** Indicates the order was deleted (response only). */
  deleted?: boolean;
  /** Business date (yyyyMMdd) on which the order was fulfilled (response only). */
  businessDate?: number;
  /** Employee assigned to the order. */
  server?: ToastExternalReference;
  /** Pricing feature flags applied to the order. */
  pricingFeatures?: string[];
  /** Approval workflow status (response only). */
  approvalStatus?: "NEEDS_APPROVAL" | "APPROVED" | "FUTURE" | "NOT_APPROVED";
  /** Toast POS device that created the order. */
  createdDevice?: ToastDevice;
  /** Timestamp when the order was received by Toast. */
  createdDate?: string;
  /** POS device responsible for the latest modification. */
  lastModifiedDevice?: ToastDevice;
  /** Curbside pickup metadata. */
  curbsidePickupInfo?: ToastCurbsidePickupInfo;
  /** Marketplace facilitator tax metadata (POST only). */
  marketplaceFacilitatorTaxInfo?: ToastMarketplaceFacilitatorTaxInfo;
  /** Indicates the order was created while the restaurant was in test mode. */
  createdInTestMode?: boolean;
  /** Guest packaging preferences. */
  appliedPackagingInfo?: ToastAppliedPackagingInfo;
  /** Indicates an excess food tracking order (response only). */
  excessFood?: boolean;
  /** Display number printed on tickets (response only). */
  displayNumber?: string;
  /** Miscellaneous Toast-provided context (for example, additional timestamps). */
  context?: ToastOrderContext;
  /** Additional Toast-supplied properties not explicitly modeled. */
  [key: string]: unknown;
}

/**
 * Contextual order metadata frequently returned by Toast. This captures the subset of documented fields used by the worker.
 */
export interface ToastOrderContext {
  /** Alternate opened date surfaced in context payloads. */
  openedDate?: string;
  /** Alternate created date surfaced in context payloads. */
  createdDate?: string;
  /** Alternate modified date surfaced in context payloads. */
  modifiedDate?: string;
  /** Alternate last-modified date surfaced in context payloads. */
  lastModifiedDate?: string;
  /** Business date value supplied in the context. */
  businessDate?: number;
  /** Restaurant location GUID for the order context. */
  restaurantLocationGuid?: string;
  /** Location GUID for the order context. */
  locationGuid?: string;
  /** Location identifier for the order context. */
  locationId?: string;
  /** Delivery metadata repeated under the context object. */
  deliveryInfo?: ToastDeliveryInfo;
  /** Curbside metadata repeated under the context object. */
  curbsidePickupInfo?: ToastCurbsidePickupInfo;
  /** Dining option reference from the context. */
  diningOption?: ToastExternalReference;
  /** Toast-provided guest fulfillment status metadata. */
  guestOrderFulfillmentStatus?: { status?: string };
  /** Historical guest fulfillment status updates. */
  guestOrderFulfillmentStatusHistory?: Array<{ status?: string; updatedDate?: string }>;
  /** Miscellaneous context fields surfaced by Toast. */
  [key: string]: unknown;
}
