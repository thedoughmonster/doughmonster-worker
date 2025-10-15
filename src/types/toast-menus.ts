import type {
  ToastConfigReference,
  ToastExternalReference,
  ToastReference,
} from "./toast-common.js";

/**
 * Lightweight representations of the Toast Menus API schema.
 */

export interface ToastMenuMetadata {
  restaurantGuid: string;
  lastUpdated: string;
}

export interface ToastMenusDocument {
  restaurantGuid: string;
  lastUpdated: string;
  restaurantTimeZone?: string | null;
  menus: ToastMenu[];
  modifierGroupReferences: Record<string, ToastModifierGroup>;
  modifierOptionReferences: Record<string, ToastModifierOption>;
  preModifierGroupReferences?: Record<string, ToastPreModifierGroup>;
  [key: string]: unknown;
}

export interface ToastMenu extends ToastReference {
  name?: string | null;
  multiLocationId?: string | null;
  referenceId?: string | null;
  menuGroups: ToastMenuGroup[];
  revenueCenters?: ToastExternalReference[];
  serviceAreas?: ToastExternalReference[];
  diningOptions?: ToastExternalReference[];
  [key: string]: unknown;
}

export interface ToastMenuGroup extends ToastReference {
  name?: string | null;
  referenceId?: string | null;
  description?: string | null;
  items: ToastMenuItem[];
  modifierGroups?: ToastModifierGroupReference[];
  displayRank?: number | null;
  [key: string]: unknown;
}

export interface ToastMenuItem extends ToastConfigReference {
  name?: string | null;
  description?: string | null;
  price?: number | null;
  basePrice?: number | null;
  menuItemType?: string | null;
  modifierGroups?: ToastModifierGroupReference[];
  portions?: ToastPortion[];
  tags?: string[];
  [key: string]: unknown;
}

export interface ToastModifierGroupReference extends ToastReference {
  options?: ToastModifierOptionReference[];
  minSelections?: number | null;
  maxSelections?: number | null;
  [key: string]: unknown;
}

export interface ToastModifierOptionReference extends ToastReference {
  priceMode?: string | null;
  defaultQuantity?: number | null;
  maxPerModifierGroup?: number | null;
  [key: string]: unknown;
}

export interface ToastModifierGroup extends ToastReference {
  name?: string | null;
  referenceId?: string | null;
  options: ToastModifierOption[];
  [key: string]: unknown;
}

export interface ToastModifierOption extends ToastConfigReference {
  name?: string | null;
  price?: number | null;
  multiLocationId?: string | null;
  referenceId?: string | null;
  portionReferences?: ToastPortionReference[];
  [key: string]: unknown;
}

export interface ToastPreModifierGroup extends ToastReference {
  name?: string | null;
  referenceId?: string | null;
  options?: ToastPreModifierOption[];
  [key: string]: unknown;
}

export interface ToastPreModifierOption extends ToastReference {
  name?: string | null;
  referenceId?: string | null;
  [key: string]: unknown;
}

export interface ToastPortion extends ToastReference {
  name?: string | null;
  price?: number | null;
  [key: string]: unknown;
}

export interface ToastPortionReference extends ToastReference {
  [key: string]: unknown;
}
