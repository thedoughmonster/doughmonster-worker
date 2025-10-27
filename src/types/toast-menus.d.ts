/**
 * Top-level menus document returned by Toast Menus API v2 (`Restaurant`).
 */
export interface ToastMenusDocument {
  /** Restaurant GUID supplied via Toast headers. */
  restaurantGuid?: string;
  /** Timestamp when the menu set was last published. */
  lastUpdated?: string;
  /** Restaurant IANA time zone identifier. */
  restaurantTimeZone?: string;
  /** Published menus available to the restaurant. */
  menus?: ToastMenu[];
  /** Modifier groups keyed by their `referenceId`. */
  modifierGroupReferences?: Record<string, ToastModifierGroup>;
  /** Modifier options keyed by their `referenceId`. */
  modifierOptionReferences?: Record<string, ToastModifierOption>;
  /** Pre-modifier groups keyed by their `referenceId`. */
  preModifierGroupReferences?: Record<string, ToastPreModifierGroup>;
  /** Additional metadata returned by Toast. */
  [key: string]: unknown;
}

/**
 * Individual menu definition containing hierarchical groups and items.
 */
export interface ToastMenu {
  /** Display name for the menu (for example, "Food"). */
  name?: string;
  /** Menu GUID assigned by Toast. */
  guid?: string;
  /** Multilocation identifier shared across concepts. */
  multiLocationId?: string | number | null;
  /** Master identifier for enterprise management. */
  masterId?: string | number | null;
  /** Optional human-readable description. */
  description?: string;
  /** POS display name. */
  posName?: string;
  /** Light color used for POS buttons. */
  posButtonColorLight?: string;
  /** Dark color used for POS buttons. */
  posButtonColorDark?: string;
  /** High-resolution image URL (Toast Kiosk). */
  highResImage?: string | null;
  /** Primary menu image metadata. */
  image?: ToastMenuImage;
  /** Visibility settings for the menu. */
  visibility?: ToastMenuVisibility;
  /** Availability schedule describing when the menu can be ordered. */
  availability?: ToastMenuAvailability[];
  /** Menu groups contained in this menu. */
  menuGroups?: ToastMenuGroup[];
  /** Additional fields surfaced by Toast. */
  [key: string]: unknown;
}

/**
 * Menu grouping that may contain nested groups and menu items.
 */
export interface ToastMenuGroup {
  /** Display name for the menu group (for example, "Appetizers"). */
  name?: string;
  /** Group GUID assigned by Toast. */
  guid?: string;
  /** Multilocation identifier shared across locations. */
  multiLocationId?: string | number | null;
  /** Master identifier for enterprise management. */
  masterId?: string | number | null;
  /** Optional description for the group. */
  description?: string;
  /** POS display name. */
  posName?: string;
  /** POS button color (light theme). */
  posButtonColorLight?: string;
  /** POS button color (dark theme). */
  posButtonColorDark?: string;
  /** Image metadata associated with the group. */
  image?: ToastMenuImage;
  /** Visibility configuration. */
  visibility?: ToastMenuVisibility;
  /** Item tags applied to the group. */
  itemTags?: ToastMenuItemTag[];
  /** Nested child groups. */
  menuGroups?: ToastMenuGroup[];
  /** Menu items contained in the group (Toast publishes both `menuItems` and flattened `items`). */
  menuItems?: ToastMenuItem[];
  /** Convenience alias for flattened menu items. */
  items?: ToastMenuItem[];
  /** Additional Toast-provided fields. */
  [key: string]: unknown;
}

/**
 * Menu item definition including pricing, tags, and modifier links.
 */
