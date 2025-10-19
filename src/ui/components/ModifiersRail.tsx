import React, { memo } from "react";
import { ModifierAggregateRow, classNames } from "../OrdersAllDayView";

interface ModifiersRailProps {
  modifierAggregations: ModifierAggregateRow[];
  showLoading: boolean;
  isOpen: boolean;
}

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

const ModifiersRailComponent: React.FC<ModifiersRailProps> = ({
  modifierAggregations,
  showLoading,
  isOpen,
}) => {
  return (
    <aside
      className={classNames(
        "fixed bottom-0 left-0 top-16 z-20 w-72 border-r border-slate-800 bg-slate-950/95 backdrop-blur transition-transform duration-200 ease-out",
        isOpen ? "translate-x-0" : "-translate-x-full",
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
                    {modifier.groupName && <p className="text-xs text-slate-500">{modifier.groupName}</p>}
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
  );
};

export const ModifiersRail = memo(ModifiersRailComponent);

ModifiersRail.displayName = "ModifiersRail";
