# Doughmonster Worker

A Cloudflare Worker that owns Toast authentication, pagination, and response shaping for Doughmonster. It exposes a handful of read-only endpoints so downstream clients only have to make simple HTTP requests.

## Endpoints
| Method | Path | Description | Example |
| ------ | ---- | ----------- | ------- |
| `GET` | `/api/health` | Simple uptime probe that always returns `{ "ok": true }`. | `curl -i https://<worker>/api/health`
| `GET` | `/api/docs/openapi.json` | Raw OpenAPI schema for the worker—ideal for AI agents and generated clients. | `curl -s "https://<worker>/api/docs/openapi.json" \| jq '.info.title'`
| `GET` | `/api/docs/openapi.js` | ES module that `export default`s the OpenAPI schema for direct imports. | `curl -s "https://<worker>/api/docs/openapi.js" \| head`
| `GET` | `/docs` | ReDoc-powered HTML viewer that renders the same OpenAPI schema. | Visit `https://<worker>/docs`
| `GET` | `/api/menus` | Returns the currently published Toast menus along with metadata and cache status. | `curl -s "https://<worker>/api/menus" \| jq` |
| `GET` | `/api/orders/latest` | Returns the most recent Toast orders with deterministic ordering and incremental KV-backed caching. Supports `limit`, `detail`, `since`, `minutes`, `start`, `end`, `status`, `locationId`, and optional `debug=1`. | `curl -s "https://<worker>/api/orders/latest?limit=10" \| jq` |
| `GET` | `/api/orders-merged` | Fetches `/api/orders/latest` and `/api/menus`, returning both payloads without modifying either response body. | `curl -s "https://<worker>/api/orders-merged" \| jq` |
| `GET` | `/api/orders-detailed` | Returns the most recent non-voided orders with nested item details and menu metadata. Supports time range, status, fulfillment-status, location, and limit filters. | `curl -s "https://<worker>/api/orders-detailed?fulfillmentStatus=READY_FOR_PICKUP" \| jq` |
| `GET` | `/api/config/snapshot` | Fetches a fixed set of Toast configuration slices and caches the merged payload for 1 hour. | `curl -s "https://<worker>/api/config/snapshot" \| jq` |

> **Migration notice:** `/api/items-expanded` now serves as a temporary alias for `/api/orders-detailed` and emits a `Deprecation: true` header plus a successor `Link`. Update clients to the new path before the alias is removed.

All of the API endpoints above are registered directly in `src/worker.ts`; `/api/menus` and `/api/orders/latest` are mounted on the worker router so `/api/orders-detailed` can self-fetch them without leaving the worker boundary.

### API documentation

Run `npm run docs` to regenerate the structured OpenAPI definitions under `schemas/`. Both `openapi.json` and `openapi.yaml` are derived artifacts—commit the generated output, but do not edit either file manually. Once generated, the schema is served from `/api/docs/openapi.json`, exposed as an ES module at `/api/docs/openapi.js`, and rendered at `/docs` for humans and AI clients alike.

### Config Snapshot (1h cache)

`GET /api/config/snapshot` aggregates six Toast configuration slices—`diningOptions`, `orderTypes`, `revenueCenters`, `serviceAreas`, `taxRates`, and `discounts`—into a single payload. The response is cached in `CACHE_KV` for one hour with the cache key `toast:config:snapshot:all:<tenant-or-location>`, so subsequent calls within that window return immediately without re-fetching Toast.

- Fetch the snapshot: `curl -s "$BASE_URL/api/config/snapshot" \| jq`
- Each slice that fails upstream is represented as `null`; successful slices retain the JSON returned by Toast.

Response shape:

```json
{
  "updatedAt": "<ISO timestamp>",
  "ttlSeconds": 3600,
  "data": {
    "diningOptions": [/* ... */],
    "orderTypes": [/* ... */],
    "revenueCenters": [/* ... */],
    "serviceAreas": [/* ... */],
    "taxRates": [/* ... */],
    "discounts": [/* ... */]
  }
}
```

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

