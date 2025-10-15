/**
 * Shared type helpers derived from the Toast orders and menus OpenAPI schemas.
 *
 * These types intentionally capture the minimal shape required by the worker
 * while preserving the identifiers defined by the schemas. When you need
 * additional fields, consult the schema in `src/schemas` and extend these
 * definitions accordingly.
 */

export interface ToastReference {
  /** Toast generated GUID for the referenced entity. */
  guid: string;
  /** Response-only entity type indicator. */
  entityType?: string;
}

export interface ToastExternalReference extends ToastReference {
  /** Optional partner supplied identifier. */
  externalId?: string | null;
}

export interface ToastConfigReference extends ToastReference {
  /** Shared identifier across locations for a Toast configuration entity. */
  multiLocationId?: string | null;
  /** Optional external identifier. */
  externalId?: string | null;
}

export interface ToastMoneyAmount {
  /** Currency amount represented as a decimal. */
  amount: number;
  /** ISO 4217 currency code. */
  currencyCode: string;
  /** True when the amount already includes taxes. */
  inclusive?: boolean;
}

export type ToastNullableDateTime = string | null | undefined;
