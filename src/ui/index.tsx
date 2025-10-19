import React from "react";
import { createRoot } from "react-dom/client";
import OrdersAllDayView from "./OrdersAllDayView";

const container = document.getElementById("app");

if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <OrdersAllDayView />
    </React.StrictMode>
  );
}
