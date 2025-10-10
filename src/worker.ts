// /src/worker.ts
import handleDebugToken from "./routes/api/debug/token";

export interface Env {
  TOAST_CLIENT_ID: string;
  TOAST_CLIENT_SECRET: string;
  TOAST_AUTH_URL: string;
  TOKEN_KV: KVNamespace;
  CACHE_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/debug/token") {
      return handleDebugToken(env);
    }

    return new Response(JSON.stringify({ ok: true, path: url.pathname }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
