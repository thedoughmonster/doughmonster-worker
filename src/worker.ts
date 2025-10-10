// /src/worker.ts
// Path: src/worker.ts

import handleDebugToken from "./routes/api/debug/token";
import handleMenu from "./routes/api/menu/index";

export interface Env {
  TOAST_CLIENT_ID: string;
  TOAST_CLIENT_SECRET: string;
  TOAST_AUTH_URL: string;
  TOAST_API_BASE: string;
  TOAST_RESTAURANT_GUID: string;
  TOKEN_KV: KVNamespace;
  CACHE_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "doughmonster-worker",
        timestamp: new Date().toISOString(),
      });
    }

    if (pathname === "/api/debug/token") {
      return handleDebugToken(env);
    }

    if (pathname === "/api/menu") {
      return handleMenu(env);
    }

    return Response.json({ ok: false, error: "Not Found", path: pathname }, { status: 404 });
  },
};
