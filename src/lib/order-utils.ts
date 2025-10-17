export function normalizeToastTimestamp(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  return value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

export function parseToastTimestamp(value: string | null | undefined): number | null {
  const normalized = normalizeToastTimestamp(value ?? null);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

export function toToastIsoUtc(date: Date): string {
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

export interface OrderTimestampDetails {
  ms: number | null;
  iso: string | null;
}

export function resolveOrderOpenedAt(order: any): OrderTimestampDetails {
  const candidates = [
    typeof order?.openedDate === "string" ? order.openedDate : null,
    typeof order?.createdDate === "string" ? order.createdDate : null,
    typeof order?.orderDate === "string" ? order.orderDate : null,
    typeof order?.context?.openedDate === "string" ? order.context.openedDate : null,
    typeof order?.context?.createdDate === "string" ? order.context.createdDate : null,
  ];

  for (const candidate of candidates) {
    const parsed = parseToastTimestamp(candidate);
    if (parsed !== null) {
      return { ms: parsed, iso: normalizeToastTimestamp(candidate) };
    }
  }

  return { ms: null, iso: null };
}

export function resolveOrderModifiedAt(order: any): number | null {
  const candidates = [
    typeof order?.modifiedDate === "string" ? order.modifiedDate : null,
    typeof order?.context?.modifiedDate === "string" ? order.context.modifiedDate : null,
    typeof order?.lastModifiedDate === "string" ? order.lastModifiedDate : null,
    typeof order?.context?.lastModifiedDate === "string" ? order.context.lastModifiedDate : null,
  ];

  for (const candidate of candidates) {
    const parsed = parseToastTimestamp(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function resolveBusinessDate(order: any, fallbackMs: number | null = null): string | null {
  const sources = [order?.businessDate, order?.context?.businessDate];

  for (const source of sources) {
    if (typeof source === "number" && Number.isFinite(source)) {
      const digits = Math.abs(Math.trunc(source));
      return String(digits).padStart(8, "0");
    }
    if (typeof source === "string") {
      const trimmed = source.trim();
      if (!trimmed) {
        continue;
      }
      if (/^\d{8}$/.test(trimmed)) {
        return trimmed;
      }
      const digits = trimmed.replace(/[^0-9]/g, "");
      if (digits.length === 8) {
        return digits;
      }
    }
  }

  if (fallbackMs !== null) {
    return formatBusinessDate(new Date(fallbackMs));
  }

  return null;
}

export function formatBusinessDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  return `${yyyy}${mm}${dd}`;
}

export type ItemFulfillmentStatus = "NEW" | "HOLD" | "SENT" | "READY";

const ITEM_STATUS_ORDER: Record<ItemFulfillmentStatus, number> = {
  NEW: 0,
  HOLD: 1,
  SENT: 2,
  READY: 3,
};

export interface DerivedOrderFulfillmentStatus {
  normalizedStatus: string | null;
  guestStatus: string | null;
  selectionStatus: ItemFulfillmentStatus | null;
  hasItemStatuses: boolean;
  allItemStatusesReady: boolean;
  anyItemStatusNotReady: boolean;
}

export function deriveOrderFulfillmentStatus(order: any): DerivedOrderFulfillmentStatus {
  let guestStatus: string | null = null;
  let selectionStatus: ItemFulfillmentStatus | null = null;
  let hasItemStatuses = false;
  let allItemStatusesReady = false;
  let anyItemStatusNotReady = false;

  const checks = Array.isArray(order?.checks) ? order.checks : [];

  for (const check of checks) {
    if (!check || typeof check !== "object") {
      continue;
    }

    if (!guestStatus) {
      const extractedGuestStatus = extractGuestOrderFulfillmentStatus(order, check);
      if (extractedGuestStatus) {
        guestStatus = extractedGuestStatus;
      }
    }

    const initialStatus = extractOrderFulfillmentStatus(order, check);
    if (initialStatus) {
      selectionStatus = mergeFulfillmentStatuses(selectionStatus, initialStatus);
      hasItemStatuses = true;
      if (initialStatus === "READY") {
        if (!anyItemStatusNotReady) {
          allItemStatusesReady = true;
        }
      } else {
        anyItemStatusNotReady = true;
        allItemStatusesReady = false;
      }
    }

    const selections = Array.isArray(check?.selections) ? check.selections : [];
    for (const selection of selections) {
      if (!selection || typeof selection !== "object") {
        continue;
      }

      if (isSelectionVoided(selection)) {
        continue;
      }

      const normalized = normalizeItemFulfillmentStatus((selection as any)?.fulfillmentStatus);
      if (!normalized) {
        continue;
      }

      selectionStatus = mergeFulfillmentStatuses(selectionStatus, normalized);
      hasItemStatuses = true;

      if (normalized === "READY") {
        if (!anyItemStatusNotReady) {
          allItemStatusesReady = true;
        }
      } else {
        anyItemStatusNotReady = true;
        allItemStatusesReady = false;
      }
    }
  }

  if (guestStatus) {
    return {
      normalizedStatus: guestStatus,
      guestStatus,
      selectionStatus,
      hasItemStatuses,
      allItemStatusesReady,
      anyItemStatusNotReady,
    };
  }

  if (hasItemStatuses) {
    const derived = allItemStatusesReady ? "READY_FOR_PICKUP" : anyItemStatusNotReady ? "IN_PREPARATION" : null;
    return {
      normalizedStatus: derived,
      guestStatus,
      selectionStatus,
      hasItemStatuses,
      allItemStatusesReady,
      anyItemStatusNotReady,
    };
  }

  return {
    normalizedStatus: null,
    guestStatus,
    selectionStatus,
    hasItemStatuses,
    allItemStatusesReady,
    anyItemStatusNotReady,
  };
}

export function isFulfillmentStatusReady(status: string | null | undefined): boolean {
  if (typeof status !== "string") {
    return false;
  }
  const normalized = status.trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  return READY_STATUSES.has(normalized);
}

const READY_STATUSES = new Set([
  "READY_FOR_PICKUP",
  "READY",
  "DELIVERED",
  "COMPLETED",
  "FULFILLED",
  "PICKED_UP",
  "CLOSED",
  "DONE",
]);

export function resolveReadyTimestampMs(order: any): number | null {
  const candidates: Array<string | null> = [
    typeof order?.readyDate === "string" ? order.readyDate : null,
    typeof order?.readyTime === "string" ? order.readyTime : null,
    typeof order?.closedDate === "string" ? order.closedDate : null,
    typeof order?.completedDate === "string" ? order.completedDate : null,
    typeof order?.fulfillmentCompletedDate === "string" ? order.fulfillmentCompletedDate : null,
    typeof order?.actualFulfillmentDate === "string" ? order.actualFulfillmentDate : null,
    typeof order?.promisedDate === "string" ? order.promisedDate : null,
    typeof order?.estimatedFulfillmentDate === "string" ? order.estimatedFulfillmentDate : null,
    typeof order?.fulfillment?.completedDate === "string" ? order.fulfillment.completedDate : null,
    typeof order?.fulfillment?.readyDate === "string" ? order.fulfillment.readyDate : null,
    typeof order?.fulfillment?.actualFulfillmentDate === "string" ? order.fulfillment.actualFulfillmentDate : null,
    typeof order?.context?.readyDate === "string" ? order.context.readyDate : null,
    typeof order?.context?.closedDate === "string" ? order.context.closedDate : null,
    typeof order?.context?.actualFulfillmentDate === "string"
      ? order.context.actualFulfillmentDate
      : null,
    typeof order?.modifiedDate === "string" ? order.modifiedDate : null,
  ];

  let best: number | null = null;
  for (const candidate of candidates) {
    const parsed = parseToastTimestamp(candidate);
    if (parsed === null) {
      continue;
    }
    if (best === null || parsed > best) {
      best = parsed;
    }
  }
  return best;
}

export function isOrderVoided(order: any): boolean {
  return Boolean(order?.voided);
}

export function isOrderDeleted(order: any): boolean {
  return Boolean(order?.deleted);
}

function normalizeItemFulfillmentStatus(value: unknown): ItemFulfillmentStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "NEW" || normalized === "HOLD" || normalized === "SENT" || normalized === "READY") {
    return normalized as ItemFulfillmentStatus;
  }
  return null;
}

function mergeFulfillmentStatuses(
  current: ItemFulfillmentStatus | null,
  next: ItemFulfillmentStatus | null
): ItemFulfillmentStatus | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  const currentRank = ITEM_STATUS_ORDER[current];
  const nextRank = ITEM_STATUS_ORDER[next];
  return nextRank >= currentRank ? next : current;
}

function normalizeGuestFulfillmentStatus(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidates = [
    (value as any)?.status,
    (value as any)?.currentStatus,
    (value as any)?.value,
    (value as any)?.state,
    (value as any)?.fulfillmentStatus,
    (value as any)?.newStatus,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

function extractGuestOrderFulfillmentStatus(order: any, check: any): string | null {
  const directCandidates: unknown[] = [];
  const push = (value: unknown) => {
    if (value !== undefined && value !== null) {
      directCandidates.push(value);
    }
  };

  push(check?.guestOrderFulfillmentStatus);
  push(check?.guestOrderFulfillmentStatus?.status);
  push(check?.guestFulfillmentStatus);
  push(check?.guestFulfillmentStatus?.status);
  push(check?.fulfillmentStatusWebhook);
  push(check?.fulfillmentStatusWebhook?.status);
  push(order?.guestOrderFulfillmentStatus);
  push(order?.guestOrderFulfillmentStatus?.status);
  push(order?.guestFulfillmentStatus);
  push(order?.guestFulfillmentStatus?.status);
  push(order?.context?.guestOrderFulfillmentStatus);
  push(order?.context?.guestOrderFulfillmentStatus?.status);
  push(order?.context?.guestFulfillmentStatus);
  push(order?.context?.guestFulfillmentStatus?.status);

  for (const candidate of directCandidates) {
    const normalized = normalizeGuestFulfillmentStatus(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const historySources: unknown[] = [
    check?.guestOrderFulfillmentStatusHistory,
    check?.guestFulfillmentStatusHistory,
    check?.fulfillmentStatusHistory,
    order?.guestOrderFulfillmentStatusHistory,
    order?.guestFulfillmentStatusHistory,
    order?.fulfillmentStatusHistory,
    order?.context?.guestOrderFulfillmentStatusHistory,
    order?.context?.guestFulfillmentStatusHistory,
    order?.context?.fulfillmentStatusHistory,
  ];

  for (const source of historySources) {
    if (!Array.isArray(source)) {
      continue;
    }
    for (let i = source.length - 1; i >= 0; i -= 1) {
      const entry = source[i];
      const normalized = normalizeGuestFulfillmentStatus(entry);
      if (normalized) {
        return normalized;
      }
      if (entry && typeof entry === "object") {
        const nested = normalizeGuestFulfillmentStatus((entry as any)?.payload);
        if (nested) {
          return nested;
        }
      }
    }
  }

  return null;
}

function extractOrderFulfillmentStatus(order: any, check: any): ItemFulfillmentStatus | null {
  const candidates: unknown[] = [
    check?.fulfillmentStatus,
    check?.fulfillment?.status,
    order?.fulfillmentStatus,
    order?.fulfillment?.status,
    order?.context?.fulfillmentStatus,
    order?.context?.fulfillment?.status,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeItemFulfillmentStatus(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function isSelectionVoided(selection: any): boolean {
  return Boolean(selection?.voided);
}
