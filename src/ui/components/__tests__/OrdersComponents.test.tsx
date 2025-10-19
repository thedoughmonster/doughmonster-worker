import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { OrdersHeader } from "../OrdersHeader";
import { OrdersFilterBar } from "../OrdersFilterBar";
import { ModifiersRail } from "../ModifiersRail";
import { OrdersGrid } from "../OrdersGrid";
import {
  EnrichedOrder,
  ModifierAggregateRow,
  OrderStatus,
} from "../../OrdersAllDayView";

describe("Orders UI components", () => {
  it("renders header metrics and toggles the rail", () => {
    const onToggle = jest.fn();

    render(
      <OrdersHeader
        currentTimeLabel="12:00 PM"
        error={"Network error"}
        isRailOpen={false}
        lastUpdatedLabel="Last updated 11:59 AM"
        onToggleRail={onToggle}
        openOrderCount={5}
      />
    );

    expect(screen.getByText("Orders – All Day View")).toBeInTheDocument();
    expect(screen.getByText("Local time")).toBeInTheDocument();
    expect(screen.getByText(/Open Orders: 5/)).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show modifiers/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders filters and invokes filter change", () => {
    const filters: { id: OrderStatus; label: string }[] = [
      { id: "all", label: "All" },
      { id: "open", label: "Open" },
    ];
    const onFilterChange = jest.fn();

    render(
      <OrdersFilterBar
        activeFilter="all"
        filters={filters}
        onFilterChange={onFilterChange}
        statusMessage="Refreshing…"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onFilterChange).toHaveBeenCalledWith("open");
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
  });

  it("renders modifiers rail items", () => {
    const modifiers: ModifierAggregateRow[] = [
      { key: "1", name: "Extra Cheese", count: 3, groupName: "Toppings" },
      { key: "2", name: "Bacon", count: 2, groupName: null },
    ];

    render(
      <ModifiersRail
        isOpen
        modifierAggregations={modifiers}
        showLoading={false}
      />
    );

    expect(screen.getByText("Modifiers")).toBeInTheDocument();
    expect(screen.getByText("Extra Cheese")).toBeInTheDocument();
    expect(screen.getByText("Bacon")).toBeInTheDocument();
  });

  it("renders orders grid with cards and handles retry", () => {
    const retry = jest.fn();
    const orders: EnrichedOrder[] = [
      {
        raw: {
          orderData: {
            orderId: "order-1",
            orderTime: "2024-01-01T17:00:00.000Z",
            timeDue: "2024-01-01T17:05:00.000Z",
            orderNumber: "42",
            fulfillmentStatus: "IN_PREPARATION",
            customerName: "Sam",
            orderType: "DINE_IN",
            orderTypeNormalized: "DINE_IN",
            deliveryState: null,
          },
          items: [],
          totals: undefined,
        },
        placedAt: new Date("2024-01-01T17:00:00.000Z"),
        dueAt: new Date("2024-01-01T17:05:00.000Z"),
        combinedItems: [
          {
            key: "item-1",
            itemName: "Latte",
            menuItemId: "latte",
            totalQuantity: 2,
            statusSummary: "IN_PREPARATION",
            modifiers: [
              { key: "m1", name: "Oat Milk", groupName: null, quantity: 2 },
            ],
          },
        ],
      },
    ];

    render(
      <OrdersGrid
        enrichedOrders={orders}
        error="Server unreachable"
        now={new Date("2024-01-01T17:02:00.000Z")}
        onRetry={retry}
        showEmptyState={false}
        showLoading={false}
      />
    );

    expect(screen.getByText("Server unreachable")).toBeInTheDocument();
    expect(screen.getByText("Latte")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