### `/api/orders-detailed`
This endpoint is built for dashboards that need per-order snapshots with nested items:

- Internally calls `/api/orders/latest` (to load recent orders) and `/api/menus` (to enrich menu metadata) so it reuses the worker's KV cache while returning the same JSON schema as the previous direct-Toast implementation.
- When called without filters it returns the 20 most recent non-voided orders across every approval status (including active and fulfilled orders), sorted from newest to oldest. `/api/orders/latest` handles the rolling lookback/pagination; orders-detailed filters out non-line items, aggregates line-level totals, and applies the requested limit.
- Each order groups all items for a Toast check and includes modifier breakdowns, per-item pricing (base, modifier, total), order timing, customer/location metadata, and aggregated totals (base, modifiers, discounts, service charges, tips, and grand total).
- Results are deterministic: orders are sorted by `orderTime` descending (breaking ties with `orderId` then `checkId`), and items are sorted by display/index metadata (display order → creation time → receipt line position → selection index → seat → name → `menuItemId` → `lineItemId`) so nothing jumps between polls.
- `orderData` includes check-level context such as `status`, aggregated delivery/curbside/table metadata, and a `fulfillmentStatus` value that reflects the most advanced selection fulfillment state (NEW → HOLD → SENT → READY).
- Accepts optional ISO-8601 `start`/`end` query parameters; these are forwarded to `/api/orders/latest` when present. Otherwise the shared endpoint uses its adaptive window strategy and orders-detailed returns whatever qualifies before the requested limit is reached.
- Supports optional `status`, `fulfillmentStatus`, and `locationId` filters and a `limit` that caps the number of orders returned (default 20, maximum 500). Override the default with `?limit=<n>` to request the last `n` qualifying orders.
- **Response memoization:** Expanded orders are cached for five minutes using an order/check fingerprint (Toast `lastModifiedDate`, `version`, and selection ids/quantities/prices/status) so identical payloads skip rebuilding. Cache entries are deep-cloned before returning, capped at 250 entries, and `enrichExpandedOrders` still runs on every response to refresh dining-option metadata.
- **Progressive lookback:** When not using an explicit `start`/`end` range, the handler may retry `/api/orders/latest` with minute windows `[60, 240, 480, 1440, 2880, 4320, 10080]` until it fills the requested limit or reaches the 7-day fallback window.
- Loads the published menu document once per request to hydrate item and modifier names. The derived menu index is cached in-memory by the menu metadata timestamp (with a fallback bucket when no timestamp is available) so identical payloads reuse the same lookup without re-indexing. Only the active timestamp entry plus the fallback bucket are retained, ensuring the cache holds at most two menu indexes at any time. The response includes a `cacheInfo` block:
  - `cacheInfo.menu` reports `hit-fresh` when the worker cache satisfied the menu request and `miss-network` when it pulled from the upstream API.
  - `cacheInfo.menuUpdatedAt` surfaces the ISO timestamp stored alongside the cached document (undefined until the first successful fetch populates KV).

#### Filters

| Query        | Description                                                                                   | Example                                            |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `start`      | ISO-8601 timestamp (UTC) for the beginning of the window. Optional; omit to return the latest orders regardless of start time.   | `/api/orders-detailed?start=2024-03-09T14:00:00Z`   |
| `end`        | ISO-8601 timestamp (UTC) for the end of the window. Optional; defaults to "now" when only `start` is provided.             | `/api/orders-detailed?end=2024-03-09T16:00:00Z`     |
| `status`     | Case-insensitive Toast order status filter.                                                   | `/api/orders-detailed?status=paid`                  |
| `fulfillmentStatus` | Filter orders by the aggregated order-level fulfillment status. Accepts repeated or comma-separated values (case-insensitive). | `/api/orders-detailed?fulfillmentStatus=ready_for_pickup&fulfillmentStatus=in_preparation` |
| `locationId` | Restrict results to a single Toast location GUID.                                             | `/api/orders-detailed?locationId=<location-guid>`   |
| `limit`      | Maximum number of orders to return (1-500, default 20). Values above 500 are automatically clamped. | `/api/orders-detailed?limit=25`                     |

