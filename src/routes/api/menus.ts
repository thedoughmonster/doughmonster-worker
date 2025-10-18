import type { AppEnv } from "../../config/env.js";
import {
  getMenuCacheInfo,
  getPublishedMenusCached,
} from "../../clients/toast.js";
import { jsonResponse } from "../../lib/http.js";
import type { ToastMenusDocument } from "../../types/toast-menus.js";

interface MenusSuccessResponse {
  ok: true;
  menu: ToastMenusDocument | null;
  metadata: { lastUpdated: string | null };
  cacheHit: boolean;
}

interface MenusErrorResponse {
  ok: false;
  error: { message: string; code: string };
}

export default async function handleMenus(
  env: AppEnv,
  request: Request
): Promise<Response> {
  const effectiveRequest = normalizeRefreshRequest(request);

  try {
    const menuDocument = await getPublishedMenusCached(env, effectiveRequest);
    const cacheInfo = getMenuCacheInfo(effectiveRequest);
    const cacheStatus = cacheInfo?.status ?? null;
    const cacheHit = cacheStatus ? cacheStatus.startsWith("hit") : false;
    const lastUpdated =
      typeof cacheInfo?.updatedAt === "string" ? cacheInfo.updatedAt : null;

    const payload: MenusSuccessResponse = {
      ok: true,
      menu: menuDocument ?? null,
      metadata: { lastUpdated },
      cacheHit,
    };

    return jsonResponse(payload);
  } catch (err) {
    console.error("failed to serve cached menu", { err });
    const status = resolveErrorStatus(err);
    const payload: MenusErrorResponse = {
      ok: false,
      error: {
        message: resolveErrorMessage(err),
        code: resolveErrorCode(err),
      },
    };
    return jsonResponse(payload, { status });
  }
}

function normalizeRefreshRequest(request: Request): Request {
  const url = new URL(request.url);
  const refreshValue = url.searchParams.get("refresh");

  if (!refreshValue) {
    return request;
  }

  if (!isTruthyRefresh(refreshValue)) {
    return request;
  }

  if (refreshValue === "1") {
    return request;
  }

  url.searchParams.set("refresh", "1");
  return new Request(url.toString(), request);
}

function isTruthyRefresh(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (["0", "false", "off", "no", "null"].includes(normalized)) {
    return false;
  }
  return true;
}

function resolveErrorStatus(err: unknown): number {
  const status =
    typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : null;
  if (status && status >= 500 && status < 600) {
    return status;
  }
  return 502;
}

function resolveErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof (err as { message?: unknown })?.message === "string") {
    return (err as { message: string }).message;
  }
  return "Failed to load menu document";
}

function resolveErrorCode(err: unknown): string {
  if (typeof (err as { code?: unknown })?.code === "string") {
    return (err as { code: string }).code;
  }
  return "MENU_FETCH_FAILED";
}
