# Doughmonster Worker

A Cloudflare Worker that owns Toast authentication, pagination, and response shaping for Doughmonster. It exposes a handful of read-only endpoints so downstream clients only have to make simple HTTP requests.

## Endpoints
| Method | Path | Description | Example |
| ------ | ---- | ----------- | ------- |
| `GET` | `/api/health` | Simple uptime probe that always returns `{ "ok": true }`. | `curl -i https://<worker>/api/health`
| `GET` | `/api/menus` | Returns the currently published Toast menus along with metadata and cache status. | `curl -s "https://<worker>/api/menus" \| jq` |
| `GET` | `/api/orders/latest` | Returns the most recent Toast orders with deterministic ordering and incremental KV-backed caching. Supports `limit`, `detail`, `since`, `minutes`, `start`, `end`, `status`, `locationId`, and optional `debug=1`. | `curl -s "https://<worker>/api/orders/latest?limit=10" \| jq` |
| `GET` | `/api/items-expanded` | Returns the most recent non-voided orders with nested item details and menu metadata. Supports time range, status, location, and limit filters. | `curl -s "https://<worker>/api/items-expanded?status=APPROVED" \| jq` |

All of the API endpoints above are registered directly in `src/worker.ts`; `/api/menus` and `/api/orders/latest` are mounted on the worker router so `/api/items-expanded` can self-fetch them without leaving the worker boundary.

### `/api/orders/latest`
The handler supports flexible time-range and filter parameters:

- `limit` (default 20, maximum 200) controls how many of the latest orders are returned.
- `detail` toggles payload verbosity: `detail=full` (default) returns hydrated order payloads, while `detail=ids` only returns GUIDs.
- `since` accepts an ISO8601 timestamp to override the KV cursor for debugging.
- Provide `start`/`end` or `minutes` to force a manual window instead of the incremental cursor.
- Optional `status` and `locationId` filters match Toast order status and location GUIDs (case-insensitive).

The response shape remains `{ ok, route, limit, detail, minutes, window, expandUsed, count, ids, orders, data?, debug? }`. When both `DEBUG` is truthy in the environment and `?debug=1` is passed, a concise debug summary is included to surface paging and filtering diagnostics.

When no manual window override is supplied, the worker reads the latest fulfilled cursor from KV, fetches Toast orders strictly after that timestamp, merges them into cache, and returns the most recent orders from the cached indices. Results are deduped by order GUID and sorted by opened date (descending) then order GUID (ascending) for deterministic output.

### Incremental Toast Order Caching

`/api/orders/latest` now persists lightweight order snapshots in the `CACHE_KV` binding so each poll only asks Toast for new or updated records. Every order is stored at `orders:byId:<guid>`, daily descending indices live at `orders:index:YYYYMMDD`, and a rolling multi-day list is maintained at `orders:recentIndex`. After each sync the worker advances `orders:lastFulfilledCursor` to the most recent order that normalized to a ready/fulfilled state (`READY_FOR_PICKUP`, `DELIVERED`, `COMPLETED`, etc.), so subsequent requests query Toast starting strictly after that timestamp.

Indices are rewritten on every update to keep GUID ordering stable, and the response is assembled entirely from KV so the UI sees consistent ordering even when Toast returns duplicate pages. To completely clear the cache, delete the `orders:*` keys from the `CACHE_KV` namespace; the next `/api/orders/latest` call will backfill state from Toast within the default 24-hour lookback.

#### Caching telemetry (debug mode)

When the worker runs with `DEBUG` set and you append `?debug=1` (or `?debug=true`) to `/api/orders/latest`, the response includes a `debug` block plus additional telemetry-only fields:

- A parallel `sources` array indicates whether each order in the payload came from the existing KV copy (`cache`), a brand new Toast fetch (`api`), or a refreshed merge of KV and Toast data (`merged`). When `detail=full`, the corresponding `data` entries also include a `_meta` object with the source classification and the KV key that was read.
- The `debug` object now summarizes KV usage (`debug.kv.reads`, `writes`, `indexLoads`, `indexWrites`, and byte estimates), cache effectiveness (`debug.cache.hits`, `.misses`, `.updated`), Toast fetch activity (`debug.api.requests` plus per-page stats), cursor state before/after the run, request parameters echoed back, and request timings (`toastFetchMs`, `kvMs`, `totalMs`).
- Response headers mirror the highlights for quick inspection: `X-Orders-Cache-Hits`, `X-Orders-Cache-Misses`, `X-Orders-Cache-Updated`, `X-Orders-API-Requests`, and `X-Orders-TotalMs`.

Production consumers should continue calling the endpoint without `debug`; the telemetry fields are optional and only materialize when explicitly requested so the normal payload and caching behavior remain unchanged.

