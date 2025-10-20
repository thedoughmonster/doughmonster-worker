# Doughmonster Worker – Agent Instructions

This file defines the **mandatory operating contract** for all automated agents (including Codex) working on this repository.  
Agents must **read and obey this document before any code generation, refactor, or modification.**

---

## 🧰 Required Tooling

- The project uses an **npm workspace**. Always keep `package-lock.json` in sync with `package.json` whenever dependencies change.  
  :codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=19 path=package.json git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/package.json#L1-L19"}
- **TypeScript** runs in **strict React-aware mode** (`"jsx": "react-jsx"`).  
  All new source files must live under `src/` so the compiler includes them.  
  :codex-file-citation[codex-file-citation]{line_range_start=2 line_range_end=14 path=tsconfig.json git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/tsconfig.json#L2-L14"}
- Use the Node version defined in `.nvmrc` (currently Node 20).  
- Pin `wrangler` and other critical tool versions—never bump or downgrade without explicit approval.

---

## 🚦 Mandatory Commands Before Opening a PR

Every change must pass the following commands on a clean checkout:

```bash
npm ci
npm run check
npm run build
npm test
```

**Definitions:**
- `npm run check` – TypeScript compilation (strict mode).
- `npm run build` – Emits the Worker bundle for deployment.
- `npm test` – Executes the Node test suite against the compiled output.

:codex-file-citation[codex-file-citation]{line_range_start=186 line_range_end=197 path=README.md git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/README.md#L186-L197"}  
:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=83 path=tests/orders-detailed.test.mjs git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/tests/orders-detailed.test.mjs#L1-L83"}

---

## 🧩 Coding Guidelines

### Cloudflare Worker Backend (`src/**/*.ts`)
- Use the shared `AppEnv` typing from `src/config/env.ts` for all bindings; throw early if any required keys are missing.  
  :codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=45 path=src/config/env.ts git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/config/env.ts#L1-L45"}
- Follow dependency-injection patterns (see `createOrdersLatestHandler`) to keep handlers mockable and testable.  
  :codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=159 path=src/routes/api/orders/latest.ts git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/routes/api/orders/latest.ts#L1-L159"}
- Return all responses using helpers in `src/lib/http.ts` (`jsonResponse`, error wrappers, etc.) for consistent status and header behavior.  
  :codex-file-citation[codex-file-citation]{line_range_start=7 line_range_end=131 path=src/lib/http.ts git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/lib/http.ts#L7-L131"}

### React Dashboard (`src/ui`)
- Use **React 18 function components** with hooks and strict TypeScript types for all Toast payloads.  
  :codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=200 path=src/ui/OrdersAllDayView.tsx git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/ui/OrdersAllDayView.tsx#L1-L200"}
- Keep normalization helpers (`parseToast`, `hashItem`, modifier aggregators) typed and colocated with the UI layer.
- The UI should **target the worker’s `/api/...` endpoints**—never external placeholders—so the dashboard works both locally and in production.  
  :codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=4 path=src/ui/OrdersAllDayView.tsx git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/src/ui/OrdersAllDayView.tsx#L1-L4"}

---

## 🧪 Testing Expectations

- The Node test suite (`npm test`) depends on the compiled output in `dist/`.  
  Always run `npm run build` before tests.  
  :codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=83 path=tests/orders-detailed.test.mjs git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/tests/orders-detailed.test.mjs#L1-L83"}
- Add or update tests under `tests/*.mjs` whenever API request/response shapes change.

---

## 🚀 Release Checklist

Before merging or deploying:

- ✅ All mandatory commands (`npm ci`, `check`, `build`, `test`) pass locally and in CI.  
- ✅ Documentation updated (`README.md`, `/docs`) if new routes, bindings, or UI capabilities were introduced.  
  :codex-file-citation[codex-file-citation]{line_range_start=152 line_range_end=218 path=README.md git_url="https://github.com/thedoughmonster/doughmonster-worker/blob/main/README.md#L152-L218"}
- ✅ `wrangler.toml` committed and accurate (including `compatibility_date` and all bindings).  
- ✅ `package-lock.json` checked in and matches the current dependency graph.

---

## 🧾 Definition of Done (Non-Negotiable)

A task or pull request is **not complete** unless **all** of the following hold true:

1. **Build integrity**
   - `npm ci && npm run check && npm run build && npm test` all succeed with no warnings or skipped steps.
   - TypeScript strict mode passes with zero errors.

2. **Dependency hygiene**
   - No unpinned or range-based dependency versions are introduced.
   - No toolchain upgrades (Node, Wrangler, etc.) without explicit justification.

3. **Runtime consistency**
   - The Cloudflare Worker bundle deploys cleanly using `wrangler publish`.
   - No unbound or missing environment variables or KV/D1 bindings.
   - `wrangler.toml` is version-controlled and matches deployed configuration.

4. **Code discipline**
   - All new code adheres to the guidelines above (typed handlers, pure utilities, proper response helpers).
   - No console logs, stray debugging, or commented-out code in production paths.

5. **Documentation**
   - README and any route documentation reflect the new behavior.
   - Commit messages are concise and descriptive.

If **any** of these conditions fail, the agent must revise the change until compliance is achieved.

---

## 🧠 Agent Execution Policy

- Agents must **always read this `AGENT.md`** before generating or editing code.  
- If this file conflicts with model defaults, **this file takes precedence.**
- Do **not** perform speculative rewrites or “optimizations” that break parity with the build or test suite.
- The **only acceptable output** from an automated task is code that passes the required workflow end-to-end.

> In short: **no green build, no merge.**
