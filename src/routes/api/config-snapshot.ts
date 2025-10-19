import type { AppEnv } from "../../config/env.js";
import { getToastHeaders } from "../../lib/auth.js";
import { fetchWithBackoff, jsonResponse } from "../../lib/http.js";

const CONFIG_SLICES = [
  "diningOptions",
  "orderTypes",
  "revenueCenters",
  "serviceAreas",
  "taxRates",
  "discounts",
] as const;

const CACHE_KEY_PREFIX = "toast:config:snapshot:all:";
const TTL_SECONDS = 3600;

type ConfigSlice = (typeof CONFIG_SLICES)[number];

type ConfigSnapshotData = { [Key in ConfigSlice]: unknown | null };

interface ConfigSnapshotPayload {
  updatedAt: string;
  ttlSeconds: number;
  data: ConfigSnapshotData;
}

export default async function handleConfigSnapshot(
  env: AppEnv,
  _request: Request
): Promise<Response> {
  const cacheKey = buildCacheKey(env);
  const cached = await readCachedSnapshot(env, cacheKey);

  if (cached) {
    return jsonResponse(cached);
  }

  const payload = await fetchSnapshot(env);

  await env.CACHE_KV.put(cacheKey, JSON.stringify(payload), {
    expirationTtl: TTL_SECONDS,
  });

  return jsonResponse(payload);
}

async function readCachedSnapshot(
  env: AppEnv,
  cacheKey: string
): Promise<ConfigSnapshotPayload | null> {
  try {
    const stored = (await env.CACHE_KV.get(cacheKey, "json")) as
      | ConfigSnapshotPayload
      | null;
    if (!stored || typeof stored !== "object") {
      return null;
    }

    if (!stored.data || typeof stored.data !== "object") {
      return null;
    }

    for (const slice of CONFIG_SLICES) {
      if (!Object.prototype.hasOwnProperty.call(stored.data, slice)) {
        return null;
      }
    }

    return stored;
  } catch (err) {
    console.warn("failed to read cached config snapshot", { err });
    return null;
  }
}

async function fetchSnapshot(env: AppEnv): Promise<ConfigSnapshotPayload> {
  const baseUrl = env.TOAST_API_BASE.replace(/\/+$/, "");
  const baseHeaders = await buildToastConfigHeaders(env);

  const data = CONFIG_SLICES.reduce<ConfigSnapshotData>((acc, slice) => {
    acc[slice] = null;
    return acc;
  }, {} as ConfigSnapshotData);

  await Promise.all(
    CONFIG_SLICES.map(async (slice) => {
      const url = `${baseUrl}/config/v2/${slice}`;
      try {
        const response = await fetchWithBackoff(url, {
          method: "GET",
          headers: { ...baseHeaders },
        });
        const text = await response.text();
        if (!text) {
          data[slice] = null;
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (parseErr) {
          console.error("failed to parse config slice", { slice, err: parseErr });
          data[slice] = null;
          return;
        }

        data[slice] = extractSliceValue(parsed, slice);
      } catch (err) {
        console.error("failed to fetch config slice", { slice, err });
        data[slice] = null;
      }
    })
  );

  const payload: ConfigSnapshotPayload = {
    updatedAt: new Date().toISOString(),
    ttlSeconds: TTL_SECONDS,
    data,
  };

  return payload;
}

function extractSliceValue(value: unknown, slice: ConfigSlice): unknown | null {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  const candidate = (value as Record<string, unknown>)[slice];
  if (candidate !== undefined) {
    return candidate ?? null;
  }

  return value;
}

async function buildToastConfigHeaders(env: AppEnv): Promise<Record<string, string>> {
  const headers = await getToastHeaders(env);
  const tenantExternalId = normalizeString((env as any)?.TOAST_TENANT_EXTERNAL_ID);
  if (tenantExternalId) {
    headers["Toast-Tenant-External-ID"] = tenantExternalId;
  }

  const locationExternalId = normalizeString((env as any)?.TOAST_RESTAURANT_EXTERNAL_ID);
  if (locationExternalId) {
    headers["Toast-Restaurant-External-ID"] = locationExternalId;
  }

  return headers;
}

function buildCacheKey(env: AppEnv): string {
  const scope =
    normalizeString((env as any)?.TOAST_TENANT_EXTERNAL_ID) ??
    normalizeString((env as any)?.TOAST_TENANT_GUID) ??
    normalizeString((env as any)?.TOAST_TENANT_ID) ??
    normalizeString((env as any)?.TOAST_LOCATION_GUID) ??
    normalizeString((env as any)?.TOAST_LOCATION_ID) ??
    normalizeString((env as any)?.TOAST_RESTAURANT_EXTERNAL_ID) ??
    normalizeString(env.TOAST_RESTAURANT_GUID) ??
    "default";

  return `${CACHE_KEY_PREFIX}${scope}`;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}
