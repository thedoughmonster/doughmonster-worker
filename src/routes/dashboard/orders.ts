const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Orders Dashboard</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        background-color: #0f172a;
        color: #e2e8f0;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 1));
      }

      h1,
      h2,
      h3,
      h4,
      h5,
      h6 {
        font-weight: 600;
        margin: 0;
      }

      .ui-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 1rem;
        padding: 1rem 1.5rem;
        background: rgba(15, 23, 42, 0.95);
        border-bottom: 1px solid rgba(148, 163, 184, 0.25);
        box-shadow: 0 2px 14px rgba(15, 23, 42, 0.45);
        position: sticky;
        top: 0;
        z-index: 10;
      }

      .ui-section {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding-left: 1rem;
        border-left: 1px solid rgba(148, 163, 184, 0.3);
        min-width: 12rem;
      }

      .ui-section:first-child {
        padding-left: 0;
        border-left: none;
        min-width: auto;
      }

      .ui-section-label {
        font-size: 0.7rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(148, 163, 184, 0.9);
      }

      .ui-section button {
        border: none;
        background: rgba(59, 130, 246, 0.2);
        color: #bfdbfe;
        border-radius: 8px;
        padding: 0.5rem 0.9rem;
        font-size: 0.95rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .ui-section button:hover,
      .ui-section button:focus-visible {
        background: rgba(59, 130, 246, 0.35);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
      }

      main {
        display: grid;
        grid-template-columns: minmax(22rem, 32rem) 1fr;
        gap: 2rem;
        padding: 2rem clamp(1rem, 4vw, 3rem);
        flex: 1;
      }

      @media (max-width: 960px) {
        main {
          grid-template-columns: 1fr;
        }
      }

      .panel {
        background: rgba(15, 23, 42, 0.65);
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .panel header {
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 1rem;
      }

      .panel-content {
        padding: 1.25rem 1.5rem;
        flex: 1;
        overflow-y: auto;
      }

      .orders-list {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
      }

      .order-card {
        background: rgba(30, 41, 59, 0.75);
        border-radius: 12px;
        padding: 0.9rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        border: 1px solid rgba(148, 163, 184, 0.18);
        cursor: pointer;
        transition: all 0.18s ease;
        position: relative;
      }

      .order-card::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        box-shadow: 0 10px 25px rgba(30, 64, 175, 0.12);
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .order-card:hover::after {
        opacity: 1;
      }

      .order-card.selected {
        border-color: rgba(96, 165, 250, 0.75);
        background: rgba(30, 64, 175, 0.35);
        box-shadow: 0 12px 32px rgba(30, 64, 175, 0.25);
      }

      .order-card.selected::after {
        opacity: 1;
        box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.6);
      }

      .order-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem 0.75rem;
        color: rgba(226, 232, 240, 0.8);
        font-size: 0.85rem;
      }

      .order-headline {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        align-items: baseline;
      }

      .order-headline strong {
        font-size: 1.05rem;
        letter-spacing: 0.02em;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        background: rgba(71, 85, 105, 0.55);
        border-radius: 999px;
        padding: 0.25rem 0.6rem;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .status-message {
        margin: 0.5rem 0 0;
        font-size: 0.85rem;
        color: rgba(226, 232, 240, 0.7);
      }

      .modifiers-summary {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        margin-bottom: 1rem;
      }

      .summary-headline {
        font-size: 0.9rem;
        color: rgba(226, 232, 240, 0.86);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(15, 23, 42, 0.4);
        border-radius: 12px;
        overflow: hidden;
      }

      thead {
        background: rgba(30, 41, 59, 0.85);
      }

      th,
      td {
        text-align: left;
        padding: 0.65rem 0.75rem;
        font-size: 0.9rem;
      }

      th {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.75rem;
        color: rgba(148, 163, 184, 0.95);
      }

      tbody tr:nth-child(odd) {
        background: rgba(30, 41, 59, 0.25);
      }

      tbody tr:nth-child(even) {
        background: rgba(15, 23, 42, 0.2);
      }

      tbody tr:hover {
        background: rgba(59, 130, 246, 0.22);
      }

      .empty-state {
        padding: 1rem 0;
        font-size: 0.9rem;
        color: rgba(226, 232, 240, 0.7);
      }

      .error {
        color: #fca5a5;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }
    </style>
  </head>
  <body>
    <header class="ui-bar">
      <div class="ui-section">
        <h1>Orders Dashboard</h1>
        <p class="status-message" id="last-updated" aria-live="polite"></p>
      </div>
      <div class="ui-section" aria-label="Selection controls">
        <span class="ui-section-label">Selection Controls</span>
        <button type="button" id="clear-selection">Clear Selection</button>
      </div>
      <div class="ui-section" aria-label="Data controls">
        <span class="ui-section-label">Data Controls</span>
        <button type="button" id="refresh-orders">Refresh Orders</button>
      </div>
    </header>
    <main>
      <section class="panel orders-panel">
        <header>
          <h2>Orders</h2>
          <span class="badge" id="selection-count">0 selected</span>
        </header>
        <div class="panel-content">
          <div id="orders-list" class="orders-list" role="list"></div>
          <p class="status-message" id="orders-status" aria-live="polite"></p>
        </div>
      </section>
      <section class="panel modifiers-panel">
        <header>
          <h2>Modifiers</h2>
          <span class="badge" id="modifier-total">$0.00</span>
        </header>
        <div class="panel-content">
          <div class="modifiers-summary" id="modifiers-summary"></div>
          <table>
            <thead>
              <tr>
                <th scope="col">Modifier</th>
                <th scope="col">Group</th>
                <th scope="col">Quantity</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody id="modifiers-body"></tbody>
          </table>
          <p class="status-message" id="modifiers-status" aria-live="polite"></p>
        </div>
      </section>
    </main>
    <script type="module">
      (function () {
        const ORDERS_ENDPOINT = "/api/orders-detailed?limit=100";
        const state = {
          orders: [],
          selectedOrderIds: new Set(),
        };

        const ordersList = document.getElementById("orders-list");
        const ordersStatus = document.getElementById("orders-status");
        const modifiersBody = document.getElementById("modifiers-body");
        const modifiersSummary = document.getElementById("modifiers-summary");
        const modifiersStatus = document.getElementById("modifiers-status");
        const selectionBadge = document.getElementById("selection-count");
        const modifierTotalBadge = document.getElementById("modifier-total");
        const lastUpdated = document.getElementById("last-updated");
        const clearSelectionButton = document.getElementById("clear-selection");
        const refreshButton = document.getElementById("refresh-orders");

        function formatCurrency(cents) {
          const dollars = (cents || 0) / 100;
          return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
          }).format(dollars);
        }

        function getOrderLabel(order) {
          const orderNumber = order?.orderData?.orderNumber;
          const customer = order?.orderData?.customerName;
          const orderId = order?.orderData?.orderId;
          const pieces = [];
          if (orderNumber) pieces.push('#' + orderNumber);
          if (customer) pieces.push(customer);
          if (pieces.length === 0 && orderId) pieces.push(orderId);
          return pieces.join(" — ") || "Unnamed order";
        }

        function getOrderSubtitle(order) {
          const type = order?.orderData?.orderTypeNormalized || order?.orderData?.orderType;
          const time = order?.orderData?.orderTime;
          const formattedTime = time ? new Date(time).toLocaleString() : null;
          const locationId = order?.orderData?.location?.locationId;
          const parts = [];
          if (type) parts.push(type);
          if (locationId) parts.push('Location: ' + locationId);
          if (formattedTime) parts.push(formattedTime);
          return parts.join(" • ");
        }

        function sumModifierTotal(order) {
          if (!order?.items) return 0;
          let total = 0;
          for (const item of order.items) {
            if (!item?.modifiers) continue;
            for (const modifier of item.modifiers) {
              total += Number(modifier?.priceCents || 0);
            }
          }
          return total;
        }

        function aggregateModifiers(activeOrders) {
          const aggregates = new Map();
          for (const order of activeOrders) {
            const items = Array.isArray(order?.items) ? order.items : [];
            for (const item of items) {
              const modifiers = Array.isArray(item?.modifiers) ? item.modifiers : [];
              for (const modifier of modifiers) {
                if (!modifier) continue;
                const id = modifier.id || "";
                const key = (id || '') + '|' + String(modifier.name || '').toLowerCase() + '|' + (modifier.groupName || '');
                if (!aggregates.has(key)) {
                  aggregates.set(key, {
                    name: modifier.name || "Unnamed modifier",
                    groupName: modifier.groupName || "",
                    quantity: 0,
                    totalCents: 0,
                  });
                }
                const entry = aggregates.get(key);
                entry.quantity += Number(modifier.quantity || 0);
                entry.totalCents += Number(modifier.priceCents || 0);
              }
            }
          }

          return Array.from(aggregates.values()).sort((a, b) => {
            if (b.totalCents !== a.totalCents) return b.totalCents - a.totalCents;
            return a.name.localeCompare(b.name);
          });
        }

        function getActiveOrders() {
          if (state.selectedOrderIds.size === 0) {
            return state.orders;
          }
          return state.orders.filter((order) => state.selectedOrderIds.has(order?.orderData?.orderId));
        }

        function updateSelectionBadge() {
          const count = state.selectedOrderIds.size;
          selectionBadge.textContent = count + ' selected';
        }

        function updateLastUpdated() {
          lastUpdated.textContent = 'Last updated ' + new Date().toLocaleTimeString();
        }

        function renderOrders() {
          ordersList.innerHTML = "";
          if (!state.orders || state.orders.length === 0) {
            ordersStatus.textContent = "No orders available.";
            return;
          }
          ordersStatus.textContent = "Tap an order to filter the modifier totals.";

          for (const order of state.orders) {
            const orderId = order?.orderData?.orderId;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "order-card";
            button.dataset.orderId = orderId || "";

            const headline = document.createElement("div");
            headline.className = "order-headline";

            const title = document.createElement("strong");
            title.textContent = getOrderLabel(order);
            headline.appendChild(title);

            const total = document.createElement("span");
            total.className = "badge";
            total.textContent = formatCurrency(sumModifierTotal(order));
            headline.appendChild(total);

            const subtitle = document.createElement("div");
            subtitle.className = "order-meta";
            const subtitleText = getOrderSubtitle(order);
            if (subtitleText) {
              subtitle.textContent = subtitleText;
            }

            button.appendChild(headline);
            if (subtitleText) {
              button.appendChild(subtitle);
            }

            if (state.selectedOrderIds.has(orderId)) {
              button.classList.add("selected");
              button.setAttribute("aria-pressed", "true");
            } else {
              button.setAttribute("aria-pressed", "false");
            }

            button.addEventListener("click", () => {
              toggleOrder(orderId);
            });

            ordersList.appendChild(button);
          }
        }

        function renderModifiers() {
          const activeOrders = getActiveOrders();
          const aggregated = aggregateModifiers(activeOrders);
          modifiersBody.innerHTML = "";

          if (activeOrders.length === 0) {
            modifiersStatus.textContent = "No orders selected.";
            modifiersSummary.innerHTML = "";
            modifierTotalBadge.textContent = "$0.00";
            return;
          }

          modifiersStatus.textContent = aggregated.length === 0 ? "No modifiers for the selected orders." : "";

          const totalCents = aggregated.reduce((sum, entry) => sum + entry.totalCents, 0);
          modifierTotalBadge.textContent = formatCurrency(totalCents);

          const summaryLines = [];
          if (state.selectedOrderIds.size > 0) {
            const plural = state.selectedOrderIds.size === 1 ? '' : 's';
            summaryLines.push(state.selectedOrderIds.size + ' order' + plural + ' selected.');
          } else {
            summaryLines.push('Showing all ' + state.orders.length + ' orders.');
          }
          summaryLines.push('Total modifiers: ' + aggregated.length);
          modifiersSummary.innerHTML = summaryLines
            .map((line) => '<span class="summary-headline">' + line + '</span>')
            .join("");

          if (aggregated.length === 0) {
            return;
          }

          for (const entry of aggregated) {
            const row = document.createElement("tr");

            const nameCell = document.createElement("td");
            nameCell.textContent = entry.name;
            row.appendChild(nameCell);

            const groupCell = document.createElement("td");
            groupCell.textContent = entry.groupName || "—";
            row.appendChild(groupCell);

            const quantityCell = document.createElement("td");
            quantityCell.textContent = String(entry.quantity);
            row.appendChild(quantityCell);

            const totalCell = document.createElement("td");
            totalCell.textContent = formatCurrency(entry.totalCents);
            row.appendChild(totalCell);

            modifiersBody.appendChild(row);
          }
        }

        function toggleOrder(orderId) {
          if (!orderId) return;
          if (state.selectedOrderIds.has(orderId)) {
            state.selectedOrderIds.delete(orderId);
          } else {
            state.selectedOrderIds.add(orderId);
          }
          updateSelectionBadge();
          renderOrders();
          renderModifiers();
        }

        function clearSelection() {
          if (state.selectedOrderIds.size === 0) return;
          state.selectedOrderIds.clear();
          updateSelectionBadge();
          renderOrders();
          renderModifiers();
        }

        async function fetchOrders() {
          try {
            ordersStatus.textContent = "Loading orders...";
            modifiersStatus.textContent = "";
            refreshButton.disabled = true;
            const response = await fetch(ORDERS_ENDPOINT, { headers: { accept: "application/json" } });
            if (!response.ok) {
              throw new Error('Request failed with status ' + response.status);
            }
            const payload = await response.json();
            const orders = Array.isArray(payload?.orders) ? payload.orders : [];
            state.orders = orders.sort((a, b) => {
              const timeA = Date.parse(a?.orderData?.orderTime ?? "");
              const timeB = Date.parse(b?.orderData?.orderTime ?? "");
              if (Number.isFinite(timeA) && Number.isFinite(timeB)) return timeB - timeA;
              if (Number.isFinite(timeA)) return -1;
              if (Number.isFinite(timeB)) return 1;
              return (a?.orderData?.orderId || "").localeCompare(b?.orderData?.orderId || "");
            });
            updateLastUpdated();
            renderOrders();
            renderModifiers();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ordersStatus.textContent = 'Failed to load orders: ' + message;
            ordersStatus.classList.add("error");
            modifiersStatus.textContent = "";
          } finally {
            refreshButton.disabled = false;
          }
        }

        clearSelectionButton.addEventListener("click", () => {
          clearSelection();
        });

        refreshButton.addEventListener("click", () => {
          fetchOrders();
        });

        updateSelectionBadge();

        const bootstrapOrders = Array.isArray(globalThis.__ORDERS_DASHBOARD__?.mockOrders)
          ? globalThis.__ORDERS_DASHBOARD__.mockOrders
          : null;

        if (bootstrapOrders && bootstrapOrders.length > 0) {
          state.orders = bootstrapOrders;
          updateLastUpdated();
          renderOrders();
          renderModifiers();
        } else {
          fetchOrders();
        }
      })();
    </script>
  </body>
</html>`;

export default function ordersDashboardHandler(): Response {
  return new Response(DASHBOARD_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
