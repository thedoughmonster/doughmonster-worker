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

    // Debug routes
    if (request.method === "GET" && path === "/api/debug/auth") {
      return await handleAuth(env, request);
    }

    if (request.method === "GET" && path === "/api/debug/bindings") {
      return await handleBindings(env, request);
    }

    // Menu metadata
    if (request.method === "GET" && path === "/api/menu/metadata") {
      return await handleMenuMetadata(env, request);
    }

    // Orders (6-hour default)
    if (request.method === "GET" && path === "/api/orders/by-date") {
      return await handleOrdersByDate(env, request);
    }

    // Orders (multi-hour flexible range)
    if (request.method === "GET" && path === "/api/orders/by-range") {
      return await handleOrdersByRange(env, request);
    }

    // Default 404
    return new Response(
      JSON.stringify({ ok: false, error: "Not Found", path }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  },
};
