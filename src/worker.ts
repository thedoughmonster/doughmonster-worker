import { getEnv } from "./config/env.js";
import handleHealth from "./routes/api/health.js";
import handleMenus from "./routes/api/menus.js";
import handleOrdersLatest from "./routes/api/orders/latest.js";
import handleOrdersLatestWithMenu from "./routes/api/orders/latest-with-menu.js";

export default {
  async fetch(request: Request, rawEnv: Record<string, unknown>): Promise<Response> {
    const env = getEnv(rawEnv);
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/api/health") {
        return handleHealth();
      }

      if (request.method === "GET" && path === "/api/menus") {
        return await handleMenus(env);
      }

      if (request.method === "GET" && path === "/api/orders/latest") {
        return await handleOrdersLatest(env, request);
      }

      if (request.method === "GET" && path === "/api/orders/latest-with-menu") {
        return await handleOrdersLatestWithMenu(env, request);
      }

      return new Response(
        JSON.stringify({ ok: false, error: "Not Found", path }, null, 2),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify(
          {
            ok: false,
            error: err?.message || String(err),
            stack: err?.stack,
            path,
          },
          null,
          2
        ),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  },
};
