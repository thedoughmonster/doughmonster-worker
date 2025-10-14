# Doughmonster Worker

Doughmonster Worker is a Cloudflare Worker that proxies a subset of the Toast API with guardrails that keep requests paced, cached, and observable. The worker exposes a JSON-only surface that our applications call to fetch menu metadata and recent orders while shielding downstream clients from Toast authentication, pagination, and rate limits.

## Table of contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Environment & bindings](#environment--bindings)
- [Endpoints](#endpoints)
  - [Menu](#menu)
  - [Orders](#orders)
  - [Debug & operations](#debug--operations)
- [Local development](#local-development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Overview
- **Platform:** Cloudflare Workers (module syntax) with KV namespaces for both auth tokens and cached payloads.
- **Primary responsibilities:**
  - Fetch Toast menus (v2/v3) with light caching and pacing.
  - Aggregate Toast orders across time windows and expose normalized JSON.
  - Provide operational/debug routes for rate limiting, bindings, and token health.
- **Tech stack:** TypeScript, Wrangler 4, Cloudflare KV, Toast REST APIs.

## Architecture
- `src/worker.ts` is the entry point. It routes incoming requests to per-endpoint handlers and returns JSON 404/500 responses when necessary.
- Menu and order handlers live under `src/routes/api/**` and share helper libraries in `src/lib/**` for auth, pacing, rate limiting, and HTTP helpers.
- Toast authentication tokens are cached in `TOKEN_KV`; the worker refreshes and reuses them via `getAccessToken` in `src/lib/toastAuth.ts`. Toast calls are spaced out using `paceBeforeToastCall` to respect vendor rate limits.
- Orders fetches rely on `getOrdersWindow`/`getOrdersWindowFull` to normalize responses and capture diagnostic slices for debugging, while `/api/orders/latest` now calls the Toast Orders Bulk API directly with built-in pagination, retries, and pacing controls.
- Rate limiting controls and single-flight helpers use `CACHE_KV` (`src/lib/rateLimit.ts`).

## Environment & bindings
Configure these in `wrangler.toml`, Secrets, or the Cloudflare dashboard.

| Name | Type | Required | Purpose |
| ---- | ---- | -------- | ------- |
| `TOAST_API_BASE` | string | ✅ | Base URL for Toast REST requests (e.g. `https://ws-api.toasttab.com`). |
| `TOAST_AUTH_URL` | string | ✅ | Toast login endpoint used to mint machine tokens. |
| `TOAST_CLIENT_ID` | secret | ✅ | Toast machine client ID used for auth. |
| `TOAST_CLIENT_SECRET` | secret | ✅ | Toast machine client secret. |
| `TOAST_RESTAURANT_GUID` | secret | ✅ | Restaurant GUID routed to Toast APIs and headers. |
| `TOKEN_KV` | KV namespace | ✅ | Stores cached Toast access tokens and related stats. |
| `CACHE_KV` | KV namespace | ✅ | Holds menu caches, rate-limit cooldowns, and single-flight locks. |
| `DM_ADMIN_KEY` | secret | ⛔ optional | Required to clear rate limits via `/api/debug/rl/clear`. |

Set secrets locally with Wrangler:
```bash
wrangler secret put TOAST_CLIENT_ID
wrangler secret put TOAST_CLIENT_SECRET
wrangler secret put TOAST_RESTAURANT_GUID
wrangler secret put DM_ADMIN_KEY
```

## Endpoints
All endpoints return JSON. Unless noted otherwise, responses are cached only by Toast/Cloudflare defaults and will surface `ok: false` with descriptive errors when something fails.

### Menu
| Method & path | Description | Query params |
| ------------- | ----------- | ------------ |
| `GET /api/menu` | Fetches Toast menu documents (v2). Requests are paced (~1 req/sec). Returns `{ ok, apiVersion: "v2", data }`. | _None_ |
| `GET /api/menu/metadata` | Fetches metadata (v3 with automatic v2 fallback on 403/404). Provides `{ ok, apiVersion, data }` or `{ ok: false, error }` with upstream status code. | _None_ |
| `GET /api/menu/dict` | Builds menu item data `{ guid, name, basePrice, salesCategoryName, multiLocationId }`. Supports optional `lastModified` filtering and `as=array` to return an array instead of the default dictionary. | `lastModified`, `as` |

### Orders
| Method & path | Description | Query params |
| ------------- | ----------- | ------------ |
| `GET /api/orders/by-date` | Aggregates hourly slices for a local day. Requires `date=YYYY-MM-DD`. Optional `tzOffset` (default `+0000`), `startHour`, `endHour`, `detail=ids|full` (`ids` default), `debug=1`. Returns aggregated ids or full orders plus slice metadata. | `date` (required), `tzOffset`, `startHour`, `endHour`, `detail`, `debug` |
| `GET /api/orders/by-range` | Pulls orders across a precise ISO range (max 2 hours). Requires `start` and `end` in Toast ISO format (`YYYY-MM-DDTHH:mm:ss.SSS±HHmm`). Optional `detail=full|ids` (`full` default) and `debug=1`. Returns combined data and optional debug slices. | `start` (required), `end` (required), `detail`, `debug` |
| `GET /api/orders/latest` | Fetches full expanded orders for the last `?minutes=` (default 60, max 120) using Toast's Orders Bulk API. Handles pagination (100 orders/page), retry-on-429, and returns ids, orders array, and metadata about the window. Optional `debug=1` adds request diagnostics. | `minutes`, `debug` |

### Debug & operations
| Method & path | Description | Notes |
| ------------- | ----------- | ----- |
| `GET /api/debug/token` | Retrieves a preview of the cached Toast access token to confirm auth. | Never returns the full token—only the first 12 characters. Useful for verifying refresh success. |
| `GET /api/debug/bindings` | Verifies Worker bindings (KV namespaces, Toast credentials) are present. | Helps diagnose misconfigured deployments. |
| `GET /api/debug/rl` | Returns whether the Worker is currently rate limited and when it will clear automatically. | Based on `CACHE_KV` cooldown state. |
| `POST /api/debug/rl/clear` | Clears rate-limit cooldowns. | Requires `x-dm-admin-key` header matching `DM_ADMIN_KEY`. Responds with `{ ok: true, cleared: true }`. |
| `GET /api/debug/auth-stats` | Shows token cache metadata (preview, expiry, refresh counters). | Reads diagnostic stats stored alongside auth tokens in KV. |

## Local development
1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Run the worker locally:**
   ```bash
   npm run dev
   ```
   Wrangler will watch for changes and serve the worker at `http://127.0.0.1:8787`. Configure `.dev.vars` or `wrangler.toml` with local secrets/KV bindings before running.
3. **Configure KV mocks:** Cloudflare automatically provisions local KV namespaces for bindings declared in `wrangler.toml`. Seed data if required using Wrangler's KV commands.

## Testing
- TypeScript type-checking:
  ```bash
  npm run check
  ```
  This runs `tsc --noEmit` to ensure the worker compiles.

> No automated unit tests exist yet; rely on manual endpoint testing via `curl` or REST clients while running `npm run dev`.

## Deployment
- Deploy via Wrangler (requires authenticated Cloudflare CLI session):
  ```bash
  wrangler deploy
  ```
- Ensure the production Worker has existing KV namespaces bound (`TOKEN_KV`, `CACHE_KV`) and the required secrets configured.
- Monitor using Cloudflare dashboards and Logpush (enabled in `wrangler.toml`).

## Troubleshooting
- **401/403 from Toast:** Confirm `TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`, and `TOAST_RESTAURANT_GUID` secrets are set. Use `/api/debug/token` and `/api/debug/bindings` to verify credentials.
- **Frequent 429 responses:** Inspect `/api/debug/rl` to see cooldown status. Toast may enforce per-second limits—requests automatically pace, but you can clear the lock (with admin key) if necessary.
- **Unexpected empty payloads:** Add `debug=1` to orders endpoints to return slice metadata and confirm Toast returned data; check `detail` query parameter if only GUIDs are desired.
