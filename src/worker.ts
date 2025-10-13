// /src/worker.ts
// Path: src/worker.ts

import type { ToastEnv } from "./lib/env";
import handleToken from "./routes/api/debug/token";
import handleBindings from "./routes/api/debug/bindings";
import handleRateLimitDebug from "./routes/api/debug/rl";
import handleAuthStats from "./routes/api/debug/auth-stats";

import handleMenuIndex from "./routes/api/menu/index";
import handleMenuMetadata from "./routes/api/menu/metadata";

import handleOrdersByDate from "./routes/api/orders/by-date";
import handleOrdersByRange from "./routes/api/orders/by-range";
import handleOrdersLatest from "./routes/api/orders/latest";

export default {
  async fetch(request: Request, env: ToastEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---- DEBUG ----
      if (request.method === "GET" && path === "/api/debug/token") {
        return await handleToken(env);
      }
      if (request.method === "GET" && path === "/api/debug/bindings") {
        return await handleBindings(env);
      }
      if (request.method === "GET" && path === "/api/debug/rl") {
        return await handleRateLimitDebug(env, request);
      }
      if (request.method === "GET" && path === "/api/debug/auth-stats") {
        return await handleAuthStats(env);
      }

      // ---- MENU ----
      if (request.method === "GET" && path === "/api/menu") {
        return await handleMenuIndex(env, request);
      }
      if (request.method === "GET" && path === "/api/menu/metadata") {
        return await handleMenuMetadata(env);
      }

      // ---- ORDERS ----
      if (request.method === "GET" && path === "/api/orders/by-date") {
        return await handleOrdersByDate(env, request);
      }
      if (request.method === "GET" && path === "/api/orders/by-range") {
        return await handleOrdersByRange(env, request);
      }
      if (request.method === "GET" && path === "/api/orders/latest") {
        return await handleOrdersLatest(env, request);
      }

      // 404 JSON
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
