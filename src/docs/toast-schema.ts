export interface ToastPropertyDescriptor {
  description: string;
  type: string;
  format?: string;
  enum?: string[];
  required?: boolean;
  items?: ToastPropertyDescriptor;
  properties?: Record<string, ToastPropertyDescriptor>;
}

export interface ToastSchemaDescriptor {
  title: string;
  description: string;
  required?: string[];
  properties: Record<string, ToastPropertyDescriptor>;
}

const toastReferenceProperties: Record<string, ToastPropertyDescriptor> = {
  guid: {
    description: "Toast-maintained GUID for the referenced entity.",
    type: "string",
    required: true,
  },
  entityType: {
    description: "Type discriminator returned by Toast (response only).",
    type: "string",
  },
};

const toastExternalReferenceProperties: Record<string, ToastPropertyDescriptor> = {
  ...toastReferenceProperties,
  externalId: {
    description: "External identifier string prefixed by the naming authority.",
    type: "string",
  },
};

export const toastOrderSchema: ToastSchemaDescriptor = {
  title: "Order",
  description:
    "A Toast platform order composed of one or more checks. Captures dining option, delivery metadata, pricing features, and workflow state.",
  required: ["diningOption", "checks", "guid"],
  properties: {
    ...toastExternalReferenceProperties,
    openedDate: {
      description: "Business date for the order (matches createdDate for ASAP and promisedDate for scheduled orders).",
      type: "string",
      format: "date-time",
    },
    modifiedDate: {
      description: "Most recent modification timestamp for the order or nested entities.",
      type: "string",
      format: "date-time",
    },
    promisedDate: {
      description: "Scheduled fulfillment timestamp for future orders (null for dine-in / ASAP).",
      type: "string",
      format: "date-time",
    },
    channelGuid: {
      description: "Reserved UUID channel identifier.",
      type: "string",
      format: "uuid",
    },
    diningOption: {
      description: "Restaurant-configured dining option applied to the order.",
      type: "object",
      properties: toastExternalReferenceProperties,
      required: true,
    },
    checks: {
      description: "Checks that belong to the order (most orders have one check).",
      type: "array",
      required: true,
      items: { description: "Check", type: "object" },
    },
    table: {
      description: "Table where the order was placed.",
      type: "object",
      properties: toastExternalReferenceProperties,
    },
    serviceArea: {
      description: "Service area metadata (response only).",
      type: "object",
      properties: toastExternalReferenceProperties,
    },
    restaurantService: {
      description: "Meal service associated with the order (response only).",
      type: "object",
      properties: toastExternalReferenceProperties,
    },
    revenueCenter: {
      description: "Revenue center assigned to the order.",
      type: "object",
      properties: toastExternalReferenceProperties,
    },
    source: {
      description:
        "Ordering channel reported by Toast (In Store, Online, API, Kiosk, Branded channels, Catering, etc.).",
      type: "string",
    },
    duration: {
      description: "Seconds between creation and payment (response only).",
      type: "number",
    },
    deliveryInfo: {
      description: "Delivery metadata required for orders fulfilled via DELIVERY behavior.",
      type: "object",
    },
    requiredPrepTime: {
      description: "ISO-8601 duration overriding the default prep window (increments of five minutes).",
      type: "string",
      format: "duration",
    },
    estimatedFulfillmentDate: {
      description: "Expected ready-for-pickup or delivery timestamp (response only).",
      type: "string",
      format: "date-time",
    },
    numberOfGuests: {
      description: "Number of guests associated with the order.",
      type: "number",
    },
    voided: {
      description: "Set to true when the order was voided (response only).",
      type: "boolean",
    },
    voidDate: {
      description: "Timestamp when the order was voided (response only).",
      type: "string",
      format: "date-time",
    },
    voidBusinessDate: {
      description: "Business date (yyyyMMdd) associated with the void (response only).",
      type: "number",
    },
    paidDate: {
      description: "Most recent payment timestamp (defaults to current time on POST).",
      type: "string",
      format: "date-time",
    },
    closedDate: {
      description: "Timestamp when payment status transitioned to CLOSED.",
      type: "string",
      format: "date-time",
    },
    deletedDate: {
      description: "Timestamp when the order was deleted (1970 epoch when not deleted).",
      type: "string",
      format: "date-time",
    },
    deleted: {
      description: "True when the order has been deleted (response only).",
      type: "boolean",
    },
    businessDate: {
      description: "Business date (yyyyMMdd) on which the order was fulfilled (response only).",
      type: "number",
    },
    server: {
      description: "Employee assigned to the order.",
      type: "object",
      properties: toastExternalReferenceProperties,
    },
    pricingFeatures: {
      description: "Pricing features applied to the order (for example, TAXESV2, TAXESV3).",
      type: "array",
      items: { description: "Pricing feature", type: "string" },
    },
    approvalStatus: {
      description: "Approval workflow state for the order (response only).",
      type: "string",
      enum: ["NEEDS_APPROVAL", "APPROVED", "FUTURE", "NOT_APPROVED"],
    },
    createdDevice: {
      description: "Toast POS device that created the order.",
      type: "object",
      properties: { id: { description: "Device identifier", type: "string" } },
    },
    createdDate: {
      description: "Timestamp when Toast received the order.",
      type: "string",
      format: "date-time",
    },
    lastModifiedDevice: {
      description: "Toast POS device that last modified the order.",
      type: "object",
      properties: { id: { description: "Device identifier", type: "string" } },
    },
    curbsidePickupInfo: {
      description: "Guest-provided curbside pickup identifiers.",
      type: "object",
    },
    marketplaceFacilitatorTaxInfo: {
      description: "Marketplace facilitator tax metadata supplied on POST requests.",
      type: "object",
    },
    createdInTestMode: {
      description: "True when the order was created while the restaurant was in test mode.",
      type: "boolean",
    },
    appliedPackagingInfo: {
      description: "Guest packaging preferences for the order.",
      type: "object",
    },
    excessFood: {
      description: "True when the order tracks excess food rather than a guest sale (response only).",
      type: "boolean",
    },
    displayNumber: {
      description: "Display number printed on receipts/tickets (response only).",
      type: "string",
    },
    context: {
      description: "Auxiliary Toast order context containing alternate timestamps and location metadata.",
      type: "object",
    },
  },
};

