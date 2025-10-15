import type { AppEnv } from "../../../config/env.js";
import { getOrdersBulk } from "../../../clients/toast.js";
import { jsonResponse } from "../../../lib/http.js";
import type { ToastCheck, ToastOrder, ToastSelection } from "../../../types/toast-orders.js";
import type {
  ToastMenu,
  ToastMenuGroup,
  ToastMenuItem,
  ToastMenusDocument,
  ToastModifierGroup,
  ToastModifierOption,
  ToastPreModifierOption,
} from "../../../types/toast-menus.js";
import { fetchPublishedMenu } from "../menus.js";

const EXPAND_FULL = [
  "checks",
  "items",
  "payments",
  "discounts",
  "serviceCharges",
  "customers",
  "employee",
];

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const ROUTE = "/api/orders/latest-with-menu";

export interface OrdersLatestWithMenuDeps {
  getOrdersBulk: typeof getOrdersBulk;
  fetchPublishedMenu: typeof fetchPublishedMenu;
}

export interface MenuItemPath {
  menuGuid: string;
  menuName?: string | null;
  menuGroupGuid: string;
  menuGroupName?: string | null;
}

export interface EnrichedSelection extends ToastSelection {
  modifiers?: EnrichedSelection[];
  menuItem?: ToastMenuItem | null;
  menuItemPath?: MenuItemPath;
  modifierOption?: ToastModifierOption | null;
  modifierGroup?: ToastModifierGroup | null;
  preModifierOption?: ToastPreModifierOption | null;
}

export interface EnrichedCheck extends ToastCheck {
  selections: EnrichedSelection[];
}

export interface EnrichedOrder extends ToastOrder {
  checks: EnrichedCheck[];
}

export interface EnrichedLineItem {
  orderGuid: string | null;
  checkGuid: string | null;
  parentSelectionGuid: string | null;
  selectionGuid: string;
  selectionType: EnrichedSelection["selectionType"];
  quantity: number;
  itemGuid: string | null;
  optionGroupGuid: string | null;
  humanReadableName: string | null;
  menuItemPath?: MenuItemPath;
  menuItem?: ToastMenuItem | null;
  modifierOption?: ToastModifierOption | null;
  modifierGroup?: ToastModifierGroup | null;
  preModifierOption?: ToastPreModifierOption | null;
}

interface MenuIndex {
  items: Map<string, { menu: ToastMenu; group: ToastMenuGroup; item: ToastMenuItem }>;
  modifierGroups: Map<string, ToastModifierGroup>;
  modifierOptions: Map<string, ToastModifierOption>;
  preModifierOptions: Map<string, ToastPreModifierOption>;
}

