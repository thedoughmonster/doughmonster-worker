import type { AppEnv } from "../../../config/env.js";
import { getMenuItems, getSalesCategories } from "../../../clients/toast.js";
import { jsonResponse } from "../../../lib/http.js";

const MAX_PAGES = 50;

export interface MenuDictDeps {
  getMenuItems: typeof getMenuItems;
  getSalesCategories: typeof getSalesCategories;
}

export function createMenuDictHandler(
  deps: MenuDictDeps = { getMenuItems, getSalesCategories }
) {
  return async function handleMenuDict(env: AppEnv, request: Request) {
    const url = new URL(request.url);
    const lastModified = sanitizeLastModified(url.searchParams.get("lastModified"));

    try {
      const startedAt = Date.now();
      console.log(
        `[menu/dict] start ${new Date(startedAt).toISOString()} lastModified=${
          lastModified ?? "none"
        }`
      );

      const categoriesByGuid = await loadCategories(deps, env);

      const allItems: any[] = [];
      let pageToken: string | null = null;
      let page = 0;

      while (page < MAX_PAGES) {
        page += 1;
        const pageResult = await deps.getMenuItems(env, {
          ...(lastModified ? { lastModified } : {}),
          ...(pageToken ? { pageToken } : {}),
        });
        const pageItems = Array.isArray(pageResult.items) ? pageResult.items : [];
        allItems.push(...pageItems);
        pageToken = pageResult.nextPageToken ?? null;

        if (!pageToken) {
          break;
        }
      }

      if (page >= MAX_PAGES && pageToken) {
        console.warn(`[menu/dict] hit MAX_PAGES=${MAX_PAGES}`);
      }

      const normalized = allItems
        .map((item) => normalizeMenuItem(item, categoriesByGuid))
        .filter((item): item is NormalizedMenuItem => item !== null);

      const data = buildData(normalized, url.searchParams.get("as"));

      const finishedAt = Date.now();
      console.log(
        `[menu/dict] finish ${new Date(finishedAt).toISOString()} count=${
          normalized.length
        } pages=${page} duration=${finishedAt - startedAt}ms`
      );

      return jsonResponse({
        ok: true,
        route: "/api/menu/dict",
        ...(lastModified ? { lastModified } : {}),
        count: normalized.length,
        data,
      });
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 500;
      const snippet = err?.bodySnippet ?? err?.message ?? String(err ?? "Unknown error");
      const toastRequestId =
        typeof err?.toastRequestId === "string" && err.toastRequestId.trim().length > 0
          ? err.toastRequestId
          : null;

      if (status === 404 && toastEntitlementMissing(snippet)) {
        if (toastRequestId) {
          console.warn(`[menu/dict] toastRequestId=${toastRequestId}`);
        }

        return jsonResponse(
          {
            ok: false,
            route: "/api/menu/dict",
            error: "toast_configuration_not_available",
            hint:
              "Enable Configuration API (config:read) or Menus V2 (menus:read) for this client.",
            ...(toastRequestId ? { toastRequestId } : {}),
          },
          { status }
        );
      }

      return jsonResponse(
        {
          ok: false,
          route: "/api/menu/dict",
          error: typeof snippet === "string" ? snippet : "Unknown error",
          ...(toastRequestId ? { toastRequestId } : {}),
        },
        { status }
      );
    }
  };
}

export default createMenuDictHandler();

async function loadCategories(deps: MenuDictDeps, env: AppEnv): Promise<Map<string, string | null>> {
  const allCategories: any[] = [];
  let pageToken: string | null = null;
  let page = 0;

  while (page < MAX_PAGES) {
    page += 1;
    const result = await deps.getSalesCategories(env, {
      ...(pageToken ? { pageToken } : {}),
    });
    const pageCategories = Array.isArray(result.categories) ? result.categories : [];
    allCategories.push(...pageCategories);
    pageToken = result.nextPageToken ?? null;

    if (!pageToken) {
      break;
    }
  }

  if (page >= MAX_PAGES && pageToken) {
    console.warn(`[menu/dict] sales categories hit MAX_PAGES=${MAX_PAGES}`);
  }

  return buildCategoryMap(allCategories);
}

interface NormalizedMenuItem {
  guid: string;
  name: string;
  basePrice: number | null;
  salesCategoryName: string | null;
  multiLocationId: string | null;
}

function normalizeMenuItem(
  item: any,
  categoriesByGuid: Map<string, string | null>
): NormalizedMenuItem | null {
  const guid = extractGuid(item);
  if (!guid) {
    return null;
  }

  const name = extractName(item) ?? guid;
  const basePrice = extractBasePrice(item);
  const salesCategoryGuid = extractSalesCategoryGuid(item);
  const salesCategoryName = salesCategoryGuid
    ? categoriesByGuid.get(salesCategoryGuid) ?? null
    : null;
  const multiLocationId = extractMultiLocationId(item);

  return { guid, name, basePrice, salesCategoryName, multiLocationId };
}

function buildCategoryMap(categories: any[]): Map<string, string | null> {
  const map = new Map<string, string | null>();

  for (const category of categories) {
    const guid = extractCategoryGuid(category);
    if (!guid) {
      continue;
    }

    const name = extractCategoryName(category);
    map.set(guid, name);
  }

  return map;
}

function extractGuid(item: any): string | null {
  const candidates = [item?.guid, item?.menuItemGuid, item?.itemGuid, item?.multiLocationItemGuid];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function extractName(item: any): string | null {
  const candidates = [item?.name, item?.displayName, item?.menuItemName, item?.shortName];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function extractBasePrice(item: any): number | null {
  const candidates = [
    item?.basePrice,
    item?.price,
    item?.priceInfo?.basePrice,
    item?.priceInfo?.price,
    item?.priceInfo?.amount,
    item?.priceInfo?.value,
    item?.defaultPrice,
  ];

  for (const candidate of candidates) {
    const parsed = toNumber(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  if (Array.isArray(item?.prices)) {
    for (const price of item.prices) {
      const parsed = toNumber(price?.amount ?? price?.price ?? price);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

function extractSalesCategoryGuid(item: any): string | null {
  const candidates = [
    item?.salesCategoryGuid,
    item?.salesCategory?.guid,
    item?.salesCategory?.salesCategoryGuid,
    item?.categoryGuid,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function extractMultiLocationId(item: any): string | null {
  const candidates = [
    item?.multiLocationId,
    item?.multiLocationGuid,
    item?.multiLocationItemId,
    item?.masterId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

function extractCategoryGuid(category: any): string | null {
  const candidates = [category?.guid, category?.salesCategoryGuid];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function extractCategoryName(category: any): string | null {
  const candidates = [category?.name, category?.salesCategoryName, category?.displayName];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (value && typeof value === "object") {
    const maybe = (value as any).amount ?? (value as any).price ?? (value as any).value;
    if (maybe !== undefined) {
      return toNumber(maybe);
    }
  }

  return null;
}

function sanitizeLastModified(input: string | null): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildData(
  items: NormalizedMenuItem[],
  asParam: string | null
): NormalizedMenuItem[] | Record<string, NormalizedMenuItem> {
  const mode = (asParam ?? "dict").toLowerCase();

  if (mode === "array") {
    return items;
  }

  const dict: Record<string, NormalizedMenuItem> = {};

  for (const item of items) {
    dict[item.guid] = item;
  }

  return dict;
}

function toastEntitlementMissing(snippet: unknown): boolean {
  if (typeof snippet !== "string") {
    return false;
  }

  return /"code"\s*:\s*(?:10022|"10022")/.test(snippet);
}
