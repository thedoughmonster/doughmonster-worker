// /src/config/orders.ts
// Path: src/config/orders.ts

/** Default local 2-hour window (America/New_York typical morning for a donut shop). */
export const DEFAULT_START_HOUR = 6;   // 06:00
export const DEFAULT_END_HOUR = 8;     // 08:00

/** Hard cap on number of 60-minute slices to protect Worker CPU/memory. */
export const MAX_SLICES_PER_REQUEST = 2; // <= 2 hours max

/** Default Toast numeric timezone offset when not provided.
 *  Adjust per calendar date if DST changes (pass tzOffset in query when needed).
 */
export const DEFAULT_TZ_OFFSET = "-0400"; // EDT example
