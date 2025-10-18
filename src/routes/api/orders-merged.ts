import type { AppEnv } from "../../config/env.js";
import { jsonResponse } from "../../lib/http.js";

const ROUTE_PATH = "/api/orders-merged";

interface UpstreamSummary {
  ok: boolean;
  status: number;
  body: unknown;
}

export default async function handleOrdersMerged(_env: AppEnv, request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const headers = pickForwardHeaders(request.headers);

  const ordersUrl = new URL("/api/orders/latest", origin);
  const menusUrl = new URL("/api/menus", origin);

  let ordersResponse: Response | null = null;
  let menusResponse: Response | null = null;
  let ordersBody: unknown = null;
  let menusBody: unknown = null;

  try {
    [ordersResponse, menusResponse] = await Promise.all([
      fetch(ordersUrl.toString(), { method: "GET", headers }),
      fetch(menusUrl.toString(), { method: "GET", headers }),
    ]);

    [ordersBody, menusBody] = await Promise.all([
      readJsonBody(ordersResponse, "orders"),
      readJsonBody(menusResponse, "menus"),
    ]);

    if (!ordersResponse.ok || !menusResponse.ok) {
      const errorPayload = {
        ok: false,
        route: ROUTE_PATH,
        orders: summarizeUpstream(ordersResponse, ordersBody),
        menus: summarizeUpstream(menusResponse, menusBody),
      };

      return jsonResponse(errorPayload, { status: 502 });
    }

    return jsonResponse({
      ok: true,
      route: ROUTE_PATH,
      orders: ordersBody,
      menus: menusBody,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      {
        ok: false,
        route: ROUTE_PATH,
        error: { message },
        orders: ordersResponse ? summarizeUpstream(ordersResponse, ordersBody) : null,
        menus: menusResponse ? summarizeUpstream(menusResponse, menusBody) : null,
      },
      { status: 502 }
    );
  }
}

function summarizeUpstream(response: Response, body: unknown): UpstreamSummary {
  return {
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

function pickForwardHeaders(headers: Headers): HeadersInit {
  const forwarded = new Headers();
  for (const key of [
    "authorization",
    "cookie",
    "x-forwarded-for",
    "x-forwarded-proto",
    "cf-ray",
    "cf-connecting-ip",
  ]) {
    const value = headers.get(key);
    if (value) {
      forwarded.set(key, value);
    }
  }
  return forwarded;
}