#### Sample requests

- **Window controls (`start` / `end`)**
  - Most recent orders since a specific timestamp: `curl -s "https://<worker>/api/orders-detailed?start=2024-03-09T14:00:00Z" \| jq`
  - Explicit window with both bounds: `curl -s "https://<worker>/api/orders-detailed?start=2024-03-09T14:00:00Z&end=2024-03-09T16:00:00Z" \| jq`
  - Cap results before a cutoff without forcing a manual start: `curl -s "https://<worker>/api/orders-detailed?end=2024-03-09T16:00:00Z" \| jq`
- **Status filter (`status`)**
  - Only orders in a single Toast status: `curl -s "https://<worker>/api/orders-detailed?status=paid" \| jq`
  - Combine status with a time window: `curl -s "https://<worker>/api/orders-detailed?status=closed&start=2024-03-09T12:00:00Z" \| jq`
- **Fulfillment status filter (`fulfillmentStatus`)**
  - Case-insensitive single value: `curl -s "https://<worker>/api/orders-detailed?fulfillmentStatus=ready_for_pickup" \| jq`
  - Repeated parameters: `curl -s "https://<worker>/api/orders-detailed?fulfillmentStatus=ready_for_pickup&fulfillmentStatus=IN_PREPARATION" \| jq`
  - Comma-separated list: `curl -s "https://<worker>/api/orders-detailed?fulfillmentStatus=READY_FOR_PICKUP,in_preparation" \| jq`
- **Location filter (`locationId`)**
  - Restrict to a single location: `curl -s "https://<worker>/api/orders-detailed?locationId=<location-guid>" \| jq`
  - Layer with status filtering: `curl -s "https://<worker>/api/orders-detailed?locationId=<location-guid>&status=open" \| jq`
- **Limit override (`limit`)**
  - Request more recent orders (up to 500): `curl -s "https://<worker>/api/orders-detailed?limit=50" \| jq`
  - Tight limit while filtering: `curl -s "https://<worker>/api/orders-detailed?fulfillmentStatus=READY_FOR_PICKUP&limit=10" \| jq`
- Most recent orders across all statuses: `curl -s "https://<worker>/api/orders-detailed" \| jq`
- Filtered by location and status with custom window: `curl -s "https://<worker>/api/orders-detailed?locationId=<location-guid>&status=closed&start=2024-03-09T14:00:00Z&end=2024-03-09T16:00:00Z" \| jq`
- Filtered by fulfillment status: `curl -s "https://<worker>/api/orders-detailed?fulfillmentStatus=ready_for_pickup&fulfillmentStatus=IN_PREPARATION" \| jq`

#### Debugging

- Append `?debug=1` (or `true`/`debug`) to enable a rich debug payload along with diagnostic headers.
- Debug mode adds the `x-request-id`, `x-orders-detailed-debug`, `x-up-orders-status`, `x-up-menu-status`, and `x-qualifying-found` headers to responses.
- Response body snippets in debug output are limited to 512 characters and are only emitted when debug mode is explicitly enabled.

### `/api/orders-merged`
This helper endpoint keeps `/api/orders/latest` and `/api/menus` as independent payloads while bundling them into a single response:

```
{
  ok: true,
  route: "/api/orders-merged",
  orders: <payload from /api/orders/latest>,
  menus: <payload from /api/menus>
}
```

- Call it with `curl -s "https://<worker>/api/orders-merged" \| jq` to receive the aggregated JSON.
- If either upstream request fails or returns non-JSON, the worker responds with HTTP 502 and echoes lightweight status details for troubleshooting.

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
- Appending a truthy `refresh` query parameter to `/api/menus` (for example `/api/menus?refresh=1` or `/api/orders-detailed?refresh=true`) forces a synchronous revalidate and updates the KV entries regardless of age.
- Responses that rely on the cached menu surface `cacheInfo.menuUpdatedAt` so you can see when the document was last refreshed.

