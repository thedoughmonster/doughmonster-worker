// /src/handlers/debugSecrets.ts
// Path: src/handlers/debugSecrets.ts

import { jsonResponse } from "../lib/http";

export interface Env {
  TOAST_API_BASE: string;
  TOAST_AUTH_URL: string;
  // Secrets (present if configured in Dashboard → Variables → Secrets)
  TOAST_CLIENT_ID?: string;
  TOAST_CLIENT_SECRET?: string;
  TOAST_RESTAURANT_GUID?: string;
}

export async function handleDebugSecrets(_req: Request, env: Env): Promise<Response> {
  // Only return presence flags (never values)
  const names = {
    TOAST_CLIENT_ID: Boolean(env.TOAST_CLIENT_ID),
    TOAST_CLIENT_SECRET: Boolean(env.TOAST_CLIENT_SECRET),
    TOAST_RESTAURANT_GUID: Boolean(env.TOAST_RESTAURANT_GUID),
  };

  return jsonResponse({ ok: true, names });
}