export const toastCheckSchema: ToastSchemaDescriptor = {
  title: "Check",
  description: "Represents a single check within an order, containing selections, discounts, service charges, and payments.",
  required: ["guid", "selections"],
  properties: {
    ...toastExternalReferenceProperties,
    createdDate: {
      description: "Timestamp when Toast received the check.",
      type: "string",
      format: "date-time",
    },
    openedDate: {
      description: "Timestamp when the check opened (defaults to current time).",
      type: "string",
      format: "date-time",
    },
    closedDate: {
      description: "Timestamp when payment status became CLOSED.",
      type: "string",
      format: "date-time",
    },
    modifiedDate: {
      description: "Most recent modification timestamp.",
      type: "string",
      format: "date-time",
    },
    deletedDate: {
      description: "Timestamp when the check was deleted (epoch when active).",
      type: "string",
      format: "date-time",
    },
    deleted: {
      description: "True when the check was deleted.",
      type: "boolean",
    },
    selections: {
      description: "Menu item and modifier selections on the check.",
      type: "array",
      required: true,
      items: { description: "Selection", type: "object" },
    },
    customer: {
      description: "Guest information attached to the check (required for takeout/delivery POSTs).",
      type: "object",
    },
    appliedLoyaltyInfo: {
      description: "Loyalty program metadata associated with the check.",
      type: "object",
    },
    taxExempt: {
      description: "True when the check is tax exempt (defaults to false).",
      type: "boolean",
    },
    displayNumber: {
      description: "Ticket display number (not guaranteed unique).",
      type: "string",
    },
    appliedServiceCharges: {
      description: "Service charges applied to the check.",
      type: "array",
      items: { description: "Applied service charge", type: "object" },
    },
    amount: {
      description: "Calculated check total excluding gratuity and taxes (response only).",
      type: "number",
    },
    taxAmount: {
      description: "Calculated tax amount including service charge taxes (response only).",
      type: "number",
    },
    totalAmount: {
      description: "Total amount including discounts and taxes.",
      type: "number",
    },
    payments: {
      description: "Payments applied to the check.",
      type: "array",
      items: { description: "Payment", type: "object" },
    },
    tabName: {
      description: "Tab name shown on the KDS (max 255 characters).",
      type: "string",
    },
    paymentStatus: {
      description: "Payment workflow status (response only).",
      type: "string",
      enum: ["OPEN", "PAID", "CLOSED"],
    },
    appliedDiscounts: {
      description: "Discounts applied to the check.",
      type: "array",
      items: { description: "Applied discount", type: "object" },
    },
    voided: {
      description: "True when the check was voided (response only).",
      type: "boolean",
    },
    voidDate: {
      description: "Timestamp when the check was voided (response only).",
      type: "string",
      format: "date-time",
    },
    voidBusinessDate: {
      description: "Business date (yyyyMMdd) for the void (response only).",
      type: "number",
    },
    paidDate: {
      description: "Most recent payment timestamp (defaults to now on POST).",
      type: "string",
      format: "date-time",
    },
    createdDevice: {
      description: "Toast POS device that created the check.",
      type: "object",
      properties: { id: { description: "Device identifier", type: "string" } },
    },
    lastModifiedDevice: {
      description: "Toast POS device that last modified the check.",
      type: "object",
      properties: { id: { description: "Device identifier", type: "string" } },
    },
    duration: {
      description: "Seconds between creation and payment (response only).",
      type: "number",
    },
    openedBy: {
      description: "Employee who opened the check.",
      type: "object",
      properties: toastExternalReferenceProperties,
    },
  },
};

