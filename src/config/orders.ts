// /src/config/orders.ts
// Path: src/config/orders.ts

/** Default local business hours (America/New_York typical daytime). */
export const DEFAULT_START_HOUR = 6;   // 06:00
export const DEFAULT_END_HOUR = 20;    // 20:00

/** Hard cap on number of 60-minute slices to protect Worker CPU/memory. */
export const MAX_SLICES_PER_REQUEST = 16; // 16 hours max per call

/** Default Toast numeric timezone offset when not provided. */
export const DEFAULT_TZ_OFFSET = "-0400"; // EDT example; override via query when needed
