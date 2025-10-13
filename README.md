# Doughmonster Worker

A minimal Cloudflare Worker that proxies Toast orders for Doughmonster and exposes a basic health check. The worker owns Toast authentication, retry logic, and pagination so downstream clients only make a single request.

## Endpoints
| Method | Path | Description | Example |
| ------ | ---- | ----------- | ------- |
| `GET` | `/api/health` | Simple uptime probe that always returns `{ "ok": true }`. | `curl -i https://<worker>/api/health`
| `GET` | `/api/orders/latest` | Returns the most recent Toast orders (default 60 minute window, max 120). Accepts `?minutes=` and optional `?debug=1` for diagnostics. | `curl -s "https://<worker>/api/orders/latest?minutes=30" \| jq` |
| `GET` | `/api/menu/dict` | Builds menu item data `{ guid, name, basePrice, salesCategoryName, multiLocationId }`. Accepts optional `?lastModified=` to filter Toast results and `?as=` (`dict` default, `array` for legacy output). | `curl -s "https://<worker>/api/menu/dict?as=array" \| jq '.data[0]'` |

The `/api/orders/latest` payload matches the previous public shape: `{ ok, route, minutes, window, detail, expandUsed, count, ids, orders, data, debug? }`.

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

## Changelog (cleanup)
- Flattened the worker to only two routes (`/api/health`, `/api/orders/latest`) and removed all menu, date-range, and debug endpoints.
- Replaced the scattered HTTP/auth helpers with a single fetch retry helper, a Toast auth module, and a focused Toast client.
- Centralized environment validation in `src/config/env.ts` and trimmed unused bindings (menu cache, rate limiting, debug handlers).
- Added Node-based unit tests for `fetchWithBackoff` and `/api/orders/latest` along with a build config that emits to `dist/` for testing.

## Restoring deprecated code
No files were moved to `deprecated/`. To recover the old endpoints or helpers, restore them from Git history prior to this cleanup.
