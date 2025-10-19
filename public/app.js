// src/ui/index.tsx
import React6 from "react";
import { createRoot } from "react-dom/client";

// src/ui/OrdersAllDayView.tsx
import { useCallback, useEffect, useMemo, useState } from "react";

// src/ui/components/OrdersFilterBar.tsx
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var OrdersFilterBarComponent = ({
  filters,
  activeFilter,
  onFilterChange,
  statusMessage
}) => {
  return /* @__PURE__ */ jsxs("div", { className: "mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: [
    /* @__PURE__ */ jsx("div", { className: "flex items-center gap-2", children: filters.map((option) => /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        onClick: () => onFilterChange(option.id),
        className: classNames(
          "rounded-full border px-4 py-1 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
          activeFilter === option.id ? "border-emerald-500 bg-emerald-500/20 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
        ),
        children: option.label
      },
      option.id
    )) }),
    /* @__PURE__ */ jsx("div", { className: "text-xs text-slate-500", children: statusMessage })
  ] });
};
var OrdersFilterBar = memo(OrdersFilterBarComponent);
OrdersFilterBar.displayName = "OrdersFilterBar";

// src/ui/components/OrdersGrid.tsx
import { memo as memo2 } from "react";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var GridSkeleton = () => {
  return /* @__PURE__ */ jsx2("div", { className: "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3", children: Array.from({ length: 6 }).map((_, index) => /* @__PURE__ */ jsxs2(
    "div",
    {
      className: "h-56 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60",
      children: [
        /* @__PURE__ */ jsx2("div", { className: "h-16 border-b border-slate-800 bg-slate-900/80" }),
        /* @__PURE__ */ jsxs2("div", { className: "space-y-3 p-4", children: [
          /* @__PURE__ */ jsx2("div", { className: "h-4 rounded bg-slate-800" }),
          /* @__PURE__ */ jsx2("div", { className: "h-4 w-1/2 rounded bg-slate-800" }),
          /* @__PURE__ */ jsx2("div", { className: "h-3 w-2/3 rounded bg-slate-800" })
        ] })
      ]
    },
    index
  )) });
};
var OrderCard = ({ order, now }) => {
  const { raw, placedAt, dueAt, combinedItems } = order;
  const { orderData } = raw;
  const customerName = orderData.customerName?.trim() || "Guest";
  const orderNumber = orderData.orderNumber ? `#${orderData.orderNumber}` : "";
  const elapsed = now.getTime() - placedAt.getTime();
  const urgencyClasses = getUrgencyClasses(dueAt, now);
  const diningLabel = formatDiningOption(orderData.orderType ?? orderData.orderTypeNormalized ?? "UNKNOWN");
  return /* @__PURE__ */ jsxs2(
    "article",
    {
      className: classNames(
        "flex h-full flex-col overflow-hidden rounded-2xl border bg-slate-900/70 shadow-xl",
        urgencyClasses,
        "border"
      ),
      children: [
        /* @__PURE__ */ jsx2("div", { className: "border-b border-slate-800 bg-slate-900/90 px-4 py-3", children: /* @__PURE__ */ jsx2("div", { className: "flex flex-wrap items-center justify-between gap-3", children: /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsxs2("div", { className: "flex flex-wrap items-center gap-2 text-sm text-slate-300", children: [
            /* @__PURE__ */ jsx2("span", { className: "text-base font-semibold text-white", children: customerName }),
            orderNumber && /* @__PURE__ */ jsx2("span", { className: "rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-200", children: orderNumber }),
            /* @__PURE__ */ jsx2("span", { className: "rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-200", children: diningLabel }),
            orderData.fulfillmentStatus && /* @__PURE__ */ jsx2(
              "span",
              {
                className: classNames(
                  "rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                  getStatusChipClasses(orderData.fulfillmentStatus)
                ),
                children: orderData.fulfillmentStatus.replace(/_/g, " ")
              }
            )
          ] }),
          /* @__PURE__ */ jsxs2("div", { className: "mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400", children: [
            /* @__PURE__ */ jsxs2("span", { children: [
              "Placed ",
              formatLocalTime(placedAt)
            ] }),
            dueAt && /* @__PURE__ */ jsxs2("span", { children: [
              "Due ",
              formatLocalTime(dueAt)
            ] }),
            /* @__PURE__ */ jsxs2("span", { className: "font-mono text-emerald-300", children: [
              "\u23F1 ",
              formatDuration(elapsed),
              " ago"
            ] })
          ] })
        ] }) }) }),
        /* @__PURE__ */ jsx2("div", { className: "flex-1 space-y-4 px-4 py-4", children: combinedItems.map((item) => /* @__PURE__ */ jsxs2(
          "div",
          {
            className: "rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 shadow-sm",
            children: [
              /* @__PURE__ */ jsxs2("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [
                /* @__PURE__ */ jsx2("div", { className: "text-sm font-medium text-white", children: item.itemName }),
                /* @__PURE__ */ jsxs2("div", { className: "flex items-center gap-2", children: [
                  /* @__PURE__ */ jsxs2("span", { className: "rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs font-semibold text-emerald-200", children: [
                    "\xD7",
                    item.totalQuantity
                  ] }),
                  /* @__PURE__ */ jsx2(
                    "span",
                    {
                      className: classNames(
                        "rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                        getStatusChipClasses(item.statusSummary)
                      ),
                      children: item.statusSummary.replace(/_/g, " ")
                    }
                  )
                ] })
              ] }),
              item.modifiers.length > 0 && /* @__PURE__ */ jsx2("ul", { className: "mt-3 space-y-2", children: item.modifiers.map((modifier) => /* @__PURE__ */ jsxs2(
                "li",
                {
                  className: "flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2",
                  children: [
                    /* @__PURE__ */ jsxs2("div", { className: "text-xs font-medium text-slate-200", children: [
                      modifier.name,
                      modifier.groupName && /* @__PURE__ */ jsx2("span", { className: "ml-2 text-[10px] uppercase tracking-wide text-slate-500", children: modifier.groupName })
                    ] }),
                    /* @__PURE__ */ jsxs2("span", { className: "rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-900", children: [
                      "\xD7",
                      modifier.quantity
                    ] })
                  ]
                },
                modifier.key
              )) })
            ]
          },
          item.key
        )) })
      ]
    }
  );
};
var OrdersGridComponent = ({
  showLoading,
  showEmptyState,
  error,
  enrichedOrders,
  now,
  onRetry
}) => {
  return /* @__PURE__ */ jsxs2(Fragment, { children: [
    error && /* @__PURE__ */ jsxs2("div", { className: "mb-4 flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200", children: [
      /* @__PURE__ */ jsx2("span", { children: error }),
      /* @__PURE__ */ jsx2(
        "button",
        {
          type: "button",
          onClick: onRetry,
          className: "rounded-full border border-red-400 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-100 transition hover:border-red-200 hover:text-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400",
          children: "Retry"
        }
      )
    ] }),
    showLoading ? /* @__PURE__ */ jsx2(GridSkeleton, {}) : showEmptyState ? /* @__PURE__ */ jsxs2("div", { className: "mt-24 flex flex-col items-center justify-center gap-3 text-center", children: [
      /* @__PURE__ */ jsx2("div", { className: "rounded-full border border-slate-800 bg-slate-900 p-6 text-4xl", children: "\u{1F369}" }),
      /* @__PURE__ */ jsx2("h3", { className: "text-xl font-semibold text-white", children: "No orders to display" }),
      /* @__PURE__ */ jsx2("p", { className: "max-w-sm text-sm text-slate-400", children: "Adjust the filters or check back shortly for new activity." })
    ] }) : /* @__PURE__ */ jsx2("div", { className: "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3", children: enrichedOrders.map((order) => /* @__PURE__ */ jsx2(OrderCard, { order, now }, order.raw.orderData.orderId)) })
  ] });
};
var OrdersGrid = memo2(OrdersGridComponent);
OrdersGrid.displayName = "OrdersGrid";

