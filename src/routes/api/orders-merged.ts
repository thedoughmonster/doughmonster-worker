import type { AppEnv } from "../../config/env.js";
import { jsonResponse } from "../../lib/http.js";
import menusHandler from "./menus.js";
import ordersLatestHandler from "./orders/latest.js";

const ROUTE_PATH = "/api/orders-merged";

interface UpstreamSummary {
  path: "direct" | "network";
  ok: boolean;
  status: number | null;
  body: unknown;
  errorMessage?: string;
}

type DirectResult<T> =
  | { ok: true; body: T; summary: UpstreamSummary }
  | { ok: false; error: Error; summary: UpstreamSummary };

export default async function handleOrdersMerged(env: AppEnv, _request: Request): Promise<Response> {
  const [ordersResult, menusResult] = await Promise.all([
    callDirectHandler(env, ordersLatestHandler, "/api/orders/latest", "orders"),
    callDirectHandler(env, menusHandler, "/api/menus", "menus"),
  ]);

  if (!ordersResult.ok || !menusResult.ok) {
    const messages: string[] = [];
    if (!ordersResult.ok) messages.push(ordersResult.error.message);
    if (!menusResult.ok) messages.push(menusResult.error.message);
    const message = messages.filter(Boolean).join("; ") || "Upstream service unavailable";

    return jsonResponse(
      {
        ok: false,
        route: ROUTE_PATH,
        error: { message },
        orders: ordersResult.summary,
        menus: menusResult.summary,
      },
      { status: 502 }
    );
  }

  return jsonResponse({
    ok: true,
    route: ROUTE_PATH,
    orders: ordersResult.body,
    menus: menusResult.body,
  });
}

async function callDirectHandler<T>(
  env: AppEnv,
  handler: (env: AppEnv, request: Request) => Promise<Response>,
  path: string,
  label: string
): Promise<DirectResult<T>> {
  let response: Response;
  try {
    response = await handler(env, buildInternalRequest(path));
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const summary: UpstreamSummary = {
      path: "direct",
      ok: false,
      status: null,
      body: null,
      errorMessage: error.message,
    };
    return { ok: false, error, summary };
  }

  let body: unknown;
  try {
    body = await readJsonBody(response, label);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const summary: UpstreamSummary = {
      path: "direct",
      ok: response.ok,
      status: response.status,
      body: null,
      errorMessage: error.message,
    };
    return { ok: false, error, summary };
  }

  const summary = summarizeUpstream(response, body, "direct");

  if (!response.ok) {
    const error = new Error(`Direct call to ${path} failed with status ${response.status}`);
    return { ok: false, error, summary };
  }

  return { ok: true, body: body as T, summary };
}

function summarizeUpstream(response: Response, body: unknown, path: "direct" | "network"): UpstreamSummary {
  return {
    path,
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function readJsonBody(response: Response, label: string): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    const error = new Error(`Failed to parse upstream JSON from ${label}`);
    (error as any).cause = err;
    throw error;
  }
}

function buildInternalRequest(path: string): Request {
  const url = new URL(path, "http://internal.worker");
  return new Request(url.toString(), { method: "GET" });
}
