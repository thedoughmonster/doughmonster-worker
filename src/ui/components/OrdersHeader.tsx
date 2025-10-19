import React, { memo } from "react";

interface OrdersHeaderProps {
  currentTimeLabel: string;
  openOrderCount: number;
  lastUpdatedLabel: string | null;
  error: string | null;
  isRailOpen: boolean;
  onToggleRail: () => void;
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
    <path d="M19.5 12a7.5 7.5 0 0 0-.08-1.08l2.12-1.65-2-3.46-2.58 1a7.52 7.52 0 0 0-1.87-1.08l-.39-2.74h-4l-.39 2.74a7.52 7.52 0 0 0-1.87-1.08l-2.58-1-2 3.46 2.12 1.65A7.5 7.5 0 0 0 4.5 12c0 .36.03.72.08 1.08l-2.12 1.65 2 3.46 2.58-1a7.52 7.52 0 0 0 1.87-1.08l.39 2.74h4l.39-2.74a7.52 7.52 0 0 0 1.87-1.08l2.58 1 2-3.46-2.12-1.65c.05-.36.08-.72.08-1.08Z" />
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
    {open ? <path d="m6 18 6-6-6-6m12 12-6-6 6-6" /> : <path d="m9 6 6 6-6 6" />}
  </svg>
);

const OrdersHeaderComponent: React.FC<OrdersHeaderProps> = ({
  currentTimeLabel,
  openOrderCount,
  lastUpdatedLabel,
  error,
  isRailOpen,
  onToggleRail,
}) => {
  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-300 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 md:hidden"
            onClick={onToggleRail}
            aria-label={isRailOpen ? "Hide modifiers" : "Show modifiers"}
          >
            <RailToggleIcon open={isRailOpen} className="h-5 w-5" />
          </button>
          <div className="text-lg font-semibold text-white">Orders – All Day View</div>
        </div>

        <div className="flex flex-1 items-center gap-4 text-sm text-slate-300">
          <span className="hidden text-slate-400 sm:inline">Local time</span>
          <span className="font-mono text-white">{currentTimeLabel}</span>
          <span className="hidden text-slate-500 md:inline">|</span>
          <span className="font-medium text-emerald-300">
            Open Orders: <span className="font-semibold text-white">{openOrderCount}</span>
          </span>
          {lastUpdatedLabel && (
            <span className="hidden text-xs text-slate-400 sm:inline">{lastUpdatedLabel}</span>
          )}
          {error && (
            <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-300">{error}</span>
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
  );
};

export const OrdersHeader = memo(OrdersHeaderComponent);

OrdersHeader.displayName = "OrdersHeader";