// src/ui/components/OrdersHeader.tsx
import { memo as memo3 } from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var SettingsIcon = ({ className }) => /* @__PURE__ */ jsxs3(
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    children: [
      /* @__PURE__ */ jsx3("path", { d: "M12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" }),
      /* @__PURE__ */ jsx3("path", { d: "M19.5 12a7.5 7.5 0 0 0-.08-1.08l2.12-1.65-2-3.46-2.58 1a7.52 7.52 0 0 0-1.87-1.08l-.39-2.74h-4l-.39 2.74a7.52 7.52 0 0 0-1.87-1.08l-2.58-1-2 3.46 2.12 1.65A7.5 7.5 0 0 0 4.5 12c0 .36.03.72.08 1.08l-2.12 1.65 2 3.46 2.58-1a7.52 7.52 0 0 0 1.87-1.08l.39 2.74h4l.39-2.74a7.52 7.52 0 0 0 1.87-1.08l2.58 1 2-3.46-2.12-1.65c.05-.36.08-.72.08-1.08Z" })
    ]
  }
);
var RailToggleIcon = ({ open, className }) => /* @__PURE__ */ jsx3(
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    children: open ? /* @__PURE__ */ jsx3("path", { d: "m6 18 6-6-6-6m12 12-6-6 6-6" }) : /* @__PURE__ */ jsx3("path", { d: "m9 6 6 6-6 6" })
  }
);
var OrdersHeaderComponent = ({
  currentTimeLabel,
  openOrderCount,
  lastUpdatedLabel,
  error,
  isRailOpen,
  onToggleRail
}) => {
  return /* @__PURE__ */ jsx3("header", { className: "fixed inset-x-0 top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur", children: /* @__PURE__ */ jsxs3("div", { className: "mx-auto flex h-16 max-w-7xl items-center gap-4 px-4", children: [
    /* @__PURE__ */ jsxs3("div", { className: "flex items-center gap-3", children: [
      /* @__PURE__ */ jsx3(
        "button",
        {
          type: "button",
          className: "inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-300 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 md:hidden",
          onClick: onToggleRail,
          "aria-label": isRailOpen ? "Hide modifiers" : "Show modifiers",
          children: /* @__PURE__ */ jsx3(RailToggleIcon, { open: isRailOpen, className: "h-5 w-5" })
        }
      ),
      /* @__PURE__ */ jsx3("div", { className: "text-lg font-semibold text-white", children: "Orders \u2013 All Day View" })
    ] }),
    /* @__PURE__ */ jsxs3("div", { className: "flex flex-1 items-center gap-4 text-sm text-slate-300", children: [
      /* @__PURE__ */ jsx3("span", { className: "hidden text-slate-400 sm:inline", children: "Local time" }),
      /* @__PURE__ */ jsx3("span", { className: "font-mono text-white", children: currentTimeLabel }),
      /* @__PURE__ */ jsx3("span", { className: "hidden text-slate-500 md:inline", children: "|" }),
      /* @__PURE__ */ jsxs3("span", { className: "font-medium text-emerald-300", children: [
        "Open Orders: ",
        /* @__PURE__ */ jsx3("span", { className: "font-semibold text-white", children: openOrderCount })
      ] }),
      lastUpdatedLabel && /* @__PURE__ */ jsx3("span", { className: "hidden text-xs text-slate-400 sm:inline", children: lastUpdatedLabel }),
      error && /* @__PURE__ */ jsx3("span", { className: "rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-300", children: error })
    ] }),
    /* @__PURE__ */ jsx3(
      "button",
      {
        type: "button",
        className: "relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
        onClick: () => console.info("Settings clicked"),
        "aria-label": "Settings",
        children: /* @__PURE__ */ jsx3(SettingsIcon, { className: "h-5 w-5" })
      }
    )
  ] }) });
};
var OrdersHeader = memo3(OrdersHeaderComponent);
OrdersHeader.displayName = "OrdersHeader";