export function createOrdersLatestWithMenuHandler(
  deps: OrdersLatestWithMenuDeps = { getOrdersBulk, fetchPublishedMenu }
) {
  return async function handleOrdersLatestWithMenu(env: AppEnv, request: Request) {
    const url = new URL(request.url);
    const minutesParam = url.searchParams.get("minutes");
    const minutes = clamp(Number(minutesParam ?? 60) || 60, 1, 120);
    const wantDebug = url.searchParams.get("debug") === "1" || url.searchParams.has("debug");

    try {
      const menuResult = await deps.fetchPublishedMenu(env);
      if (!menuResult?.metadata) {
        return jsonResponse(
          {
            ok: false,
            route: ROUTE,
            error: "No published menu metadata available",
          },
          { status: 503 }
        );
      }

      const menuIndex = buildMenuIndex(menuResult.menu);
      const startedAt = Date.now();
      const now = new Date();
      const start = new Date(now.getTime() - minutes * 60_000);
      const startDateIso = toToastIsoUtc(start);
      const endDateIso = toToastIsoUtc(now);

      console.log(
        `[orders/latest-with-menu] start ${new Date(startedAt).toISOString()} window=${startDateIso}→${endDateIso}`
      );

      const pageDebug: Array<{ page: number; url: string; returned: number }> = [];
      const allOrders: ToastOrder[] = [];

      let page = 1;
      let lastPageCount = 0;

      while (page <= MAX_PAGES) {
        const { orders, nextPage } = await deps.getOrdersBulk(env, {
          startIso: startDateIso,
          endIso: endDateIso,
          page,
          pageSize: PAGE_SIZE,
        });

        const requestUrl = buildOrdersBulkUrl(env.TOAST_API_BASE, {
          startIso: startDateIso,
          endIso: endDateIso,
          page,
          pageSize: PAGE_SIZE,
        });

        pageDebug.push({ page, url: requestUrl, returned: orders.length });
        allOrders.push(...orders);
        lastPageCount = orders.length;

        const hasMore =
          (typeof nextPage === "number" && nextPage > page) || orders.length === PAGE_SIZE;

        if (!hasMore) {
          break;
        }

        page += 1;
      }

      if (page > MAX_PAGES && lastPageCount === PAGE_SIZE) {
        console.warn(
          `[orders/latest-with-menu] hit MAX_PAGES=${MAX_PAGES} for window ${startDateIso}→${endDateIso}`
        );
      }

      const sorted = allOrders.slice().sort((a, b) => {
        const aTime = a.modifiedDate ? Date.parse(a.modifiedDate) : 0;
        const bTime = b.modifiedDate ? Date.parse(b.modifiedDate) : 0;
        return bTime - aTime;
      });

      const ids = Array.from(new Set(sorted.map((order) => order.guid).filter(Boolean)));
      const enrichedOrders = sorted.map((order) => enrichOrder(order, menuIndex));
      const lineItems = enrichedOrders.flatMap((order) => collectLineItems(order));

      const responseBody: Record<string, unknown> = {
        ok: true,
        route: ROUTE,
        minutes,
        window: { start: startDateIso, end: endDateIso },
        detail: "enriched",
        expandUsed: EXPAND_FULL,
        count: sorted.length,
        ids,
        orders: ids,
        menu: {
          metadata: menuResult.metadata,
          cacheHit: menuResult.cacheHit,
          hasMenu: Boolean(menuResult.menu),
        },
        data: enrichedOrders,
        lineItems,
      };

      if (wantDebug) {
        responseBody.debug = {
          pages: pageDebug,
          totalReturned: sorted.length,
        };
      }

      const finishedAt = Date.now();
      console.log(
        `[orders/latest-with-menu] finish ${new Date(finishedAt).toISOString()} count=${sorted.length} pages=${pageDebug.length} duration=${
          finishedAt - startedAt
        }ms`
      );

      return jsonResponse(responseBody);
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 500;
      const snippet = err?.bodySnippet ?? err?.message ?? String(err ?? "Unknown error");

      return jsonResponse(
        {
          ok: false,
          route: ROUTE,
          error: typeof snippet === "string" ? snippet : "Unknown error",
        },
        { status }
      );
    }
  };
}