export interface ToastMenuItem {
  /** Display name shown to guests (Toast substitutes "Missing name" when blank). */
  name?: string;
  /** Kitchen ticket name for the item. */
  kitchenName?: string;
  /** Menu item GUID assigned by Toast. */
  guid?: string;
  /** Shared identifier across locations. */
  multiLocationId?: string | number | null;
  /** Enterprise master identifier. */
  masterId?: string | number | null;
  /** Optional description displayed in menus. */
  description?: string;
  /** POS display name. */
  posName?: string;
  /** POS button color (light theme). */
  posButtonColorLight?: string;
  /** POS button color (dark theme). */
  posButtonColorDark?: string;
  /** Menu item imagery. */
  image?: ToastMenuImage;
  /** Visibility configuration for the item. */
  visibility?: ToastMenuVisibility;
  /** Item tags (for example, vegetarian, gluten-free). */
  itemTags?: ToastMenuItemTag[];
  /** Price lookup code defined in Toast. */
  plu?: string;
  /** SKU identifier defined in Toast. */
  sku?: string;
  /** Calorie value for the item. */
  calories?: number | null;
  /** Content advisories (for example, alcohol warnings). */
  contentAdvisories?: ToastContentAdvisories;
  /** Unit of measure for weighed pricing. */
  unitOfMeasure?: "NONE" | "LB" | "OZ" | "KG" | "G";
  /** Portion definitions available for the item. */
  portions?: ToastMenuPortion[];
  /** Prep time in seconds (nullable). */
  prepTime?: number | null;
  /** Assigned prep stations. */
  prepStations?: string[];
  /** Reference IDs for modifier groups applied to this item. */
  modifierGroupReferences?: number[];
  /** Payment assistance programs eligible for the item. */
  eligiblePaymentAssistancePrograms?: string[];
  /** Allergen metadata. */
  allergens?: ToastMenuAllergenItem[] | null;
  /** Item dimensions (length). */
  length?: number | null;
  /** Item dimensions (height). */
  height?: number | null;
  /** Item dimensions (width). */
  width?: number | null;
  /** Dimension unit of measure. */
  dimensionUnitOfMeasure?: string | null;
  /** Item weight. */
  weight?: number | null;
  /** Weight unit of measure. */
  weightUnitOfMeasure?: string | null;
  /** Additional images associated with the item. */
  images?: ToastMenuImages;
  /** Guest count guidance. */
  guestCount?: number | null;
  /** Sort order for the item. */
  sortOrder?: number;
  /** Base or resolved price for the item. */
  price?: number | null;
  /** Pricing strategy applied to the item. */
  pricingStrategy?: string;
  /** Pricing rules used when additional calculation is required. */
  pricingRules?: ToastPricingRules | null;
  /** Tax configuration metadata. */
  taxInfo?: string[];
  /** Modifier-option specific tax configuration. */
  modifierOptionTaxInfo?: ToastModifierOptionTaxInfo | null;
  /** Additional Toast-provided fields. */
  [key: string]: unknown;
}

/**
 * Modifier group configuration describing selection rules and pricing.
 */
export interface ToastModifierGroup {
  /** Display name for the modifier group. */
  name?: string;
  /** Modifier group GUID. */
  guid?: string;
  /** Numeric reference identifier used by menu items. */
  referenceId?: number;
  /** Shared multilocation identifier. */
  multiLocationId?: string | number | null;
  /** Enterprise master identifier. */
  masterId?: string | number | null;
  /** POS display name. */
  posName?: string;
  /** POS button color (light theme). */
  posButtonColorLight?: string;
  /** POS button color (dark theme). */
  posButtonColorDark?: string;
  /** Visibility configuration. */
  visibility?: ToastMenuVisibility;
  /** Pricing strategy applied to options in the group. */
  pricingStrategy?: string;
  /** Pricing rules required for complex strategies. */
  pricingRules?: ToastPricingRules | null;
  /** Indicates whether default modifiers add to the parent item price. */
  defaultOptionsChargePrice?: "NO" | "YES";
  /** Enables substitution pricing for default modifiers. */
  defaultOptionsSubstitutionPricing?: "NO" | "YES";
  /** Minimum number of selections enforced by Toast. */
  minSelections?: number;
  /** Maximum number of selections allowed (null = unlimited). */
  maxSelections?: number | null;
  /** POS behavior when presenting the group. */
  requiredMode?: "REQUIRED" | "OPTIONAL_FORCE_SHOW" | "OPTIONAL";
  /** Indicates whether multiple options may be selected. */
  isMultiSelect?: boolean;
  /** Reference ID for the associated premodifier group. */
  preModifierGroupReference?: number;
  /** Reference IDs for modifier options contained in the group. */
  modifierOptionReferences?: number[];
  /** Additional Toast-provided fields. */
  [key: string]: unknown;
}

/**
 * Modifier option definition containing pricing, tags, and availability metadata.
 */
