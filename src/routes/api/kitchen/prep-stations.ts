import type { AppEnv } from "../../../config/env.js";
import {
  getPrepStations,
  type GetPrepStationsParams,
} from "../../../clients/toast.js";
import { jsonResponse } from "../../../lib/http.js";
import type { ToastPrepStation } from "../../../types/toast-kitchen.js";

const ROUTE = "/api/kitchen/prep-stations" as const;

export interface KitchenPrepStationsDeps {
  getPrepStations: typeof getPrepStations;
}

interface KitchenPrepStationsSuccess {
  ok: true;
  route: typeof ROUTE;
  count: number;
  prepStations: ToastPrepStation[];
  nextPageToken: string | null;
  request: {
    pageToken: string | null;
    lastModified: string | null;
  };
  raw?: unknown;
}

interface KitchenPrepStationsError {
  ok: false;
  route: typeof ROUTE;
  error: string;
  code?: string;
}

type KitchenPrepStationsResponse =
  | KitchenPrepStationsSuccess
  | KitchenPrepStationsError;

export function createKitchenPrepStationsHandler(
  deps: KitchenPrepStationsDeps = { getPrepStations }
) {
  return async function handleKitchenPrepStations(
    env: AppEnv,
    request: Request
  ): Promise<Response> {
    const params = buildRequestParams(request);

    try {
      const result = await deps.getPrepStations(env, params);

      const payload: KitchenPrepStationsSuccess = {
        ok: true,
        route: ROUTE,
        count: Array.isArray(result.prepStations) ? result.prepStations.length : 0,
        prepStations: Array.isArray(result.prepStations)
          ? result.prepStations
          : [],
        nextPageToken: normalizeString(result.nextPageToken),
        request: {
          pageToken: params.pageToken ?? null,
          lastModified: params.lastModified ?? null,
        },
      };

      if (result.raw && typeof result.raw === "object") {
        payload.raw = result.raw;
      }

      return jsonResponse<KitchenPrepStationsResponse>(payload);
    } catch (err) {
      const status = resolveErrorStatus(err);
      const payload: KitchenPrepStationsError = {
        ok: false,
        route: ROUTE,
        error: resolveErrorMessage(err),
        code: resolveErrorCode(err),
      };
      return jsonResponse<KitchenPrepStationsResponse>(payload, { status });
    }
  };
}

export default createKitchenPrepStationsHandler();

function buildRequestParams(request: Request): GetPrepStationsParams {
  const url = new URL(request.url);
  const pageToken = normalizeString(url.searchParams.get("pageToken"));
  const lastModified = normalizeString(url.searchParams.get("lastModified"));

  return {
    pageToken,
    lastModified,
  };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveErrorStatus(err: unknown): number {
  const status = typeof (err as { status?: unknown })?.status === "number"
    ? (err as { status: number }).status
    : null;

  if (status && status >= 400 && status < 600) {
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
  return "Failed to load prep stations";
}

function resolveErrorCode(err: unknown): string | undefined {
  if (typeof (err as { code?: unknown })?.code === "string") {
    return (err as { code: string }).code;
  }
  return undefined;
}
