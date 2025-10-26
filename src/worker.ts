import { getEnv } from "./config/env.js";
import handleHealth from "./routes/api/health.js";
import menusHandler from "./routes/api/menus";
import ordersLatestHandler from "./routes/api/orders/latest";
import ordersDetailedHandler from "./routes/orders-detailed.js";
import ordersMergedHandler from "./routes/api/orders-merged";
import configSnapshotHandler from "./routes/api/config-snapshot";
import ordersDashboardHandler from "./routes/dashboard/orders";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export function applyCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

type Env = ReturnType<typeof getEnv>;

type RouteHandler = (
  env: Env,
  request: Request
) => Promise<Response> | Response;

class WorkerRouter {
  #getRoutes = new Map<string, RouteHandler>();

  get(path: string, handler: RouteHandler): void {
    this.#getRoutes.set(path, handler);
  }

  async handle(
    method: string,
    path: string,
    env: Env,
    request: Request
  ): Promise<Response | null> {
    if (method !== "GET") {
      return null;
    }

    const handler = this.#getRoutes.get(path);
    if (!handler) {
      return null;
    }

    return await handler(env, request);
  }
}

const router = new WorkerRouter();

router.get("/api/menus", menusHandler);
router.get("/api/orders/latest", ordersLatestHandler);
router.get("/api/orders-detailed", ordersDetailedHandler);
router.get("/api/items-expanded", async (env, request) => {
  const response = await ordersDetailedHandler(env, request);
  const headers = new Headers(response.headers);
  headers.set("Deprecation", "true");
  headers.set("Link", "</api/orders-detailed>; rel=\"successor-version\"");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
router.get("/api/orders-merged", ordersMergedHandler);
router.get("/api/config/snapshot", configSnapshotHandler);
router.get("/dashboard/orders", ordersDashboardHandler);

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(
    request: Request,
    rawEnv: Record<string, unknown>,
    context?: ExecutionContextLike
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return applyCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      const env = getEnv(rawEnv);
      if (context && typeof context.waitUntil === "function") {
        env.waitUntil = context.waitUntil.bind(context);
      }

      if (request.method === "GET" && path === "/api/health") {
        return applyCors(handleHealth());
      }

      const routeResponse = await router.handle(request.method, path, env, request);
      if (routeResponse) {
        return applyCors(routeResponse);
      }

      return applyCors(
        new Response(JSON.stringify({ ok: false, error: "Not Found", path }, null, 2), {
          status: 404,
          headers: { "content-type": "application/json" },
        })
      );
    } catch (err: any) {
      return applyCors(
        new Response(
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
        )
      );
    }
  },
};
