// /src/routes/api/debug/bindings.ts
// Path: src/routes/api/debug/bindings.ts

import type { EnvDeps } from "../../../lib/toastApi";

export default async function handleBindings(env: EnvDeps): Promise<Response> {
  const hasTokenKV = !!(env as any).TOKEN_KV && typeof (env as any).TOKEN_KV.get === "function";
  const hasCacheKV = !!(env as any).CACHE_KV && typeof (env as any).CACHE_KV.get === "function";

  const payload = {
    ok: true,
    bindings: {
      TOKEN_KV: hasTokenKV ? "OK" : "MISSING",
      CACHE_KV: hasCacheKV ? "OK" : "MISSING",
      TOAST_API_BASE: typeof env.TOAST_API_BASE === "string",
      TOAST_AUTH_URL: typeof env.TOAST_AUTH_URL === "string",
      TOAST_CLIENT_ID: typeof (env as any).TOAST_CLIENT_ID === "string",
      TOAST_CLIENT_SECRET: typeof (env as any).TOAST_CLIENT_SECRET === "string",
      TOAST_RESTAURANT_GUID: typeof (env as any).TOAST_RESTAURANT_GUID === "string",
    },
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
