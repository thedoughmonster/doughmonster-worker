// src/lib/env.ts
// Shared environment bindings for Toast integrations.

export interface ToastEnv {
  TOAST_API_BASE: string;
  TOAST_AUTH_URL: string;
  TOAST_CLIENT_ID: string;
  TOAST_CLIENT_SECRET: string;
  TOAST_RESTAURANT_GUID: string;
  TOKEN_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  DM_ADMIN_KEY?: string;
}

export type ToastApiEnv = Pick<ToastEnv, "TOAST_API_BASE" | "TOAST_RESTAURANT_GUID" | "TOAST_AUTH_URL" | "TOAST_CLIENT_ID" | "TOAST_CLIENT_SECRET" | "TOKEN_KV">;

export type ToastAuthEnv = Pick<ToastEnv, "TOAST_AUTH_URL" | "TOAST_CLIENT_ID" | "TOAST_CLIENT_SECRET" | "TOKEN_KV">;
