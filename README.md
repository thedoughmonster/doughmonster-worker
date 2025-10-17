# Doughmonster Worker

A Cloudflare Worker that owns Toast authentication, pagination, and response shaping for Doughmonster. It exposes a handful of read-only endpoints so downstream clients only have to make simple HTTP requests.

## Endpoints
| Method | Path | Description | Example |
| ------ | ---- | ----------- | ------- |
| `GET` | `/api/health` | Simple uptime probe that always returns `{ "ok": true }`. | `curl -i https://<worker>/api/health`
| `GET` | `/api/menus` | Returns the currently published Toast menus along with metadata and cache status. | `curl -s "https://<worker>/api/menus" \| jq` |
| `GET` | `/api/orders/latest` | Returns the most recent Toast orders (default 60 minute window, max 120). Accepts `?minutes=` and optional `?debug=1` for diagnostics. | `curl -s "https://<worker>/api/orders/latest?minutes=30" \| jq` |
| `GET` | `/api/items-expanded` | Returns the most recent non-voided orders with nested item details and menu metadata. Supports time range, status, location, and limit filters. | `curl -s "https://<worker>/api/items-expanded?status=APPROVED" \| jq` |

### `/api/orders/latest`
The handler accepts an optional `?minutes=` query parameter that clamps between 1 and 120 minutes (default 60) and fetches all pages from `orders/v2/ordersBulk` until no more data is available. It returns the familiar payload shape `{ ok, route, minutes, window, detail, expandUsed, count, ids, orders, data, debug? }`. When `?debug=1` is present an additional `debug.pages` array is included that details each paginated request.

### `/api/items-expanded`
This endpoint is built for dashboards that need per-order snapshots with nested items:

- When called without filters it returns the 20 most recent non-voided orders across every approval status (including active and fulfilled orders), sorted from newest to oldest. The worker automatically pages through up to the last seven days of Toast data to surface the latest results without requiring a time window.
- Each order groups all items for a Toast check and includes modifier breakdowns, per-item pricing (base, modifier, total), order timing, customer/location metadata, and aggregated totals (base, modifiers, discounts, service charges, tips, and grand total).
- `orderData` includes check-level context such as `status`, aggregated delivery/curbside/table metadata, and a `fulfillmentStatus` value that reflects the most advanced selection fulfillment state (NEW → HOLD → SENT → READY).
- Accepts optional ISO-8601 `start`/`end` query parameters; when omitted the endpoint simply returns the latest orders.
- Supports optional `status` and `locationId` filters and a `limit` that caps the number of orders returned (default 20, maximum 500).
- Loads the published menu document once per request to hydrate item and modifier names.

#### Filters

| Query        | Description                                                                                   | Example                                            |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `start`      | ISO-8601 timestamp (UTC) for the beginning of the window. Optional; omit to return the latest orders regardless of start time.   | `/api/items-expanded?start=2024-03-09T14:00:00Z`   |
| `end`        | ISO-8601 timestamp (UTC) for the end of the window. Optional; defaults to "now" when only `start` is provided.             | `/api/items-expanded?end=2024-03-09T16:00:00Z`     |
| `status`     | Case-insensitive Toast order status filter.                                                   | `/api/items-expanded?status=paid`                  |
| `locationId` | Restrict results to a single Toast location GUID.                                             | `/api/items-expanded?locationId=<location-guid>`   |
| `limit`      | Maximum number of orders to return (1-500, default 20). Values above 500 are automatically clamped. | `/api/items-expanded?limit=25`                     |

#### Sample requests

- Most recent orders across all statuses: `curl -s "https://<worker>/api/items-expanded" \| jq`
- Filtered by location and status with custom window: `curl -s "https://<worker>/api/items-expanded?locationId=<location-guid>&status=closed&start=2024-03-09T14:00:00Z&end=2024-03-09T16:00:00Z" \| jq`

### `/api/menus`
`/api/menus` returns `{ ok, metadata, menu, cacheHit }` where:

- `metadata` mirrors Toast's `menus/v2/metadata` payload so clients can track last update timestamps.
- `menu` matches the Toast `menus/v2/menus` response or `null` when Toast has no published menu data.
- `cacheHit` reports whether the worker served the data from its in-memory cache (see below).

#### Menu caching strategy

The worker keeps the most recent published menu in memory and reuses it until Toast reports a different `lastUpdated` value. This minimizes Toast API traffic while still returning fresh data as soon as Toast publishes a new menu. The cache is per-worker instance and resets when the worker is cold-started or redeployed.

## Operations UI

Visiting the root path (`/`) now serves a standalone "Orders – All Day View" dashboard powered by the static files in `/public`.
The experience mirrors the needs of an expediter station and runs entirely in the browser—no additional framework required.

- Polls `/api/items-expanded` every 10 seconds (configurable in `public/app.js`) and re-renders without full-page refreshes.
- Fixed top bar shows the live clock, open order count (after filters), lookback toggle (`Default` vs `Full Day`), and the last
  successful refresh timestamp.
- Modifier rail on the left aggregates modifiers across the currently visible orders (collapsible on small screens).
- Order cards combine identical line items, collapse duplicate modifiers, surface fulfillment status chips, and highlight due
  times (overdue vs. due soon).
- Filters include `All`, `Open`, `Ready`, and `Delivery`. Switching to the "Full Day" lookback adds `start/end` parameters to the
  API request covering local midnight through "now".

### Local development

1. Start the worker with `npm run dev` (Wrangler serves the worker and static assets).
2. Open `http://127.0.0.1:8787/` to load the dashboard. The page polls the co-located API, so no additional configuration is
   required.
3. Customize intervals, styles, or behavior via the files in `/public`.

## Environment variables
| Name | Type | Purpose |
| ---- | ---- | ------- |
| `TOAST_API_BASE` | string | Base URL for Toast REST requests (e.g. `https://ws-api.toasttab.com`). |
| `TOAST_AUTH_URL` | string | Toast login endpoint used to mint machine tokens. |
| `TOAST_CLIENT_ID` | secret | Machine client ID for Toast auth. |
| `TOAST_CLIENT_SECRET` | secret | Machine client secret for Toast auth. |
| `TOAST_RESTAURANT_GUID` | string | Toast restaurant GUID forwarded via headers. |
| `TOKEN_KV` | KV namespace | Stores the cached bearer token. |

## Run locally / deploy
```bash
# Type-check and build
npm run check
npm run build

# Execute unit tests
npm test

# Start the worker locally
npm run dev

# Deploy to Cloudflare (requires authenticated Wrangler session)
wrangler deploy
```
Configure secrets/KV bindings via `wrangler.toml`, `.dev.vars`, or the Cloudflare dashboard before running locally or deploying.
