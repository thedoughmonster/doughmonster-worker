// /src/worker.ts

import handleAuth from "./routes/api/debug/auth";
import handleBindings from "./routes/api/debug/bindings";
import handleMenuMetadata from "./routes/api/menu/metadata";
import handleOrdersByDate from "./routes/api/orders/by-date";
import handleOrdersByRange from "./routes/api/orders/by-range";

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin") || "*";

    // Debug routes
    if (request.method === "GET" && path === "/api/debug/auth") {
      const res = await handleAuth(env, request);
      return withCors(res, origin);
    }

    if (request.method === "GET" && path === "/api/debug/bindings") {
      const res = await handleBindings(env, request);
      return withCors(res, origin);
    }

    // Menu metadata
    if (request.method === "GET" && path === "/api/menu/metadata") {
      const res = await handleMenuMetadata(env, request);
      return withCors(res, origin);
    }

    // Orders (6-hour default)
    if (request.method === "GET" && path === "/api/orders/by-date") {
      const res = await handleOrdersByDate(env, request);
      return withCors(res, origin);
    }

    // Orders (multi-hour flexible range)
    if (request.method === "GET" && path === "/api/orders/by-range") {
      const res = await handleOrdersByRange(env, request);
      return withCors(res, origin);
    }

    // Default 404
    return withCors(
      new Response(JSON.stringify({ ok: false, error: "Not Found", path }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
      origin
    );
  },
};
