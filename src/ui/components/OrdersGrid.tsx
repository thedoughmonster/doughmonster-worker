import React, { memo } from "react";
import type { EnrichedOrder } from "../OrdersAllDayView";
import {
  classNames,
  formatDiningOption,
  formatDuration,
  formatLocalTime,
  getStatusChipClasses,
  getUrgencyClasses,
} from "../OrdersAllDayView";

interface OrdersGridProps {
  showLoading: boolean;
  showEmptyState: boolean;
  error: string | null;
  enrichedOrders: EnrichedOrder[];
  now: Date;
  onRetry: () => void;
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
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-200">
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

const OrdersGridComponent: React.FC<OrdersGridProps> = ({
  showLoading,
  showEmptyState,
  error,
  enrichedOrders,
  now,
  onRetry,
}) => {
  return (
    <>
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
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
    </>
  );
};

export const OrdersGrid = memo(OrdersGridComponent);

OrdersGrid.displayName = "OrdersGrid";
