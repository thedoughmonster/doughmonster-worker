# Doughmonster Worker

A Cloudflare Worker that owns Toast authentication, pagination, and response shaping for Doughmonster. It exposes a handful of read-only endpoints so downstream clients only have to make simple HTTP requests.

## Endpoints
| Method | Path | Description | Example |
| ------ | ---- | ----------- | ------- |
| `GET` | `/api/health` | Simple uptime probe that always returns `{ "ok": true }`. | `curl -i https://<worker>/api/health`
| `GET` | `/api/menus` | Returns the currently published Toast menus along with metadata and cache status. | `curl -s "https://<worker>/api/menus" \| jq` |
| `GET` | `/api/orders/latest` | Returns the most recent Toast orders (default 60 minute window, max 120). Accepts `?minutes=` and optional `?debug=1` for diagnostics. | `curl -s "https://<worker>/api/orders/latest?minutes=30" \| jq` |
| `GET` | `/api/items-expanded` | Flattens Toast orders into individual line items enriched with menu metadata. Supports time range, status, location, and limit filters. | `curl -s "https://<worker>/api/items-expanded?status=OPEN" \| jq` |

### `/api/orders/latest`
The handler accepts an optional `?minutes=` query parameter that clamps between 1 and 120 minutes (default 60) and fetches all pages from `orders/v2/ordersBulk` until no more data is available. It returns the familiar payload shape `{ ok, route, minutes, window, detail, expandUsed, count, ids, orders, data, debug? }`. When `?debug=1` is present an additional `debug.pages` array is included that details each paginated request.

### `/api/items-expanded`
This endpoint is designed for dashboards that need flattened line items. It:

- Accepts optional ISO-8601 `start`/`end` query parameters defining the Toast order window (defaulting to the last 2 hours ending at "now").
- Supports optional `status` and `locationId` filters and a `limit` (default 500, maximum 5000).
- Fetches the published menu document once per request to cross-reference item and modifier names.
- Returns `{ items: ExpandedItem[] }` where each item includes order metadata, timing information, the resolved item/modifier names, special instructions, and price/currency details when available.

#### Filters

| Query        | Description                                                                                   | Example                                            |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `start`      | ISO-8601 timestamp (UTC) for the beginning of the window. Defaults to 2 hours before `end`.   | `/api/items-expanded?start=2024-03-09T14:00:00Z`   |
| `end`        | ISO-8601 timestamp (UTC) for the end of the window. Defaults to the current time.             | `/api/items-expanded?end=2024-03-09T16:00:00Z`     |
| `status`     | Case-insensitive Toast order status filter.                                                   | `/api/items-expanded?status=paid`                  |
| `locationId` | Restrict results to a single Toast location GUID.                                             | `/api/items-expanded?locationId=<location-guid>`   |
| `limit`      | Maximum number of expanded items to return (1-5000, default 500).                             | `/api/items-expanded?limit=250`                    |

#### Sample requests

- All items from the last two hours in chronological order: `curl -s "https://<worker>/api/items-expanded" \| jq`
- Filtered by location and status with custom window: `curl -s "https://<worker>/api/items-expanded?locationId=<location-guid>&status=closed&start=2024-03-09T14:00:00Z&end=2024-03-09T16:00:00Z" \| jq`

### `/api/menus`
`/api/menus` returns `{ ok, metadata, menu, cacheHit }` where:

- `metadata` mirrors Toast's `menus/v2/metadata` payload so clients can track last update timestamps.
- `menu` matches the Toast `menus/v2/menus` response or `null` when Toast has no published menu data.
- `cacheHit` reports whether the worker served the data from its in-memory cache (see below).

#### Menu caching strategy

The worker keeps the most recent published menu in memory and reuses it until Toast reports a different `lastUpdated` value. This minimizes Toast API traffic while still returning fresh data as soon as Toast publishes a new menu. The cache is per-worker instance and resets when the worker is cold-started or redeployed.

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