## Operations & Monitoring

The worker now ships without a dashboard or static asset pipeline; all operations are performed through its HTTP API. Routine checks focus on endpoint availability, cache state, and Toast synchronization rather than UI behavior.

- **Health probe:** `curl -i "$BASE_URL/api/health"` should return `200 OK` with `{ "ok": true }`.
- **Order freshness:** `curl -s "$BASE_URL/api/orders/latest?limit=5" | jq '.ids'` confirms cursor advancement.
- **Expanded orders:** `curl -s "$BASE_URL/api/orders-detailed?limit=3" | jq '.orders[0].items | length'` validates enrichment and aggregation.
- **Config snapshot:** `curl -s "$BASE_URL/api/config/snapshot" | jq '.ttlSeconds'` surfaces cache TTLs and highlights stale slices.

Set `BASE_URL` to either the production worker domain or your local dev URL (`http://127.0.0.1:8787`) before running the examples.

### Cache maintenance

- Menus: `wrangler kv:key list --namespace-id $CACHE_KV --prefix menu:` shows the cached menu keys; delete with `wrangler kv:key delete --namespace-id $CACHE_KV menu:published:v1` to force a refresh on the next request.
- Orders: remove the `orders:*` keys from `CACHE_KV` to flush incremental indices before re-polling Toast.
- Tokens: if authentication fails, rotate the `TOKEN_KV` secret or delete the cached bearer token key to trigger a re-login.

### Local development

1. Create a `.dev.vars` file (ignored by git) to supply the Toast credentials and bindings expected by the worker:
   ```bash
   cat <<'EOF' > .dev.vars
   TOAST_API_BASE=https://ws-api.toasttab.com
   TOAST_AUTH_URL=https://auth.toasttab.com
   TOAST_CLIENT_ID=your-machine-client-id
   TOAST_CLIENT_SECRET=your-machine-client-secret
   TOAST_RESTAURANT_GUID=your-restaurant-guid
   DEBUG=1
   EOF
   ```
   Define `TOKEN_KV` and `CACHE_KV` in `wrangler.toml` so Wrangler maps them to local KV namespaces during `wrangler dev`.
2. Start the worker with `npm run dev` and interact with the API directly: `curl -s http://127.0.0.1:8787/api/health`.
3. Use the same curl workflows as production to exercise orders, menus, and config endpoints while iterating on backend logic.

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
- `/api/orders-detailed` and `/api/orders-merged` now call their sibling handlers (`/api/orders/latest` and `/api/menus`) directly inside the worker instead of issuing HTTP self-requests. This avoids the Cloudflare 404 (`error code: 1042`) caused by workers.dev vs. custom domain routing mismatches.
- If a direct invocation throws or returns an unexpected payload, the composite route falls back to the legacy network fetch for safety. The debug traces expose this via `internalFallbackUsed: true` and `path: "network"` along with the original status/snippet details.
- Successful direct calls surface `path: "direct"` (plus `cacheHit` for menu lookups) in the debug payloads so you can confirm the fast path is being used.
- The optional network fallback keeps the previous header forwarding and snippet capture so existing diagnostics remain intact while we evaluate a future service binding for self-calls.

## `/api/orders-detailed`

### Query parameters
- `limit` (default 20, max 500): number of expanded orders to return after aggregation.
- `start`, `end`: ISO timestamps forwarded to `/api/orders/latest`.
- `status`, `locationId`, `detail`: forwarded filters for the upstream orders endpoint (defaults to `detail=full`).
- `refresh=1`: bypasses the cached menu document.
- `debug=1`: appends verbose diagnostics in the JSON response.

### Response
- `orders`: array of expanded orders (newest first) containing `orderData`, `items`, and `totals` blocks.
- `cacheInfo`: object with `menu` cache status (`hit-fresh` or `miss-network`) and `menuUpdatedAt` timestamp.
- `debug` (when `debug=1`): includes upstream request traces, processing timers, counters for filtered items, and `timedOut` when the 3s budget is exceeded.
