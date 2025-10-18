import { getEnv } from "./config/env.js";
import handleHealth from "./routes/api/health.js";
import handleMenus from "./routes/api/menus.js";
import handleOrdersLatest from "./routes/api/orders/latest.js";
import handleItemsExpanded from "./routes/items-expanded.js";

const STATIC_CACHE_SECONDS = 60;

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(
    request: Request,
    rawEnv: Record<string, unknown>,
    context?: ExecutionContextLike
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      const staticResponse = await serveStaticAsset(request, rawEnv);
      if (staticResponse) {
        return staticResponse;
      }

      const env = getEnv(rawEnv);
      if (context && typeof context.waitUntil === "function") {
        env.waitUntil = context.waitUntil.bind(context);
      }

      if (request.method === "GET" && path === "/api/health") {
        return handleHealth();
      }

      if (request.method === "GET" && path === "/api/menus") {
        return await handleMenus(env, request);
      }

      if (request.method === "GET" && path === "/api/orders/latest") {
        return await handleOrdersLatest(env, request);
      }

      if (request.method === "GET" && path === "/api/items-expanded") {
        return await handleItemsExpanded(env, request);
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

function isAssetFetcher(value: unknown): value is { fetch: (request: Request) => Promise<Response> } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fetch?: unknown }).fetch === "function"
  );
}

async function serveStaticAsset(
  request: Request,
  rawEnv: Record<string, unknown>
): Promise<Response | null> {
  if (request.method !== "GET") {
    return null;
  }

  const url = new URL(request.url);
  let pathname = url.pathname;
  if (pathname.startsWith("/api/")) {
    return null;
  }

  if (pathname === "/") {
    pathname = "/index.html";
  }

  if (!pathname.startsWith("/")) {
    return null;
  }

  if (pathname.includes("..")) {
    return new Response("Not Found", { status: 404 });
  }

  const assets = (rawEnv as Record<string, unknown>)?.ASSETS;
  if (!isAssetFetcher(assets)) {
    return null;
  }

  const assetUrl = new URL(pathname, "http://static");
  const assetRequest = new Request(assetUrl.toString(), request);
  const assetResponse = await assets.fetch(assetRequest);

  if (assetResponse.status === 404) {
    return null;
  }

  if (!assetResponse.ok) {
    return new Response("Not Found", { status: 404 });
  }

  const headers = new Headers(assetResponse.headers);
  headers.set("content-type", getContentType(pathname));
  headers.set("cache-control", getCacheControl(pathname));

  return new Response(assetResponse.body, {
    status: assetResponse.status,
    headers,
  });
}

function getContentType(pathname: string): string {
  if (pathname.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (pathname.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (pathname.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  if (pathname.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (pathname.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (pathname.endsWith(".woff2")) {
    return "font/woff2";
  }
  return "application/octet-stream";
}

function getCacheControl(pathname: string): string {
  if (pathname.endsWith(".html")) {
    return "no-cache";
  }
  return `public, max-age=${STATIC_CACHE_SECONDS}`;
}
