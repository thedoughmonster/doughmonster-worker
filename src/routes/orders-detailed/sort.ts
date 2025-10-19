import type { ToastSelection } from "../../types/toast-orders.js";
import { extractNumber, extractTimestamp } from "./extractors.js";
import type { ExpandedOrderItem, ItemSortMeta } from "./types-local.js";

export function buildItemSortMeta(
  selection: ToastSelection,
  itemName: string,
  menuItemId: string | null | undefined,
  lineItemId: string,
  iteration: number
): ItemSortMeta {
  return {
    displayOrder: extractNumber(selection as any, ["displaySequence", "displayOrder", "displayIndex", "displayPosition", "sequence", "sequenceNumber", "position", "context.displayOrder", "context.displaySequence"]),
    createdTime:
      extractTimestamp(selection as any, ["createdDate", "createdAt", "creationDate", "createdTime", "fireTime", "timestamp", "time"])?.ms ??
      null,
    receiptPosition: extractNumber(selection as any, ["receiptLinePosition", "receiptLineIndex", "receiptPosition", "receiptIndex"]),
    selectionIndex: extractNumber(selection as any, ["selectionIndex"]),
    iteration,
    seatNumber: extractNumber(selection as any, ["seatNumber", "seat", "seatPosition", "seatNum", "context.seatNumber"]),
    itemNameLower: itemName.toLowerCase(),
    menuItemId,
    lineItemId,
  };
}

export function sortItems(items: ExpandedOrderItem[], metas: ItemSortMeta[]): ExpandedOrderItem[] {
  return items
    .map((item, index) => ({ item, meta: metas[index] }))
    .sort((a, b) => compareItemMeta(a.meta, b.meta))
    .map((entry) => entry.item);
}

export function compareItemMeta(a: ItemSortMeta, b: ItemSortMeta): number {
  for (const key of ["displayOrder", "createdTime", "receiptPosition", "selectionIndex"] as const) {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal !== null && bVal !== null && aVal !== bVal) return aVal - bVal;
    if (aVal !== null && bVal === null) return -1;
    if (aVal === null && bVal !== null) return 1;
  }
  if (a.iteration !== b.iteration) return a.iteration - b.iteration;
  if (a.seatNumber !== null || b.seatNumber !== null) {
    if (a.seatNumber !== null && b.seatNumber !== null && a.seatNumber !== b.seatNumber) return a.seatNumber - b.seatNumber;
    if (a.seatNumber !== null) return -1;
    if (b.seatNumber !== null) return 1;
  }
  if (a.itemNameLower !== b.itemNameLower) return a.itemNameLower < b.itemNameLower ? -1 : 1;
  const menuA = a.menuItemId ?? "";
  const menuB = b.menuItemId ?? "";
  if (menuA !== menuB) return menuA.localeCompare(menuB);
  return a.lineItemId.localeCompare(b.lineItemId);
}