export const toastSelectionSchema: ToastSchemaDescriptor = {
  title: "Selection",
  description: "Represents a primary menu item or modifier selection. Supports nested modifiers, pricing metadata, and fulfillment state.",
  required: ["guid", "item", "itemGroup", "quantity"],
  properties: {
    ...toastExternalReferenceProperties,
    item: {
      description: "Reference to the selected menu item.",
      type: "object",
      required: true,
    },
    itemGroup: {
      description: "Menu group reference from which the item was selected.",
      type: "object",
      required: true,
    },
    optionGroup: {
      description: "Modifier group reference for modifier selections.",
      type: "object",
    },
    preModifier: {
      description: "Selected pre-modifier reference.",
      type: "object",
    },
    quantity: {
      description: "Quantity ordered (supports decimals for weighted items).",
      type: "number",
      required: true,
    },
    seatNumber: {
      description: "Seat assignment for the selection (response only, 0 = shared, -1 = unassigned).",
      type: "number",
    },
    unitOfMeasure: {
      description: "Unit of measure required for weighed items.",
      type: "string",
      enum: ["NONE", "LB", "OZ", "KG", "G"],
    },
    selectionType: {
      description: "Classification for the selection (OPEN_ITEM, SPECIAL_REQUEST, HOUSE_ACCOUNT_PAY_BALANCE, etc.).",
      type: "string",
      enum: [
        "NONE",
        "OPEN_ITEM",
        "SPECIAL_REQUEST",
        "PORTION",
        "HOUSE_ACCOUNT_PAY_BALANCE",
        "TOAST_CARD_SELL",
        "TOAST_CARD_RELOAD",
      ],
    },
    salesCategory: {
      description: "Sales category reference associated with the selection (response only).",
      type: "object",
    },
    appliedDiscounts: {
      description: "Discounts applied directly to this selection (response only).",
      type: "array",
      items: { description: "Applied discount", type: "object" },
    },
    deferred: {
      description: "True when the selection tracks deferred revenue (for example, gift card).",
      type: "boolean",
    },
    preDiscountPrice: {
      description: "Gross sale price before discounts (response only).",
      type: "number",
    },
    price: {
      description: "Net price after discounts and modifiers (response only).",
      type: "number",
    },
    tax: {
      description: "Total tax amount collected for this selection (response only).",
      type: "number",
    },
    voided: {
      description: "True when the selection was voided (response only).",
      type: "boolean",
    },
    voidDate: {
      description: "Timestamp when the selection was voided (response only).",
      type: "string",
      format: "date-time",
    },
    voidBusinessDate: {
      description: "Business date (yyyyMMdd) when the selection was voided (response only).",
      type: "number",
    },
    voidReason: {
      description: "Void reason reference (response only).",
      type: "object",
    },
    refundDetails: {
      description: "Refund metadata for the selection.",
      type: "object",
    },
    displayName: {
      description: "Display name for the selection (also used for special request text).",
      type: "string",
    },
    createdDate: {
      description: "Timestamp when the selection was created.",
      type: "string",
      format: "date-time",
    },
    modifiedDate: {
      description: "Timestamp when the selection was last modified.",
      type: "string",
      format: "date-time",
    },
    modifiers: {
      description: "Nested modifier selections applied to this selection.",
      type: "array",
      items: { description: "Modifier selection", type: "object" },
    },
    fulfillmentStatus: {
      description: "Kitchen display workflow status (response only).",
      type: "string",
      enum: ["NEW", "HOLD", "SENT", "READY"],
    },
    fulfillment: {
      description: "Fulfillment requirements for the selection (response only).",
      type: "object",
    },
    taxInclusion: {
      description: "Indicates whether the selection price includes tax or inherits from parent.",
      type: "string",
      enum: ["INCLUDED", "NOT_INCLUDED", "INHERITED"],
    },
    appliedTaxes: {
      description: "Tax breakdown applied to the selection (response only).",
      type: "array",
      items: { description: "Applied tax rate", type: "object" },
    },
    diningOption: {
      description: "Dining option reference applied to the selection (response only).",
      type: "object",
    },
    openPriceAmount: {
      description: "Open-price override amount supplied at order time (POST only).",
      type: "number",
    },
    receiptLinePrice: {
      description: "Price before quantity, taxes, or discounts are applied.",
      type: "number",
    },
    optionGroupPricingMode: {
      description: "Pricing mode inherited from the associated modifier group.",
      type: "string",
      enum: ["INCLUDED", "FIXED_PRICE", "ADJUSTS_PRICE", "REPLACES_PRICE", "LOCATION_SPECIFIC_PRICE"],
    },
    externalPriceAmount: {
      description: "Marketplace facilitator calculated price (POST only).",
      type: "number",
    },
    splitOrigin: {
      description: "Reserved Toast reference for split operations.",
      type: "object",
    },
  },
};