// src/ui/components/ModifiersRail.tsx
import { memo as memo4 } from "react";
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var RailSkeleton = () => {
  return /* @__PURE__ */ jsx4("ul", { className: "space-y-3", children: Array.from({ length: 6 }).map((_, index) => /* @__PURE__ */ jsxs4(
    "li",
    {
      className: "flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3",
      children: [
        /* @__PURE__ */ jsx4("div", { className: "h-4 w-24 animate-pulse rounded bg-slate-800" }),
        /* @__PURE__ */ jsx4("div", { className: "h-8 w-8 animate-pulse rounded-full bg-slate-800" })
      ]
    },
    index
  )) });
};
var ModifiersRailComponent = ({
  modifierAggregations,
  showLoading,
  isOpen
}) => {
  return /* @__PURE__ */ jsx4(
    "aside",
    {
      className: classNames(
        "fixed bottom-0 left-0 top-16 z-20 w-72 border-r border-slate-800 bg-slate-950/95 backdrop-blur transition-transform duration-200 ease-out",
        isOpen ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0"
      ),
      children: /* @__PURE__ */ jsxs4("div", { className: "flex h-full flex-col", children: [
        /* @__PURE__ */ jsxs4("div", { className: "border-b border-slate-800 px-4 py-3", children: [
          /* @__PURE__ */ jsx4("h2", { className: "text-sm font-semibold uppercase tracking-wide text-slate-400", children: "Modifiers" }),
          /* @__PURE__ */ jsx4("p", { className: "text-xs text-slate-500", children: "Aggregated across visible orders" })
        ] }),
        /* @__PURE__ */ jsx4("div", { className: "flex-1 overflow-y-auto px-3 py-4", children: showLoading ? /* @__PURE__ */ jsx4(RailSkeleton, {}) : modifierAggregations.length ? /* @__PURE__ */ jsx4("ul", { className: "space-y-2", children: modifierAggregations.map((modifier) => /* @__PURE__ */ jsxs4(
          "li",
          {
            className: "flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 shadow-sm",
            children: [
              /* @__PURE__ */ jsxs4("div", { children: [
                /* @__PURE__ */ jsx4("p", { className: "text-sm font-medium text-white", children: modifier.name }),
                modifier.groupName && /* @__PURE__ */ jsx4("p", { className: "text-xs text-slate-500", children: modifier.groupName })
              ] }),
              /* @__PURE__ */ jsx4("span", { className: "flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400 text-sm font-semibold text-slate-900 shadow", children: modifier.count })
            ]
          },
          modifier.key
        )) }) : /* @__PURE__ */ jsx4("div", { className: "rounded-lg border border-dashed border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-500", children: "No modifiers in view" }) })
      ] })
    }
  );
};
var ModifiersRail = memo4(ModifiersRailComponent);
ModifiersRail.displayName = "ModifiersRail";

