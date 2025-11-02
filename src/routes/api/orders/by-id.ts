import type { AppEnv } from "../../../config/env.js";
import { getOrderById } from "../../../clients/toast.js";
import { jsonResponse } from "../../../lib/http.js";

export interface OrderByIdDeps {
  getOrderById: typeof getOrderById;
}

const GUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ROUTE_TEMPLATE = "/api/orders/{guid}";

export function createOrderByIdHandler(
  deps: OrderByIdDeps = { getOrderById }
) {
  return async function handleOrderById(
    env: AppEnv,
    request: Request
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const guidResult = extractGuid(path);

    if (!guidResult.ok) {
      return jsonResponse(
        {
          ok: false,
          route: guidResult.route ?? ROUTE_TEMPLATE,
          guid: guidResult.guid ?? null,
          error: guidResult.error,
        },
        { status: 400 }
      );
    }

    const guid = guidResult.guid;

    try {
      const order = await deps.getOrderById(env, guid);
      return jsonResponse({
        ok: true,
        route: `/api/orders/${guid}`,
        guid,
        order,
      });
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 500;
      const message = resolveToastErrorMessage(status, err, guid);

      return jsonResponse(
        {
          ok: false,
          route: `/api/orders/${guid}`,
          guid,
          error: message,
        },
        { status }
      );
    }
  };
}

export default createOrderByIdHandler();

interface GuidParseFailure {
  ok: false;
  error: string;
  route?: string;
  guid?: string | null;
}

interface GuidParseSuccess {
  ok: true;
  guid: string;
}

type GuidParseResult = GuidParseFailure | GuidParseSuccess;

function extractGuid(pathname: string): GuidParseResult {
  const match = pathname.match(/^\/api\/orders\/(.+)$/);
  if (!match) {
    return {
      ok: false,
      error: "Order GUID path parameter is required.",
      route: ROUTE_TEMPLATE,
      guid: null,
    };
  }

  const rawSegment = match[1];

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    return {
      ok: false,
      error: "Order GUID could not be decoded.",
      route: `/api/orders/${rawSegment}`,
      guid: null,
    };
  }

  const guid = decoded.trim();
  const route = `/api/orders/${guid || rawSegment}`;

  if (!guid) {
    return {
      ok: false,
      error: "Order GUID path parameter is required.",
      route,
      guid: null,
    };
  }

  if (!GUID_PATTERN.test(guid)) {
    return {
      ok: false,
      error: "Order GUID must be a valid UUID.",
      route,
      guid,
    };
  }

  return { ok: true, guid };
}

function resolveToastErrorMessage(
  status: number,
  err: unknown,
  guid: string
): string {
  if (status === 404) {
    return `Order ${guid} was not found.`;
  }

  if (status >= 500) {
    return "Toast is currently unavailable. Please try again.";
  }

  return extractErrorMessage(err) ?? "Failed to load order.";
}

function extractErrorMessage(err: unknown): string | null {
  if (!err) {
    return null;
  }

  if (typeof err === "string") {
    return err.trim() || null;
  }

  if (typeof (err as { message?: unknown })?.message === "string") {
    const message = ((err as { message: string }).message || "").trim();
    if (message) {
      return message;
    }
  }

  if (typeof (err as { bodySnippet?: unknown })?.bodySnippet === "string") {
    const snippet = ((err as { bodySnippet: string }).bodySnippet || "").trim();
    if (snippet) {
      return snippet;
    }
  }

  return null;
}
