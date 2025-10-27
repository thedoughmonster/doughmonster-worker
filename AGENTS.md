# Repository Contribution Guide

Whenever you update any route registration or change an API response shape, update the TypeScript documentation source at `src/docs/endpoints.ts` to reflect the new behavior.

After making those changes, rerun the documentation generator via `npm run docs`. The generator script lives at `scripts/generate-openapi.mjs`; it rewrites the derived artifacts under `schemas/`, so be sure to re-check in the refreshed `schemas/openapi.json` and `schemas/openapi.yaml` outputs.