### `/api/items-expanded`
This endpoint is built for dashboards that need per-order snapshots with nested items:

- Internally calls `/api/orders/latest` (to load recent orders) and `/api/menus` (to enrich menu metadata) so it reuses the worker's KV cache while returning the same JSON schema as the previous direct-Toast implementation.
- When called without filters it returns the 20 most recent non-voided orders across every approval status (including active and fulfilled orders), sorted from newest to oldest. `/api/orders/latest` handles the rolling lookback/pagination; items-expanded filters out non-line items, aggregates line-level totals, and applies the requested limit.
- Each order groups all items for a Toast check and includes modifier breakdowns, per-item pricing (base, modifier, total), order timing, customer/location metadata, and aggregated totals (base, modifiers, discounts, service charges, tips, and grand total).
- Results are deterministic: orders are sorted by `orderTime` descending (breaking ties with `orderId` then `checkId`), and items are sorted by display/index metadata (display order → creation time → receipt line position → selection index → seat → name → `menuItemId` → `lineItemId`) so nothing jumps between polls.
- `orderData` includes check-level context such as `status`, aggregated delivery/curbside/table metadata, and a `fulfillmentStatus` value that reflects the most advanced selection fulfillment state (NEW → HOLD → SENT → READY).
- Accepts optional ISO-8601 `start`/`end` query parameters; these are forwarded to `/api/orders/latest` when present. Otherwise the shared endpoint uses its adaptive window strategy and items-expanded returns whatever qualifies before the requested limit is reached.
- Supports optional `status` and `locationId` filters and a `limit` that caps the number of orders returned (default 20, maximum 500). Override the default with `?limit=<n>` to request the last `n` qualifying orders.
- Loads the published menu document once per request to hydrate item and modifier names. The response includes a `cacheInfo` block:
  - `cacheInfo.menu` reports `hit-fresh` when the worker cache satisfied the menu request and `miss-network` when it pulled from the upstream API.
  - `cacheInfo.menuUpdatedAt` surfaces the ISO timestamp stored alongside the cached document (undefined until the first successful fetch populates KV).

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

#### Debugging

- Append `?debug=1` (or `true`/`debug`) to enable a rich debug payload along with diagnostic headers.
- Debug mode adds the `x-request-id`, `x-items-expanded-debug`, `x-up-orders-status`, `x-up-menu-status`, and `x-qualifying-found` headers to responses.
- Response body snippets in debug output are limited to 512 characters and are only emitted when debug mode is explicitly enabled.

### `/api/menus`
`GET /api/menus` responds with:

```
{
  ok: true,
  menu: <ToastMenusDocument | null>,
  metadata: { lastUpdated: <ISO string | null> },
  cacheHit: <boolean>
}
```

- `menu` is the cached Toast `menus/v2/menus` document (or `null` when Toast has nothing published).
- `metadata.lastUpdated` echoes the timestamp saved alongside the cached document so downstream services can track refreshes.
- `cacheHit` is `true` when the worker satisfied the request from KV without needing to hit Toast.

Append `?refresh=1` (or any other truthy value such as `true`, `yes`, `on`) to force a synchronous refresh that bypasses the cached copy. Non-truthy values leave the cache untouched while still returning the stored payload.

#### Menu caching strategy

The published menu is cached in the shared `CACHE_KV` namespace:

- The full document lives at `menu:published:v1`; metadata (`updatedAt`, `staleAt`, `expireAt`, optional `etag`) is stored at `menu:published:meta:v1`.
- Reads are considered fresh for 30 minutes. Between 30 minutes and 24 hours the worker serves the cached document immediately and schedules a background refresh via `waitUntil`.
- After 24 hours the worker blocks on Toast before replying and overwrites both KV entries with the new payload and timestamps.
- Appending a truthy `refresh` query parameter to `/api/menus` (for example `/api/menus?refresh=1` or `/api/items-expanded?refresh=true`) forces a synchronous revalidate and updates the KV entries regardless of age.
- Responses that rely on the cached menu surface `cacheInfo.menuUpdatedAt` so you can see when the document was last refreshed.

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
| `CACHE_KV` | KV namespace | Holds shared caches, including the published menu document. |

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

## Self-Fetching & Origins
- `/api/items-expanded` now builds absolute self-URLs using the incoming request origin by default.
- Provide `?selfOrigin=https://<your-host>` when debugging mismatched hosts; the override is used for worker self-fetches only.
- When `?debug=1` is present, the handler logs the absolute self-fetch URLs alongside detailed upstream diagnostics.
- On a 404 from `/api/orders/latest`, the handler falls back to dispatching the internal handler directly to avoid routing gaps.
