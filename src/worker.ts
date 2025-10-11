// /src/worker.ts
// Path: src/worker.ts

import type { EnvDeps } from "./lib/toastApi";
import handleMenu from "./routes/api/menu/index";
import handleOrdersRange from "./routes/api/orders/range";
import handleOrdersByDate from "./routes/api/orders/by-date";
import handleBindings from "./routes/api/debug/bindings"; // keeps the bindings check you used

export type Env = EnvDeps;

/** Tiny CORS helper (safe defaults for dev tools). */
function withCors(r: Response, origin: string) {
  const hdr = new Headers(r.headers);
  hdr.set("Access-Control-Allow-Origin", origin || "*");
  hdr.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  hdr.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(r.body, { status: r.status, headers: hdr });
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

    // CORS preflight
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
      // Health
      if (request.method === "GET" && path === "/api/health") {
        return withCors(okJson({ ok: true, service: "doughmonster-worker" }), origin);
      }

      // Debug: bindings
      if (request.method === "GET" && path === "/api/debug/bindings") {
        const res = await handleBindings(env);
        return withCors(res, origin);
      }

      // Menu
      if (request.method === "GET" && path === "/api/menu") {
        const res = await handleMenu(env, request);
        return withCors(res, origin);
      }

      // Orders by date (your existing slicer)
      if (request.method === "GET" && path === "/api/orders/by-date") {
        const res = await handleOrdersByDate(env, request);
        return withCors(res, origin);
      }

      // Orders range (your existing multi-hour slicer)
      if (request.method === "GET" && path === "/api/orders/range") {
        const res = await handleOrdersRange(env, request);
        return withCors(res, origin);
      }

      // 404
      return withCors(okJson({ ok: false, error: "Not Found", path }, 404), origin);
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Internal Error";
      return withCors(okJson({ ok: false, error: msg }, 500), origin);
    }
  },
};