export const toastMenusDocumentSchema: ToastSchemaDescriptor = {
  title: "Restaurant",
  description: "Menus API restaurant payload containing published menus plus modifier references.",
  properties: {
    restaurantGuid: {
      description: "Restaurant GUID associated with the published menus.",
      type: "string",
      format: "uuid",
    },
    lastUpdated: {
      description: "Timestamp when menu data was last published.",
      type: "string",
    },
    restaurantTimeZone: {
      description: "Restaurant time zone expressed as an IANA identifier.",
      type: "string",
    },
    menus: {
      description: "Published menus for the restaurant.",
      type: "array",
      items: { description: "Menu", type: "object" },
    },
    modifierGroupReferences: {
      description: "Dictionary of modifier groups keyed by referenceId.",
      type: "object",
    },
    modifierOptionReferences: {
      description: "Dictionary of modifier options keyed by referenceId.",
      type: "object",
    },
    preModifierGroupReferences: {
      description: "Dictionary of pre-modifier groups keyed by referenceId.",
      type: "object",
    },
  },
};

export const toastMenuItemSchema: ToastSchemaDescriptor = {
  title: "MenuItem",
  description: "Menu item configuration including pricing, tags, and modifier group references.",
  properties: {
    name: {
      description: "Guest-facing name (Toast substitutes \"Missing name\" when blank).",
      type: "string",
    },
    kitchenName: {
      description: "Kitchen ticket label for the item.",
      type: "string",
    },
    guid: {
      description: "Menu item GUID assigned by Toast.",
      type: "string",
    },
    multiLocationId: {
      description: "Identifier shared across locations for the same conceptual item.",
      type: "string",
    },
    description: {
      description: "Optional description displayed in menus.",
      type: "string",
    },
    itemTags: {
      description: "Item tags such as vegetarian, gluten-free, or alcohol.",
      type: "array",
      items: { description: "Item tag", type: "object" },
    },
    price: {
      description: "Resolved price for the menu item.",
      type: "number",
    },
    unitOfMeasure: {
      description: "Unit of measure for weighed pricing.",
      type: "string",
      enum: ["NONE", "LB", "OZ", "KG", "G"],
    },
    portions: {
      description: "Portion definitions available for the item (for example, pizza halves).",
      type: "array",
      items: { description: "Portion", type: "object" },
    },
    modifierGroupReferences: {
      description: "Reference IDs for modifier groups applied to this item.",
      type: "array",
      items: { description: "Modifier group referenceId", type: "number" },
    },
    prepTime: {
      description: "Prep time in seconds (nullable).",
      type: "number",
    },
    prepStations: {
      description: "GUIDs for assigned prep stations.",
      type: "array",
      items: { description: "Prep station GUID", type: "string" },
    },
  },
};