export interface ToastModifierOption {
  /** Numeric reference identifier referenced by modifier groups. */
  referenceId?: number;
  /** Display name for the modifier option (Toast substitutes "Missing name" when blank). */
  name?: string;
  /** Kitchen ticket name. */
  kitchenName?: string;
  /** GUID for the option's item reference. */
  guid?: string;
  /** Multilocation identifier shared across restaurants. */
  multiLocationId?: string | number | null;
  /** Master identifier for enterprise management. */
  masterId?: string | number | null;
  /** Optional description for the modifier option. */
  description?: string;
  /** POS display name. */
  posName?: string;
  /** POS button color (light theme). */
  posButtonColorLight?: string;
  /** POS button color (dark theme). */
  posButtonColorDark?: string;
  /** Assigned prep stations. */
  prepStations?: string[];
  /** Image metadata. */
  image?: ToastMenuImage;
  /** Visibility configuration. */
  visibility?: ToastMenuVisibility;
  /** Resolved price for the modifier option (nullable when group-level pricing applies). */
  price?: number | null;
  /** Pricing strategy applied to the option. */
  pricingStrategy?: string;
  /** Pricing rules necessary for size or time-based strategies. */
  pricingRules?: ToastPricingRules | null;
  /** Sales category metadata. */
  salesCategory?: ToastSalesCategory;
  /** Deprecated tax info array. */
  taxInfo?: string[];
  /** Modifier-option tax configuration. */
  modifierOptionTaxInfo?: ToastModifierOptionTaxInfo | null;
  /** Tags assigned to the modifier option. */
  itemTags?: ToastMenuItemTag[];
  /** Price lookup code. */
  plu?: string;
  /** SKU identifier. */
  sku?: string;
  /** Calorie value (nullable). */
  calories?: number | null;
  /** Content advisories (for example, alcohol). */
  contentAdvisories?: ToastContentAdvisories;
  /** Unit of measure for weighed pricing. */
  unitOfMeasure?: "NONE" | "LB" | "OZ" | "KG" | "G";
  /** Indicates whether the option is included by default. */
  isDefault?: boolean;
  /** Indicates whether duplicates are allowed. */
  allowsDuplicates?: boolean;
  /** Portions that the modifier option can cover. */
  portions?: ToastMenuPortion[];
  /** Additional Toast-provided fields. */
  [key: string]: unknown;
}

/**
 * Pre-modifier group definition.
 */
export interface ToastPreModifierGroup {
  /** Reference identifier for the pre-modifier group. */
  referenceId?: number;
  /** GUID assigned by Toast. */
  guid?: string;
  /** Pre-modifiers contained in the group. */
  preModifiers?: ToastPreModifier[];
  /** Additional Toast-provided fields. */
  [key: string]: unknown;
}

/** Individual pre-modifier definition. */
export interface ToastPreModifier {
  /** GUID for the pre-modifier. */
  guid?: string;
  /** Display name (for example, "EXTRA"). */
  name?: string;
  /** Fixed price applied by the pre-modifier. */
  fixedPrice?: number | null;
  /** Multiplication factor applied to modifier pricing. */
  multiplicationFactor?: number | null;
  /** Display mode describing how the pre-modifier appears on tickets. */
  displayMode?: string;
}

/** Image metadata wrapper used across menu entities. */
export interface ToastMenuImage {
  /** Image URL for the asset. */
  imageUrl?: string;
  /** Thumbnail URL for the asset. */
  thumbnailUrl?: string;
  /** Additional metadata provided by Toast. */
  [key: string]: unknown;
}

/** Visibility metadata for menus, groups, items, and modifiers. */
export interface ToastMenuVisibility {
  /** Whether the entity is currently visible. */
  visible?: boolean;
  /** Optional start timestamp for visibility. */
  startDate?: string;
  /** Optional end timestamp for visibility. */
  endDate?: string;
  /** Additional scheduling data. */
  [key: string]: unknown;
}

/** Menu availability schedule entries. */
export interface ToastMenuAvailability {
  /** Indicates the menu is available 24/7. */
  alwaysAvailable?: boolean;
  /** Scheduled availability windows. */
  schedule?: ToastMenuAvailabilityWindow[];
  /** Additional fields from Toast. */
  [key: string]: unknown;
}

/** Individual availability window. */
export interface ToastMenuAvailabilityWindow {
  /** Day of week numeric identifier. */
  dayOfWeek?: number;
  /** Start time for the window (HH:mm). */
  startTime?: string;
  /** End time for the window (HH:mm). */
  endTime?: string;
}

/** Item tag metadata used across menu entities. */
export interface ToastMenuItemTag {
  /** Tag name (for example, "Vegetarian"). */
  name?: string;
  /** GUID identifying the tag. */
  guid?: string;
}

/** Portion definition shared by menu items and modifier options. */
export interface ToastMenuPortion {
  /** Portion name (for example, "1st Half"). */
  name?: string;
  /** Portion GUID. */
  guid?: string;
  /** Portion reference identifier. */
  referenceId?: number;
}

/** Pricing rules wrapper returned for size/sequence/time pricing strategies. */
export type ToastPricingRules = Record<string, unknown>;

/** Content advisories container (alcohol, etc.). */
export type ToastContentAdvisories = Record<string, unknown>;

/** Additional imagery container. */
export type ToastMenuImages = Record<string, unknown>;

/** Allergen metadata placeholder. */
export type ToastMenuAllergenItem = Record<string, unknown>;

/** Sales category metadata wrapper. */
export type ToastSalesCategory = Record<string, unknown>;

/** Modifier option tax info container. */
export type ToastModifierOptionTaxInfo = Record<string, unknown>;

