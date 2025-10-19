import type { ToastSelection } from "../../types/toast-orders.js";
import { pickString, extractNumber, normalizeQuantity } from "./extractors.js";
import type { MenuIndex } from "./menu-index.js";
import type { ExpandedOrderItemModifier, RawModifier } from "./types-local.js";

export function toCents(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

export function sumAmounts(collection: unknown, fields: string[]): number {
  if (!Array.isArray(collection)) return 0;
  let total = 0;
  for (const entry of collection) {
    const cents = toCents(extractNumber(entry as any, fields));
    if (cents !== null) total += Math.max(cents, 0);
  }
  return total;
}

export function collectModifierDetails(
  selection: ToastSelection,
  menuIndex: MenuIndex,
  parentQuantity: number
): { modifiers: ExpandedOrderItemModifier[]; totalCents: number } {
  const raw: RawModifier[] = [];
  const modifiers = Array.isArray((selection as any)?.modifiers) ? ((selection as any).modifiers as ToastSelection[]) : [];
  for (const modifier of modifiers) {
    if (!modifier) continue;
    const base = menuIndex.findModifier((modifier as any)?.item);
    const name =
      pickString([
        (base as any)?.kitchenName,
        (base as any)?.name,
        (modifier as any)?.displayName,
        (modifier as any)?.name,
        (modifier as any)?.item?.name,
        (modifier as any)?.item?.guid,
      ]) ?? "Unknown modifier";
    const groupName = pickString([
      (modifier as any)?.optionGroup?.name,
      (base as any)?.optionGroupName,
      (base as any)?.groupName,
      (base as any)?.menuOptionGroup?.name,
    ]);
    const id = pickString([(modifier as any)?.item?.guid, (base as any)?.guid, (modifier as any)?.guid]);
    const quantity = normalizeQuantity((modifier as any)?.quantity);
    const unitPrice = toCents(extractNumber(modifier as any, ["price", "receiptLinePrice"]));
    const totalPrice = unitPrice !== null ? unitPrice * quantity * parentQuantity : 0;
    raw.push({ id: id ?? null, name, groupName: groupName ?? null, priceCents: totalPrice, quantity, unitPriceCents: unitPrice });
    if (Array.isArray((modifier as any)?.modifiers) && (modifier as any).modifiers.length > 0) {
      const nested = collectModifierDetails(modifier as ToastSelection, menuIndex, parentQuantity * quantity);
      for (const entry of nested.modifiers)
        raw.push({ id: entry.id, name: entry.name, groupName: entry.groupName ?? null, priceCents: entry.priceCents, quantity: entry.quantity, unitPriceCents: null });
    }
  }
  const collapsed = collapseModifiers(raw).sort(compareModifiers);
  return { modifiers: collapsed, totalCents: collapsed.reduce((sum, mod) => sum + mod.priceCents, 0) };
}

export function resolveItemTotal(baseTotal: number | null, modifiersTotal: number, explicitTotal: number | null): number | null {
  if (explicitTotal !== null && baseTotal !== null) return Math.max(explicitTotal, baseTotal + modifiersTotal);
  if (explicitTotal !== null) return explicitTotal;
  if (baseTotal !== null) return baseTotal + modifiersTotal;
  return modifiersTotal > 0 ? modifiersTotal : null;
}

export function collapseModifiers(modifiers: RawModifier[]): ExpandedOrderItemModifier[] {
  const aggregated = new Map<string, RawModifier>();
  for (const modifier of modifiers) {
    const identifier = modifier.id ? `id:${modifier.id}` : `name:${modifier.name.toLowerCase()}`;
    const group = (modifier.groupName ?? "").toLowerCase();
    const unit = modifier.unitPriceCents ?? -1;
    const key = `${identifier}|${group}|${unit}`;
    const existing = aggregated.get(key);
    if (!existing) aggregated.set(key, { ...modifier });
    else {
      existing.quantity += modifier.quantity;
      existing.priceCents += modifier.priceCents;
      if ((!existing.groupName || existing.groupName.length === 0) && modifier.groupName) existing.groupName = modifier.groupName;
      if (!existing.id && modifier.id) existing.id = modifier.id;
    }
  }
  return Array.from(aggregated.values()).map((entry) => ({
    id: entry.id ?? null,
    name: entry.name,
    groupName: entry.groupName,
    priceCents: entry.priceCents,
    quantity: entry.quantity,
  }));
}

export function compareModifiers(a: ExpandedOrderItemModifier, b: ExpandedOrderItemModifier): number {
  const groupA = (a.groupName ?? "").toLowerCase();
  const groupB = (b.groupName ?? "").toLowerCase();
  if (groupA !== groupB) return groupA < groupB ? -1 : 1;
  const nameA = a.name.toLowerCase();
  const nameB = b.name.toLowerCase();
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  return (a.id ?? "").localeCompare(b.id ?? "");
}
