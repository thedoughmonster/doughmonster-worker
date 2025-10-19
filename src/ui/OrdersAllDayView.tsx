import React, { useCallback, useEffect, useMemo, useState } from "react";
import { OrdersFilterBar } from "./components/OrdersFilterBar";
import { OrdersGrid } from "./components/OrdersGrid";
import { OrdersHeader } from "./components/OrdersHeader";
import { ModifiersRail } from "./components/ModifiersRail";

export const ORDERS_ENDPOINT = "https://example.com/api/orders-detailed";
export const POLL_INTERVAL_MS = 10_000;

type ToastTimestamp = string;

type NormalizedDiningOption =
  | "DINE_IN"
  | "TAKEOUT"
  | "DELIVERY"
  | "CURBSIDE"
  | "DRIVE_THRU"
  | "CATERING"
  | "UNKNOWN";

type DiningOption = NormalizedDiningOption | string;

type FulfillmentStatus =
  | "READY_FOR_PICKUP"
  | "IN_PREPARATION"
  | "READY"
  | "SENT"
  | "HOLD"
  | "NEW"
  | "PICKED_UP"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED"
  | null
  | string;

type DeliveryState = "PENDING" | "IN_PROGRESS" | "PICKED_UP" | "DELIVERED" | null | string;

export type OrderStatus = "all" | "open" | "ready" | "delivery";

interface ToastModifier {
  id?: string | null;
  name: string;
  groupName: string | null;
  priceCents?: number | null;
  quantity?: number | null;
}

interface ToastItem {
  lineItemId: string;
  menuItemId: string;
  itemName: string;
  quantity: number;
  fulfillmentStatus: FulfillmentStatus;
  modifiers?: ToastModifier[] | null;
}

interface ToastOrderData {
  orderId: string;
  location?: { locationId?: string | null } | null;
  orderTime: ToastTimestamp;
  timeDue: ToastTimestamp | null;
  orderNumber: string;
  checkId?: string;
  status?: string | null;
  fulfillmentStatus: FulfillmentStatus;
  customerName: string | null;
  orderType: DiningOption;
  orderTypeNormalized?: NormalizedDiningOption | null;
  diningOptionGuid?: string | null;
  promisedDate?: ToastTimestamp | null;
  estimatedFulfillmentDate?: ToastTimestamp | null;
  deliveryState: DeliveryState;
}

interface ToastOrder {
  orderData: ToastOrderData;
  items: ToastItem[];
  totals?: unknown;
}

interface ItemsExpandedResponse {
  orders: ToastOrder[];
}

interface CombinedModifierSummary {
  key: string;
  name: string;
  groupName: string | null;
  quantity: number;
}

interface CombinedItem {
  key: string;
  itemName: string;
  menuItemId: string;
  totalQuantity: number;
  modifiers: CombinedModifierSummary[];
  statusSummary: string;
}

export interface EnrichedOrder {
  raw: ToastOrder;
  placedAt: Date;
  dueAt: Date | null;
  combinedItems: CombinedItem[];
}

export interface ModifierAggregateRow {
  key: string;
  name: string;
  count: number;
  groupName: string | null;
}

const CLOSED_FULFILLMENT_STATUSES = new Set([
  "COMPLETED",
  "DELIVERED",
  "PICKED_UP",
  "CANCELLED",
]);

const CLOSED_DELIVERY_STATES = new Set(["DELIVERED"]);

const FILTERS: { id: OrderStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "ready", label: "Ready" },
  { id: "delivery", label: "Delivery" },
];

export function parseToast(timestamp: ToastTimestamp): Date {
  if (!timestamp) {
    return new Date();
  }

  const normalized = timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return new Date(normalized);
}

export function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function hashModifier(modifier: ToastModifier): string {
  if (modifier.id) {
    return modifier.id;
  }
  const name = modifier.name ?? "";
  const group = modifier.groupName ?? "";
  return `${name}|${group}`;
}

export function hashItem(item: ToastItem): string {
  const modifiers = (item.modifiers ?? [])
    .map((modifier) => `${hashModifier(modifier)}:${modifier.quantity ?? 1}`)
    .sort()
    .join(";");

  return `${item.menuItemId}|${modifiers}`;
}

function isOpenOrder(order: ToastOrder): boolean {
  const fulfillmentStatus = order.orderData.fulfillmentStatus;
  const deliveryState = order.orderData.deliveryState;

  if (deliveryState && CLOSED_DELIVERY_STATES.has(deliveryState)) {
    return false;
  }

  if (!fulfillmentStatus) {
    return true;
  }

  return !CLOSED_FULFILLMENT_STATUSES.has(fulfillmentStatus);
}