// src/ui/OrdersAllDayView.tsx
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
var ORDERS_ENDPOINT = "https://example.com/api/orders-detailed";
var POLL_INTERVAL_MS = 1e4;
var CLOSED_FULFILLMENT_STATUSES = /* @__PURE__ */ new Set([
  "COMPLETED",
  "DELIVERED",
  "PICKED_UP",
  "CANCELLED"
]);
var CLOSED_DELIVERY_STATES = /* @__PURE__ */ new Set(["DELIVERED"]);
var FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "ready", label: "Ready" },
  { id: "delivery", label: "Delivery" }
];
function parseToast(timestamp) {
  if (!timestamp) {
    return /* @__PURE__ */ new Date();
  }
  const normalized = timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return new Date(normalized);
}
function formatLocalTime(date) {
  return new Intl.DateTimeFormat(void 0, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1e3));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}
function hashModifier(modifier) {
  if (modifier.id) {
    return modifier.id;
  }
  const name = modifier.name ?? "";
  const group = modifier.groupName ?? "";
  return `${name}|${group}`;
}
function hashItem(item) {
  const modifiers = (item.modifiers ?? []).map((modifier) => `${hashModifier(modifier)}:${modifier.quantity ?? 1}`).sort().join(";");
  return `${item.menuItemId}|${modifiers}`;
}
function isOpenOrder(order) {
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
function matchesFilter(order, filter) {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return isOpenOrder(order);
    case "ready":
      return order.orderData.fulfillmentStatus === "READY_FOR_PICKUP";
    case "delivery":
      return (order.orderData.orderTypeNormalized ?? order.orderData.orderType) === "DELIVERY" || order.orderData.deliveryState === "IN_PROGRESS" || order.orderData.deliveryState === "PICKED_UP";
    default:
      return true;
  }
}
function combineOrderItems(items) {
  const map = /* @__PURE__ */ new Map();
  items.forEach((item) => {
    const key = hashItem(item);
    const itemQuantity = item.quantity ?? 1;
    const modifiers = item.modifiers ?? [];
    const existing = map.get(key);
    if (existing) {
      existing.totalQuantity += itemQuantity;
      const modifierMap = new Map(existing.modifiers.map((m) => [m.key, m]));
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
            quantity: modifierQuantity
          });
        }
      });
      existing.modifiers = Array.from(modifierMap.values()).sort(
        (a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base" })
      );
      existing.statusSummary = summarizeItemStatuses(existing.statusSummary, item.fulfillmentStatus);
    } else {
      const modifierSummaries = [];
      const modifierMap = /* @__PURE__ */ new Map();
      modifiers.forEach((modifier) => {
        const modifierKey = hashModifier(modifier);
        const modifierQuantity = (modifier.quantity ?? 1) * itemQuantity;
        modifierMap.set(modifierKey, {
          key: modifierKey,
          name: modifier.name,
          groupName: modifier.groupName,
          quantity: modifierQuantity
        });
      });
      modifierMap.forEach((value) => modifierSummaries.push(value));
      modifierSummaries.sort((a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base" }));
      map.set(key, {
        key,
        itemName: item.itemName,
        menuItemId: item.menuItemId,
        totalQuantity: itemQuantity,
        modifiers: modifierSummaries,
        statusSummary: summarizeItemStatuses(void 0, item.fulfillmentStatus)
      });
    }
  });
  return Array.from(map.values());
}
function summarizeItemStatuses(currentSummary, nextStatus) {
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
function aggregateModifiers(orders) {
  const counts = /* @__PURE__ */ new Map();
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
            count: quantity
          });
        }
      });
    });
  });
  return Array.from(counts.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.name.localeCompare(b.name, void 0, { sensitivity: "base" });
  }).slice(0, 50);
}
function classNames(...values) {
  return values.filter(Boolean).join(" ");
}
function getUrgencyClasses(dueAt, now) {
  if (!dueAt) {
    return "border-slate-800";
  }
  const diff = dueAt.getTime() - now.getTime();
  if (diff < 0) {
    return "border-red-500";
  }
  if (diff <= 5 * 60 * 1e3) {
    return "border-amber-400";
  }
  return "border-slate-800";
}
function getStatusChipClasses(status) {
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
var OrdersAllDayView = () => {
  const [orders, setOrders] = useState([]);
  const [isFetching, setIsFetching] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filter, setFilter] = useState("open");
  const [now, setNow] = useState(() => /* @__PURE__ */ new Date());
  const [isRailOpen, setIsRailOpen] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(/* @__PURE__ */ new Date());
    }, 1e3);
    return () => clearInterval(timer);
  }, []);
  const fetchOrders = useCallback(async () => {
    setIsFetching(true);
    try {
      const response = await fetch(ORDERS_ENDPOINT, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      const payload = await response.json();
      setOrders(Array.isArray(payload.orders) ? payload.orders : []);
      setLastUpdated(/* @__PURE__ */ new Date());
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
  const enrichedOrders = useMemo(
    () => visibleOrders.map((order) => ({
      raw: order,
      placedAt: parseToast(order.orderData.orderTime),
      dueAt: order.orderData.timeDue ? parseToast(order.orderData.timeDue) : null,
      combinedItems: combineOrderItems(order.items)
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
    () => lastUpdated ? formatLocalTime(lastUpdated) : null,
    [lastUpdated]
  );
  const filterStatusMessage = useMemo(() => {
    if (isFetching) {
      return "Refreshing\u2026";
    }
    if (lastUpdated) {
      return `Last updated ${formatLocalTime(lastUpdated)}`;
    }
    return "Awaiting data";
  }, [isFetching, lastUpdated]);
  return /* @__PURE__ */ jsxs5("div", { className: "min-h-screen bg-slate-950 text-slate-100", children: [
    /* @__PURE__ */ jsx5(
      OrdersHeader,
      {
        currentTimeLabel,
        error,
        isRailOpen,
        lastUpdatedLabel,
        onToggleRail: handleToggleRail,
        openOrderCount
      }
    ),
    /* @__PURE__ */ jsx5(
      ModifiersRail,
      {
        isOpen: isRailOpen,
        modifierAggregations,
        showLoading
      }
    ),
    /* @__PURE__ */ jsxs5(
      "main",
      {
        className: classNames(
          "relative z-10 min-h-screen pt-20 transition-all",
          "px-4 pb-10 sm:px-6 lg:px-10",
          "md:pl-80"
        ),
        children: [
          /* @__PURE__ */ jsx5(
            OrdersFilterBar,
            {
              activeFilter: filter,
              filters: FILTERS,
              onFilterChange: setFilter,
              statusMessage: filterStatusMessage
            }
          ),
          /* @__PURE__ */ jsx5(
            OrdersGrid,
            {
              enrichedOrders,
              error,
              now,
              onRetry: fetchOrders,
              showEmptyState,
              showLoading
            }
          )
        ]
      }
    )
  ] });
};
function formatDiningOption(option) {
  if (!option) {
    return "Unknown";
  }
  if (/[a-z]/.test(option)) {
    return option;
  }
  return option.split("_").map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase()).join(" ");
}
var OrdersAllDayView_default = OrdersAllDayView;

// src/ui/index.tsx
import { jsx as jsx6 } from "react/jsx-runtime";
var container = document.getElementById("app");
if (container) {
  const root = createRoot(container);
  root.render(
    /* @__PURE__ */ jsx6(React6.StrictMode, { children: /* @__PURE__ */ jsx6(OrdersAllDayView_default, {}) })
  );
}
//# sourceMappingURL=app.js.map
