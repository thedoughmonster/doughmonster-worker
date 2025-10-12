// /src/lib/toastApi.ts
// Path: src/lib/toastApi.ts
// Low-level Toast fetch helpers with structured errors (no double-stringify)

export type Json = Record<string, unknown> | unknown[];

export interface FetchOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  debug?: boolean;
}

export interface ToastResultOk {
  ok: true;
  status: number;
  url: string;
  json: Json | null;
  text: string | null;
  responseHeaders: Record<string, string>;
}

export interface ToastResultErr {
  ok: false;
  status: number;
  url: string;
  responseHeaders: Record<string, string>;
  body: { json?: Json; text?: string } | null;
  error: string; // short summary, not a JSON string
}

export type ToastResult = ToastResultOk | ToastResultErr;

function buildUrl(base: string, route: string, query?: FetchOpts["query"]): string {
  const u = new URL(route.startsWith("http") ? route : `${base.replace(/\/$/, "")}/${route.replace(/^\//, "")}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined) continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

function collectHeaders(resp: Response): Record<string, string> {
  const out: Record<string, string> = {};
  resp.headers.forEach((v, k) => (out[k.toLowerCase()] = v));
  return out;
}

export async function toastGet(
  env: Env,
  route: string,
  query?: FetchOpts["query"],
  opts: Omit<FetchOpts, "method" | "body"> = {}
): Promise<ToastResult> {
  const url = buildUrl(env.TOAST_API_BASE, route, query);

  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${await (await import("./toastAuth")).getAccessToken(env)}`,
    "Toast-Restaurant-External-ID": env.TOAST_RESTAURANT_GUID, // required by Toast
    ...(opts.headers ?? {}),
  };

  const resp = await fetch(url, { method: "GET", headers });

  const responseHeaders = collectHeaders(resp);
  let text: string | null = null;
  let json: Json | null = null;
  const raw = await resp.text();
  text = raw || null;
  try {
    if (raw) json = JSON.parse(raw);
  } catch {
    // non-JSON body; keep text
  }

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      url,
      responseHeaders,
      body: json ? { json } : text ? { text } : null,
      error: `Toast error ${resp.status} on ${route}`,
    };
  }

  return { ok: true, status: resp.status, url, json, text, responseHeaders };
}
