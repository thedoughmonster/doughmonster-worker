import type { ToastReference } from "./toast-orders.js";

/**
 * Toast Kitchen API prep station definition.
 */
export interface ToastPrepStation extends ToastReference {
  /** Other prep stations monitored by this station. */
  connectedPrepStations?: ToastReference[];
  /** Printer routing behavior for the prep station. */
  printingMode?: "ON" | "OFFLINE_ONLY";
  /** When true, also route tickets to the restaurant expediter. */
  includeWithExpediter?: boolean;
  /** Expo routing behavior for tickets sent to this station. */
  expoRouting?: "SEND_TO_EXPO" | "EXPO_ONLY" | "SKIP_EXPO";
  /** Human readable prep station name. */
  name?: string;
  /** Printer assigned to the prep station. */
  kitchenPrinter?: ToastReference;
}

/**
 * Result wrapper returned by the Doughmonster Worker kitchen endpoint.
 */
export interface ToastPrepStationsResult {
  /** Prep stations returned by the Toast Kitchen API. */
  prepStations: ToastPrepStation[];
  /** Pagination token for the next page of results, if present. */
  nextPageToken: string | null;
}
