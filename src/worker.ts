// /src/worker.ts
// Path: src/worker.ts

// Small, pure helper for JSON responses.
function jsonResponse<T>(data: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

// Simple path matcher (pure)
function pathnameOf(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}

export interface Env {
  TOAST_API_BASE: string;
  TOAST_AUTH_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = pathnameOf(request);

    if (path === "/api/health") {
      return jsonResponse({
        ok: true,
        service: "doughmonster-worker",
        timestamp: new Date().toISOString(),
        toastApiBase: env.TOAST_API_BASE
      });
    }

    return jsonResponse({ ok: false, error: "Not Found", path }, { status: 404 });
  },
};
