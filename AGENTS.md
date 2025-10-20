# Doughmonster Worker – Agent Instructions

## Required tooling
- Use the npm workspace in this repo; always keep `package-lock.json` in sync with `package.json` when dependencies change.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=19 path=package.json git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/package.json#L1-L19"}​
- TypeScript runs in strict React-aware mode (`jsx: "react-jsx"`); make sure new source files live under `src/` so the compiler picks them up.​:codex-file-citation[codex-file-citation]{line_range_start=2 line_range_end=14 path=tsconfig.json git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/tsconfig.json#L2-L14"}​

## Mandatory commands before opening a PR
1. `npm install`
2. `npm run check`
3. `npm run build`
4. `npm test`

These commands are the published project workflow—`npm run check` runs the TypeScript compiler, `npm run build` emits the worker bundle, and `npm test` exercises the Node test suite against the compiled output.​:codex-file-citation[codex-file-citation]{line_range_start=186 line_range_end=197 path=README.md git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/README.md#L186-L197"}​​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=83 path=tests/orders-detailed.test.mjs git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/tests/orders-detailed.test.mjs#L1-L83"}​

## Coding guidelines

### Cloudflare Worker backend (`src/**/*.ts`)
- Use the shared `AppEnv` typing from `src/config/env.ts` when reading bindings; throw early if required keys are absent.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=45 path=src/config/env.ts git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/config/env.ts#L1-L45"}​
- Prefer dependency-injected factories (see `createOrdersLatestHandler`) so handlers stay testable and mockable.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=159 path=src/routes/api/orders/latest.ts git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/routes/api/orders/latest.ts#L1-L159"}​
- Return responses via `jsonResponse`/helpers in `src/lib` to keep headers and error handling consistent, and favor pure utility functions for retry/backoff logic.​:codex-file-citation[codex-file-citation]{line_range_start=7 line_range_end=131 path=src/lib/http.ts git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/lib/http.ts#L7-L131"}​

### React dashboard (`src/ui`)
- Stick to React 18 function components with hooks and TypeScript types for Toast payloads (see `OrdersAllDayView.tsx`). Keep normalization helpers such as `parseToast`, `hashItem`, and modifier aggregators typed and colocated with the UI layer.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=200 path=src/ui/OrdersAllDayView.tsx git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/ui/OrdersAllDayView.tsx#L1-L200"}​
- Target the worker’s `/api/...` endpoints rather than placeholder hosts so the dashboard works against local and deployed workers.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=4 path=src/ui/OrdersAllDayView.tsx git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/ui/OrdersAllDayView.tsx#L1-L4"}​

### Testing expectations
- `npm test` relies on the compiled `dist/` bundle (`npm run build`), so do not skip the build step before running the Node test suite. Add or update tests under `tests/*.mjs` whenever you change request/response shapes.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=83 path=tests/orders-detailed.test.mjs git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/tests/orders-detailed.test.mjs#L1-L83"}​

## Release checklist
- Confirm all required commands above pass before sending a PR.
- Update documentation (e.g., `README.md`) when you introduce new routes, environment bindings, or UI capabilities surfaced to operators.​:codex-file-citation[codex-file-citation]{line_range_start=152 line_range_end=218 path=README.md git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/README.md#L152-L218"}​
