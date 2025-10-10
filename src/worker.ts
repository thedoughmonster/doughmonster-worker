// /src/worker.ts
// Path: src/worker.ts

import { jsonResponse, pathnameOf } from "./lib/http";
import type { Env as SecretsEnv } from "./handlers/debugSecrets";
import { handleDebugSecrets } from "./handlers/debugSecrets";

export interface Env extends SecretsEnv {
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
        toastApiBase: env.TOAST_API_BASE,
      });
    }

    if (path === "/api/debug/secrets") {
      return handleDebugSecrets(request, env);
    }

    return jsonResponse({ ok: false, error: "Not Found", path }, { status: 404 });
  },
};
