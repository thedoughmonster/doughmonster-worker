import React, { memo } from "react";
import type { OrderStatus } from "../OrdersAllDayView";
import { classNames } from "../OrdersAllDayView";

interface FilterOption {
  id: OrderStatus;
  label: string;
}

interface OrdersFilterBarProps {
  filters: FilterOption[];
  activeFilter: OrderStatus;
  onFilterChange: (status: OrderStatus) => void;
  statusMessage: string;
}

const OrdersFilterBarComponent: React.FC<OrdersFilterBarProps> = ({
  filters,
  activeFilter,
  onFilterChange,
  statusMessage,
}) => {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        {filters.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onFilterChange(option.id)}
            className={classNames(
              "rounded-full border px-4 py-1 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
              activeFilter === option.id
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="text-xs text-slate-500">{statusMessage}</div>
    </div>
  );
};

export const OrdersFilterBar = memo(OrdersFilterBarComponent);

OrdersFilterBar.displayName = "OrdersFilterBar";
