import type { AppEnv } from "../../config/env.js";
import {
  getMenuMetadata,
  getPublishedMenus,
  type MenuMetadataResponse,
  type PublishedMenuResponse,
} from "../../clients/toast.js";
import { jsonResponse } from "../../lib/http.js";

interface MenuCacheEntry {
  lastUpdated: string;
  menu: PublishedMenuResponse | null;
  cachedAt: string;
}

let menuCache: MenuCacheEntry | null = null;

export interface FetchMenusResult {
  metadata: MenuMetadataResponse;
  menu: PublishedMenuResponse | null;
  cacheHit: boolean;
}

export async function fetchPublishedMenu(env: AppEnv): Promise<FetchMenusResult | null> {
  const metadata = await getMenuMetadata(env);

  if (!metadata) {
    return null;
  }

  if (menuCache && menuCache.lastUpdated === metadata.lastUpdated) {
    return { metadata, menu: menuCache.menu, cacheHit: true };
  }

  const menu = await getPublishedMenus(env);
  menuCache = {
    lastUpdated: metadata.lastUpdated,
    menu,
    cachedAt: new Date().toISOString(),
  };

  return { metadata, menu, cacheHit: false };
}

export default async function handleMenus(env: AppEnv): Promise<Response> {
  const result = await fetchPublishedMenu(env);

  if (!result) {
    return jsonResponse(
      {
        ok: false,
        error: "No published menu data available",
      },
      { status: 404 }
    );
  }

  return jsonResponse({
    ok: true,
    metadata: result.metadata,
    menu: result.menu,
    cacheHit: result.cacheHit,
  });
}
