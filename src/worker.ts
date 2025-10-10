// /src/worker.ts
// Path: src/worker.ts
// (Replace the existing file with this complete version)

import handleDebugToken from "./routes/api/debug/token";
import handleAuthStats from "./routes/api/debug/auth-stats";
import handleRL from "./routes/api/debug/rl";
import handleMenu from "./routes/api/menu/index";
import handleMenuMetadata from "./routes/api/menu/metadata";
import handleOrdersLatest from "./routes/api/orders/latest";

export interface Env {
  TOAST_CLIENT_ID: string;
  TOAST_CLIENT_SECRET: string;
  TOAST_AUTH_URL: string;
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
  TOKEN_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  DM_ADMIN_KEY?: string; // optional secret to clear RL
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      return Response.json({ ok: true, service: "doughmonster-worker", timestamp: new Date().toISOString() });
    }

    // Debug
    if (pathname === "/api/debug/token") return handleDebugToken(env);
    if (pathname === "/api/debug/auth-stats") return handleAuthStats(env);
    if (pathname === "/api/debug/rl" || pathname === "/api/debug/rl/clear") return handleRL(env, request);

    // Menu
    if (pathname === "/api/menu/metadata") return handleMenuMetadata(env);
    if (pathname === "/api/menu") return handleMenu(env, request);

    // Orders
    if (pathname === "/api/orders/latest") return handleOrdersLatest(env, request);

    return Response.json({ ok: false, error: "Not Found", path: pathname }, { status: 404 });
  },
};
