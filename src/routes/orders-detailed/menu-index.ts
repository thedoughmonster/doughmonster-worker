import type { ToastMenuItem, ToastMenusDocument, ToastModifierOption } from "../../types/toast-menus.js";
import type { ToastSelection } from "../../types/toast-orders.js";

export function createMenuIndex(document: ToastMenusDocument | null) {
  const itemsByGuid = new Map<string, ToastMenuItem>();
  const itemsByMulti = new Map<string, ToastMenuItem>();
  const itemsByRef = new Map<string | number, ToastMenuItem>();
  const modifiersByGuid = new Map<string, ToastModifierOption>();
  const modifiersByMulti = new Map<string, ToastModifierOption>();
  const modifiersByRef = new Map<string | number, ToastModifierOption>();

  if (document) {
    for (const modifier of Object.values(document.modifierOptionReferences ?? {})) {
      const any = modifier as any;
      if (typeof any?.guid === "string") modifiersByGuid.set(any.guid, modifier as ToastModifierOption);
      if (any?.multiLocationId !== undefined) modifiersByMulti.set(String(any.multiLocationId), modifier as ToastModifierOption);
      if (any?.referenceId !== undefined && any.referenceId !== null) modifiersByRef.set(any.referenceId, modifier as ToastModifierOption);
    }

    const stack: any[] = [];
    for (const menu of document.menus ?? []) for (const group of menu.menuGroups ?? []) stack.push(group);
    while (stack.length > 0) {
      const group = stack.pop();
      if (!group) continue;
      for (const item of group.items ?? []) {
        const any = item as any;
        if (typeof any?.guid === "string") itemsByGuid.set(any.guid, item as ToastMenuItem);
        if (any?.multiLocationId !== undefined) itemsByMulti.set(String(any.multiLocationId), item as ToastMenuItem);
        if (any?.referenceId !== undefined && any.referenceId !== null) itemsByRef.set(any.referenceId, item as ToastMenuItem);
      }
      for (const child of group.menuGroups ?? []) stack.push(child);
    }
  }

  return {
    findItem(reference: ToastSelection["item"]): ToastMenuItem | undefined {
      if (!reference) return undefined;
      if (reference.guid && itemsByGuid.has(reference.guid)) return itemsByGuid.get(reference.guid);
      const multi = (reference as any)?.multiLocationId;
      if (multi !== undefined && itemsByMulti.has(String(multi))) return itemsByMulti.get(String(multi));
      const refId = (reference as any)?.referenceId;
      if (refId !== undefined && refId !== null && itemsByRef.has(refId)) return itemsByRef.get(refId);
      return undefined;
    },
    findModifier(reference: ToastSelection["item"]): ToastModifierOption | undefined {
      if (!reference) return undefined;
      if (reference.guid && modifiersByGuid.has(reference.guid)) return modifiersByGuid.get(reference.guid);
      const multi = (reference as any)?.multiLocationId;
      if (multi !== undefined && modifiersByMulti.has(String(multi))) return modifiersByMulti.get(String(multi));
      const refId = (reference as any)?.referenceId;
      if (refId !== undefined && refId !== null && modifiersByRef.has(refId)) return modifiersByRef.get(refId);
      return undefined;
    },
  };
}

export type MenuIndex = ReturnType<typeof createMenuIndex>;
