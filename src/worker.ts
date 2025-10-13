import { getEnv } from "./config/env.js";
import handleHealth from "./routes/api/health.js";
import handleOrdersLatest from "./routes/api/orders/latest.js";

export default {
  async fetch(request: Request, rawEnv: Record<string, unknown>): Promise<Response> {
    const env = getEnv(rawEnv);
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/api/health") {
        return handleHealth();
      }

      if (request.method === "GET" && path === "/api/orders/latest") {
        return await handleOrdersLatest(env, request);
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