function matchesFilter(order: ToastOrder, filter: OrderStatus): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return isOpenOrder(order);
    case "ready":
      return order.orderData.fulfillmentStatus === "READY_FOR_PICKUP";
    case "delivery":
      return (
        (order.orderData.orderTypeNormalized ?? order.orderData.orderType) === "DELIVERY" ||
        order.orderData.deliveryState === "IN_PROGRESS" ||
        order.orderData.deliveryState === "PICKED_UP"
      );
    default:
      return true;
  }
}

function combineOrderItems(items: ToastItem[]): CombinedItem[] {
  const map = new Map<string, CombinedItem>();

  items.forEach((item) => {
    const key = hashItem(item);
    const itemQuantity = item.quantity ?? 1;
    const modifiers = item.modifiers ?? [];

    const existing = map.get(key);
    if (existing) {
      existing.totalQuantity += itemQuantity;

      const modifierMap = new Map(existing.modifiers.map((m) => [m.key, m] as const));
      modifiers.forEach((modifier) => {
        const modifierKey = hashModifier(modifier);
        const modifierQuantity = (modifier.quantity ?? 1) * itemQuantity;
        const current = modifierMap.get(modifierKey);
        if (current) {
          current.quantity += modifierQuantity;
        } else {
          modifierMap.set(modifierKey, {
            key: modifierKey,
            name: modifier.name,
            groupName: modifier.groupName,
            quantity: modifierQuantity,
          });
        }
      });
      existing.modifiers = Array.from(modifierMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

      existing.statusSummary = summarizeItemStatuses(existing.statusSummary, item.fulfillmentStatus);
    } else {
      const modifierSummaries: CombinedModifierSummary[] = [];
      const modifierMap = new Map<string, CombinedModifierSummary>();
      modifiers.forEach((modifier) => {
        const modifierKey = hashModifier(modifier);
        const modifierQuantity = (modifier.quantity ?? 1) * itemQuantity;
        modifierMap.set(modifierKey, {
          key: modifierKey,
          name: modifier.name,
          groupName: modifier.groupName,
          quantity: modifierQuantity,
        });
      });
      modifierMap.forEach((value) => modifierSummaries.push(value));
      modifierSummaries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

      map.set(key, {
        key,
        itemName: item.itemName,
        menuItemId: item.menuItemId,
        totalQuantity: itemQuantity,
        modifiers: modifierSummaries,
        statusSummary: summarizeItemStatuses(undefined, item.fulfillmentStatus),
      });
    }
  });

  return Array.from(map.values());
}

function summarizeItemStatuses(
  currentSummary: string | undefined,
  nextStatus: FulfillmentStatus
): string {
  const normalizedStatus = nextStatus ?? "Unknown";

  if (!currentSummary || currentSummary === normalizedStatus) {
    return normalizedStatus;
  }

  if (currentSummary.includes("Mixed")) {
    return currentSummary;
  }

  if (currentSummary !== normalizedStatus) {
    return "Mixed";
  }

  return currentSummary;
}

function aggregateModifiers(orders: ToastOrder[]): ModifierAggregateRow[] {
  const counts = new Map<string, ModifierAggregateRow>();

  orders.forEach((order) => {
    order.items.forEach((item) => {
      (item.modifiers ?? []).forEach((modifier) => {
        const key = hashModifier(modifier);
        const quantity = (modifier.quantity ?? 1) * (item.quantity ?? 1);
        const existing = counts.get(key);
        if (existing) {
          existing.count += quantity;
        } else {
          counts.set(key, {
            key,
            name: modifier.name,
            groupName: modifier.groupName,
            count: quantity,
          });
        }
      });
    });
  });

  return Array.from(counts.values())
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
    .slice(0, 50);
}

export function classNames(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(" ");
}

export function getUrgencyClasses(dueAt: Date | null, now: Date): string {
  if (!dueAt) {
    return "border-slate-800";
  }

  const diff = dueAt.getTime() - now.getTime();

  if (diff < 0) {
    return "border-red-500";
  }

  if (diff <= 5 * 60 * 1000) {
    return "border-amber-400";
  }

  return "border-slate-800";
}

export function getStatusChipClasses(status: FulfillmentStatus | string | undefined): string {
  switch (status) {
    case "READY":
    case "READY_FOR_PICKUP":
      return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
    case "IN_PREPARATION":
    case "SENT":
      return "bg-amber-500/20 text-amber-300 border border-amber-500/40";
    case "HOLD":
      return "bg-amber-700/30 text-amber-200 border border-amber-500/40";
    case "NEW":
      return "bg-slate-700 text-slate-200 border border-slate-500";
    case "Mixed":
      return "bg-fuchsia-700/30 text-fuchsia-200 border border-fuchsia-400/50";
    default:
      return "bg-slate-700 text-slate-200 border border-slate-600";
  }
}

export const OrdersAllDayView: React.FC = () => {
  const [orders, setOrders] = useState<ToastOrder[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<OrderStatus>("open");
  const [now, setNow] = useState<Date>(() => new Date());
  const [isRailOpen, setIsRailOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchOrders = useCallback(async () => {
    setIsFetching(true);
    try {
      const response = await fetch(ORDERS_ENDPOINT, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const payload = (await response.json()) as ItemsExpandedResponse;
      setOrders(Array.isArray(payload.orders) ? payload.orders : []);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setIsFetching(false);
      setInitialLoadComplete(true);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      const dueA = a.orderData.timeDue ? parseToast(a.orderData.timeDue) : null;
      const dueB = b.orderData.timeDue ? parseToast(b.orderData.timeDue) : null;

      if (dueA && dueB) {
        const diff = dueA.getTime() - dueB.getTime();
        if (diff !== 0) {
          return diff;
        }
      } else if (dueA && !dueB) {
        return -1;
      } else if (!dueA && dueB) {
        return 1;
      }

      const placedA = parseToast(a.orderData.orderTime).getTime();
      const placedB = parseToast(b.orderData.orderTime).getTime();
      if (placedA !== placedB) {
        return placedA - placedB;
      }

      const orderNumberA = Number.parseInt(a.orderData.orderNumber, 10);
      const orderNumberB = Number.parseInt(b.orderData.orderNumber, 10);

      if (!Number.isNaN(orderNumberA) && !Number.isNaN(orderNumberB)) {
        return orderNumberA - orderNumberB;
      }

      return a.orderData.orderNumber.localeCompare(b.orderData.orderNumber);
    });
  }, [orders]);

  const visibleOrders = useMemo(
    () => sortedOrders.filter((order) => matchesFilter(order, filter)),
    [sortedOrders, filter]
  );

  const openOrderCount = useMemo(
    () => sortedOrders.filter((order) => isOpenOrder(order)).length,
    [sortedOrders]
  );

  const modifierAggregations = useMemo(
    () => aggregateModifiers(visibleOrders),
    [visibleOrders]
  );

  const enrichedOrders = useMemo<EnrichedOrder[]>(
    () =>
      visibleOrders.map((order) => ({
        raw: order,
        placedAt: parseToast(order.orderData.orderTime),
        dueAt: order.orderData.timeDue ? parseToast(order.orderData.timeDue) : null,
        combinedItems: combineOrderItems(order.items),
      })),
    [visibleOrders]
  );

  const showLoading = !initialLoadComplete;
  const showEmptyState = initialLoadComplete && !visibleOrders.length && !isFetching && !error;

  const handleToggleRail = useCallback(() => {
    setIsRailOpen((prev) => !prev);
  }, []);

  const currentTimeLabel = useMemo(() => formatLocalTime(now), [now]);
  const lastUpdatedLabel = useMemo(
    () => (lastUpdated ? formatLocalTime(lastUpdated) : null),
    [lastUpdated]
  );

  const filterStatusMessage = useMemo(() => {
    if (isFetching) {
      return "Refreshing…";
    }
    if (lastUpdated) {
      return `Last updated ${formatLocalTime(lastUpdated)}`;
    }
    return "Awaiting data";
  }, [isFetching, lastUpdated]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <OrdersHeader
        currentTimeLabel={currentTimeLabel}
        error={error}
        isRailOpen={isRailOpen}
        lastUpdatedLabel={lastUpdatedLabel}
        onToggleRail={handleToggleRail}
        openOrderCount={openOrderCount}
      />

      <ModifiersRail
        isOpen={isRailOpen}
        modifierAggregations={modifierAggregations}
        showLoading={showLoading}
      />

      <main
        className={classNames(
          "relative z-10 min-h-screen pt-20 transition-all",
          "px-4 pb-10 sm:px-6 lg:px-10",
          "md:pl-80"
        )}
      >
        <OrdersFilterBar
          activeFilter={filter}
          filters={FILTERS}
          onFilterChange={setFilter}
          statusMessage={filterStatusMessage}
        />

        <OrdersGrid
          enrichedOrders={enrichedOrders}
          error={error}
          now={now}
          onRetry={fetchOrders}
          showEmptyState={showEmptyState}
          showLoading={showLoading}
        />
      </main>
    </div>
  );
};

export function formatDiningOption(option: DiningOption): string {
  if (!option) {
    return "Unknown";
  }
  if (/[a-z]/.test(option)) {
    return option;
  }
  return option
    .split("_")
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(" ");
}

export default OrdersAllDayView;