export const toastModifierGroupSchema: ToastSchemaDescriptor = {
  title: "ModifierGroup",
  description: "Modifier group configuration describing pricing strategy and selection rules.",
  properties: {
    name: {
      description: "Display name for the modifier group.",
      type: "string",
    },
    guid: {
      description: "Modifier group GUID assigned by Toast.",
      type: "string",
    },
    referenceId: {
      description: "Numeric identifier used by menu items to reference the group.",
      type: "number",
    },
    pricingStrategy: {
      description: "Pricing strategy for the modifier group (NONE, SIZE_PRICE, SEQUENCE_PRICE, SIZE_SEQUENCE_PRICE).",
      type: "string",
    },
    pricingRules: {
      description: "Strategy-specific pricing rules used when calculating option prices.",
      type: "object",
    },
    defaultOptionsChargePrice: {
      description: "Whether default modifiers add to the parent item price (YES/NO).",
      type: "string",
      enum: ["NO", "YES"],
    },
    defaultOptionsSubstitutionPricing: {
      description: "Whether substitution pricing is enabled for the group (YES/NO).",
      type: "string",
      enum: ["NO", "YES"],
    },
    minSelections: {
      description: "Minimum number of modifier options required.",
      type: "number",
    },
    maxSelections: {
      description: "Maximum number of modifier options allowed (null indicates unlimited).",
      type: "number",
    },
    requiredMode: {
      description: "POS behavior for presenting the group (REQUIRED, OPTIONAL_FORCE_SHOW, OPTIONAL).",
      type: "string",
      enum: ["REQUIRED", "OPTIONAL_FORCE_SHOW", "OPTIONAL"],
    },
    isMultiSelect: {
      description: "True when multiple modifier options may be selected.",
      type: "boolean",
    },
    preModifierGroupReference: {
      description: "ReferenceId of the associated premodifier group.",
      type: "number",
    },
    modifierOptionReferences: {
      description: "Reference IDs for modifier options contained in the group.",
      type: "array",
      items: { description: "Modifier option referenceId", type: "number" },
    },
  },
};

export const toastModifierOptionSchema: ToastSchemaDescriptor = {
  title: "ModifierOption",
  description: "Modifier option configuration including pricing strategy, tags, and availability metadata.",
  properties: {
    referenceId: {
      description: "Numeric identifier referenced by modifier groups.",
      type: "number",
    },
    name: {
      description: "Display name for the modifier option (Toast substitutes \"Missing name\" when blank).",
      type: "string",
    },
    guid: {
      description: "Modifier option GUID for the underlying item reference.",
      type: "string",
    },
    price: {
      description: "Resolved price for the modifier option (null when group-level pricing applies).",
      type: "number",
    },
    pricingStrategy: {
      description: "Pricing strategy applied to the modifier option (GROUP_PRICE, BASE_PRICE, MENU_SPECIFIC_PRICE, TIME_SPECIFIC_PRICE, etc.).",
      type: "string",
    },
    pricingRules: {
      description: "Pricing rules used when additional calculation is required.",
      type: "object",
    },
    itemTags: {
      description: "Item tags applied to the modifier option.",
      type: "array",
      items: { description: "Item tag", type: "object" },
    },
    isDefault: {
      description: "Indicates whether the modifier option is included by default.",
      type: "boolean",
    },
    allowsDuplicates: {
      description: "Indicates whether the modifier option can be selected multiple times.",
      type: "boolean",
    },
    portions: {
      description: "Portions that the modifier option can cover.",
      type: "array",
      items: { description: "Portion", type: "object" },
    },
  },
};

export const toastSchemas = {
  order: toastOrderSchema,
  check: toastCheckSchema,
  selection: toastSelectionSchema,
  menusDocument: toastMenusDocumentSchema,
  menuItem: toastMenuItemSchema,
  modifierGroup: toastModifierGroupSchema,
  modifierOption: toastModifierOptionSchema,
};
