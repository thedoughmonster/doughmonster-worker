import React, { useCallback, useEffect, useMemo, useState } from "react";

export const ORDERS_ENDPOINT = "https://example.com/api/items-expanded";
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

type OrderStatus = "all" | "open" | "ready" | "delivery";

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

interface EnrichedOrder {
  raw: ToastOrder;
  placedAt: Date;
  dueAt: Date | null;
  combinedItems: CombinedItem[];
}

interface ModifierAggregateRow {
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

function classNames(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(" ");
}

function getUrgencyClasses(dueAt: Date | null, now: Date): string {
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

function getStatusChipClasses(status: FulfillmentStatus | string | undefined): string {
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

const SettingsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" />
    <path d="M19.5 12a7.5 7.5 0 0 0-.08-1.08l2.12-1.65-2-3.46-2.58 1a7.52 7.52 0 0 0-1.87-1.08l-.39-2.74h-4l-.39 2.74a7.52 7.52 0 0 0-1.87 1.08l-2.58-1-2 3.46 2.12 1.65A7.5 7.5 0 0 0 4.5 12c0 .36.03.72.08 1.08l-2.12 1.65 2 3.46 2.58-1a7.52 7.52 0 0 0 1.87 1.08l.39 2.74h4l.39-2.74a7.52 7.52 0 0 0 1.87-1.08l2.58 1 2-3.46-2.12-1.65c.05-.36.08-.72.08-1.08Z" />
  </svg>
);

const RailToggleIcon: React.FC<{ open: boolean; className?: string }> = ({ open, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {open ? (
      <path d="m6 18 6-6-6-6m12 12-6-6 6-6" />
    ) : (
      <path d="m9 6 6 6-6 6" />
    )}
  </svg>
);

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-300 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 md:hidden"
              onClick={() => setIsRailOpen((prev) => !prev)}
              aria-label={isRailOpen ? "Hide modifiers" : "Show modifiers"}
            >
              <RailToggleIcon open={isRailOpen} className="h-5 w-5" />
            </button>
            <div className="text-lg font-semibold text-white">Orders – All Day View</div>
          </div>

          <div className="flex flex-1 items-center gap-4 text-sm text-slate-300">
            <span className="hidden sm:inline text-slate-400">Local time</span>
            <span className="font-mono text-white">{formatLocalTime(now)}</span>
            <span className="hidden md:inline text-slate-500">|</span>
            <span className="font-medium text-emerald-300">
              Open Orders: <span className="font-semibold text-white">{openOrderCount}</span>
            </span>
            {lastUpdated && (
              <span className="hidden text-xs text-slate-400 sm:inline">
                Last updated {formatLocalTime(lastUpdated)}
              </span>
            )}
            {error && (
              <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-300">
                {error}
              </span>
            )}
          </div>

          <button
            type="button"
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            onClick={() => console.info("Settings clicked")}
            aria-label="Settings"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      <aside
        className={classNames(
          "fixed bottom-0 left-0 top-16 z-20 w-72 border-r border-slate-800 bg-slate-950/95 backdrop-blur transition-transform duration-200 ease-out",
          isRailOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Modifiers</h2>
            <p className="text-xs text-slate-500">Aggregated across visible orders</p>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            {showLoading ? (
              <RailSkeleton />
            ) : modifierAggregations.length ? (
              <ul className="space-y-2">
                {modifierAggregations.map((modifier) => (
                  <li
                    key={modifier.key}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 shadow-sm"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{modifier.name}</p>
                      {modifier.groupName && (
                        <p className="text-xs text-slate-500">{modifier.groupName}</p>
                      )}
                    </div>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400 text-sm font-semibold text-slate-900 shadow">
                      {modifier.count}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-500">
                No modifiers in view
              </div>
            )}
          </div>
        </div>
      </aside>

      <main
        className={classNames(
          "relative z-10 min-h-screen pt-20 transition-all",
          "px-4 pb-10 sm:px-6 lg:px-10",
          "md:pl-80"
        )}
      >
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={classNames(
                  "rounded-full border px-4 py-1 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                  filter === option.id
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500">
            {isFetching ? "Refreshing…" : lastUpdated ? `Last updated ${formatLocalTime(lastUpdated)}` : "Awaiting data"}
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span>{error}</span>
            <button
              type="button"
              onClick={fetchOrders}
              className="rounded-full border border-red-400 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-100 transition hover:border-red-200 hover:text-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              Retry
            </button>
          </div>
        )}

        {showLoading ? (
          <GridSkeleton />
        ) : showEmptyState ? (
          <div className="mt-24 flex flex-col items-center justify-center gap-3 text-center">
            <div className="rounded-full border border-slate-800 bg-slate-900 p-6 text-4xl">🍩</div>
            <h3 className="text-xl font-semibold text-white">No orders to display</h3>
            <p className="max-w-sm text-sm text-slate-400">
              Adjust the filters or check back shortly for new activity.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {enrichedOrders.map((order) => (
              <OrderCard key={order.raw.orderData.orderId} order={order} now={now} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

const OrderCard: React.FC<{ order: EnrichedOrder; now: Date }> = ({ order, now }) => {
  const { raw, placedAt, dueAt, combinedItems } = order;
  const { orderData } = raw;

  const customerName = orderData.customerName?.trim() || "Guest";
  const orderNumber = orderData.orderNumber ? `#${orderData.orderNumber}` : "";
  const elapsed = now.getTime() - placedAt.getTime();
  const urgencyClasses = getUrgencyClasses(dueAt, now);

  const diningLabel = formatDiningOption(orderData.orderType ?? orderData.orderTypeNormalized ?? "UNKNOWN");

  return (
    <article
      className={classNames(
        "flex h-full flex-col overflow-hidden rounded-2xl border bg-slate-900/70 shadow-xl",
        urgencyClasses,
        "border"
      )}
    >
      <div className="border-b border-slate-800 bg-slate-900/90 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <span className="text-base font-semibold text-white">{customerName}</span>
              {orderNumber && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-200">
                  {orderNumber}
                </span>
              )}
              <span
                className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-200"
              >
                {diningLabel}
              </span>
              {orderData.fulfillmentStatus && (
                <span
                  className={classNames(
                    "rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                    getStatusChipClasses(orderData.fulfillmentStatus)
                  )}
                >
                  {orderData.fulfillmentStatus.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span>Placed {formatLocalTime(placedAt)}</span>
              {dueAt && <span>Due {formatLocalTime(dueAt)}</span>}
              <span className="font-mono text-emerald-300">⏱ {formatDuration(elapsed)} ago</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 px-4 py-4">
        {combinedItems.map((item) => (
          <div
            key={item.key}
            className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium text-white">{item.itemName}</div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                  ×{item.totalQuantity}
                </span>
                <span
                  className={classNames(
                    "rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                    getStatusChipClasses(item.statusSummary)
                  )}
                >
                  {item.statusSummary.replace(/_/g, " ")}
                </span>
              </div>
            </div>
            {item.modifiers.length > 0 && (
              <ul className="mt-3 space-y-2">
                {item.modifiers.map((modifier) => (
                  <li
                    key={modifier.key}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2"
                  >
                    <div className="text-xs font-medium text-slate-200">
                      {modifier.name}
                      {modifier.groupName && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500">
                          {modifier.groupName}
                        </span>
                      )}
                    </div>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-900">
                      ×{modifier.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </article>
  );
};

function formatDiningOption(option: DiningOption): string {
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

const GridSkeleton: React.FC = () => {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="h-56 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60"
        >
          <div className="h-16 border-b border-slate-800 bg-slate-900/80" />
          <div className="space-y-3 p-4">
            <div className="h-4 rounded bg-slate-800" />
            <div className="h-4 w-1/2 rounded bg-slate-800" />
            <div className="h-3 w-2/3 rounded bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );
};

const RailSkeleton: React.FC = () => {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <li
          key={index}
          className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3"
        >
          <div className="h-4 w-24 animate-pulse rounded bg-slate-800" />
          <div className="h-8 w-8 animate-pulse rounded-full bg-slate-800" />
        </li>
      ))}
    </ul>
  );
};

export default OrdersAllDayView;