export default createOrdersLatestWithMenuHandler();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toToastIsoUtc(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const yyyy = date.getUTCFullYear();
  const MM = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const HH = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  const mmm = pad(date.getUTCMilliseconds(), 3);
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.${mmm}+0000`;
}

function buildOrdersBulkUrl(
  base: string,
  params: { startIso: string; endIso: string; page: number; pageSize: number }
): string {
  const normalized = base.replace(/\/+$/, "");
  const url = new URL(`${normalized}/orders/v2/ordersBulk`);
  url.searchParams.set("startDate", params.startIso);
  url.searchParams.set("endDate", params.endIso);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("pageSize", String(params.pageSize));
  return url.toString();
}

function buildMenuIndex(menu: ToastMenusDocument | null): MenuIndex {
  const items = new Map<string, { menu: ToastMenu; group: ToastMenuGroup; item: ToastMenuItem }>();
  const modifierGroups = new Map<string, ToastModifierGroup>();
  const modifierOptions = new Map<string, ToastModifierOption>();
  const preModifierOptions = new Map<string, ToastPreModifierOption>();

  if (menu) {
    if (menu.menus) {
      for (const menuEntry of menu.menus) {
        if (!menuEntry?.menuGroups) {
          continue;
        }

        for (const group of menuEntry.menuGroups) {
          if (!group?.items) {
            continue;
          }

          for (const item of group.items) {
            if (item?.guid) {
              items.set(item.guid, { menu: menuEntry, group, item });
            }
          }
        }
      }
    }

    if (menu.modifierGroupReferences) {
      for (const group of Object.values(menu.modifierGroupReferences)) {
        if (group?.guid) {
          modifierGroups.set(group.guid, group);
        }
        if (group?.options) {
          for (const option of group.options) {
            if (option?.guid) {
              modifierOptions.set(option.guid, option);
            }
          }
        }
      }
    }

    if (menu.modifierOptionReferences) {
      for (const option of Object.values(menu.modifierOptionReferences)) {
        if (option?.guid) {
          modifierOptions.set(option.guid, option);
        }
      }
    }

    if (menu.preModifierGroupReferences) {
      for (const group of Object.values(menu.preModifierGroupReferences)) {
        if (group?.options) {
          for (const option of group.options) {
            if (option?.guid) {
              preModifierOptions.set(option.guid, option);
            }
          }
        }
      }
    }
  }

  return { items, modifierGroups, modifierOptions, preModifierOptions };
}

function enrichOrder(order: ToastOrder, menuIndex: MenuIndex): EnrichedOrder {
  const checks = Array.isArray(order.checks)
    ? order.checks.map((check) => enrichCheck(check, menuIndex))
    : [];

  return {
    ...order,
    checks,
  };
}

function enrichCheck(check: ToastCheck, menuIndex: MenuIndex): EnrichedCheck {
  const selections = Array.isArray(check.selections)
    ? check.selections.map((selection) => enrichSelection(selection, menuIndex))
    : [];

  return {
    ...check,
    selections,
  };
}

function enrichSelection(selection: ToastSelection, menuIndex: MenuIndex): EnrichedSelection {
  const modifiers = Array.isArray(selection.modifiers)
    ? selection.modifiers.map((modifier) => enrichSelection(modifier, menuIndex))
    : [];

  const enriched: EnrichedSelection = {
    ...selection,
    modifiers,
  };

  const itemGuid = selection.item?.guid;
  if (itemGuid) {
    const match = menuIndex.items.get(itemGuid);
    if (match) {
      enriched.menuItem = match.item;
      enriched.menuItemPath = {
        menuGuid: match.menu.guid,
        menuName: match.menu.name ?? null,
        menuGroupGuid: match.group.guid,
        menuGroupName: match.group.name ?? null,
      };
    }

    const modifierOption = menuIndex.modifierOptions.get(itemGuid);
    if (modifierOption) {
      enriched.modifierOption = modifierOption;
    }
  }

  const optionGroupGuid = selection.optionGroup?.guid;
  if (optionGroupGuid) {
    const group = menuIndex.modifierGroups.get(optionGroupGuid);
    if (group) {
      enriched.modifierGroup = group;
    }
  }

  const preModifierGuid = selection.preModifier?.guid;
  if (preModifierGuid) {
    const preModifier = menuIndex.preModifierOptions.get(preModifierGuid);
    if (preModifier) {
      enriched.preModifierOption = preModifier;
    }
  }

  return enriched;
}

function collectLineItems(order: EnrichedOrder): EnrichedLineItem[] {
  const items: EnrichedLineItem[] = [];

  for (const check of order.checks ?? []) {
    for (const selection of check.selections ?? []) {
      collect(selection, null, check);
    }
  }

  return items;

  function collect(
    selection: EnrichedSelection,
    parent: EnrichedSelection | null,
    check: EnrichedCheck
  ): void {
    items.push({
      orderGuid: order.guid ?? null,
      checkGuid: check.guid ?? null,
      parentSelectionGuid: parent?.guid ?? null,
      selectionGuid: selection.guid,
      selectionType: selection.selectionType,
      quantity: selection.quantity,
      itemGuid: selection.item?.guid ?? null,
      optionGroupGuid: selection.optionGroup?.guid ?? null,
      humanReadableName: computeHumanReadableName(selection),
      menuItemPath: selection.menuItemPath,
      menuItem: selection.menuItem ?? null,
      modifierOption: selection.modifierOption ?? null,
      modifierGroup: selection.modifierGroup ?? null,
      preModifierOption: selection.preModifierOption ?? null,
    });

    for (const modifier of selection.modifiers ?? []) {
      collect(modifier, selection, check);
    }
  }
}

function computeHumanReadableName(selection: EnrichedSelection): string | null {
  return (
    selection.menuItem?.name ??
    selection.modifierOption?.name ??
    selection.preModifierOption?.name ??
    selection.item?.externalId ??
    selection.item?.guid ??
    selection.selectionType ??
    null
  );
}
