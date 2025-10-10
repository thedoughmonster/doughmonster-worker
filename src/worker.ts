// /src/worker.ts
// Path: src/worker.ts

import type { EnvDeps } from "./lib/toastApi";
import handleMenu from "./routes/api/menu/index";
import handleOrdersRange from "./routes/api/orders/range";
import handleOrdersByDate from "./routes/api/orders/by-date";
import handleBindings from "./routes/api/debug/bindings";

export type Env = EnvDeps;

function withCors(r: Response, origin: string) {
  const h = new Headers(r.headers);
  h.set("Access-Control-Allow-Origin", origin || "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(r.body, { status: r.status, headers: h });
}

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = request.headers.get("Origin") ?? "*";

    if (request.method === "OPTIONS") {
      return withCors(
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Max-Age": "600",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        }),
        origin
      );
    }

    try {
      if (request.method === "GET" && path === "/api/health") {
        return withCors(okJson({ ok: true, service: "doughmonster-worker" }), origin);
      }

      if (request.method === "GET" && path === "/api/debug/bindings") {
        const res = await handleBindings(env);
        return withCors(res, origin);
      }

      if (request.method === "GET" && path === "/api/menu") {
        const res = await handleMenu(env, request);
        return withCors(res, origin);
      }

      if (request.method === "GET" && path === "/api/orders/by-date") {
        const res = await handleOrdersByDate(env, request);
        return withCors(res, origin);
      }

      if (request.method === "GET" && path === "/api/orders/range") {
        const res = await handleOrdersRange(env, request);
        return withCors(res, origin);
      }

      return withCors(okJson({ ok: false, error: "Not Found", path }, 404), origin);
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Internal Error";
      return withCors(okJson({ ok: false, error: msg }, 500), origin);
    }
  },
};
