const ENDPOINT = "/api/items-expanded";
const POLL_INTERVAL_MS = 10_000;
const DUE_SOON_THRESHOLD_MS = 5 * 60 * 1000;
const MAX_MODIFIERS_IN_RAIL = 50;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "ready", label: "Ready" },
  { id: "delivery", label: "Delivery" },
];

const elements = {
  modifierRail: document.getElementById("modifier-rail"),
  modifierRailList: document.getElementById("modifier-rail-list"),
  openRailButton: document.getElementById("open-rail"),
  closeRailButton: document.getElementById("close-rail"),
  ordersContainer: document.getElementById("orders-container"),
  currentTime: document.getElementById("current-time"),
  openOrderCount: document.getElementById("open-order-count"),
  filterChips: document.getElementById("filter-chips"),
  lookbackButtons: document.querySelectorAll(".lookback-toggle .chip"),
  lastUpdated: document.getElementById("last-updated"),
  statusArea: document.getElementById("status-area"),
};

const state = {
  filter: "open",
  lookback: "default",
  enrichedOrders: [],
  loading: true,
  error: null,
  lastUpdatedAt: null,
};

let pollTimer = null;
let animationFrame = null;
let lastTimerUpdate = 0;

function init() {
  renderFilterChips();
  bindEvents();
  updateLookbackButtons();
  if (elements.modifierRail) {
    elements.modifierRail.setAttribute("aria-hidden", "false");
  }
  updateLiveClock();
  setInterval(updateLiveClock, 1000);
  scheduleTimerTick();
  fetchOrders({ showLoading: true });
  pollTimer = setInterval(() => fetchOrders({ showLoading: false }), POLL_INTERVAL_MS);
}

function bindEvents() {
  elements.filterChips.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-filter]");
    if (!target) return;
    const filter = target.getAttribute("data-filter");
    if (filter && filter !== state.filter) {
      state.filter = filter;
      render();
    }
  });

  elements.lookbackButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const lookback = button.getAttribute("data-lookback");
      if (!lookback || lookback === state.lookback) return;
      state.lookback = lookback;
      updateLookbackButtons();
      fetchOrders({ showLoading: true });
    });
  });

  if (elements.openRailButton) {
    elements.openRailButton.addEventListener("click", () => {
      elements.modifierRail.classList.add("modifier-rail--visible");
      elements.modifierRail.setAttribute("aria-hidden", "false");
    });
  }

  if (elements.closeRailButton) {
    elements.closeRailButton.addEventListener("click", () => {
      elements.modifierRail.classList.remove("modifier-rail--visible");
      elements.modifierRail.setAttribute("aria-hidden", "true");
    });
  }
}

function updateLookbackButtons() {
  elements.lookbackButtons.forEach((button) => {
    const lookback = button.getAttribute("data-lookback");
    const isActive = lookback === state.lookback;
    button.classList.toggle("chip--active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderFilterChips() {
  const fragment = document.createDocumentFragment();
  FILTERS.forEach(({ id, label }) => {
    const button = document.createElement("button");
    button.className = "chip";
    button.setAttribute("data-filter", id);
    button.setAttribute("role", "tab");
    button.textContent = label;
    fragment.appendChild(button);
  });
  elements.filterChips.innerHTML = "";
  elements.filterChips.appendChild(fragment);
  updateFilterChipSelection();
}

function updateFilterChipSelection() {
  const buttons = elements.filterChips.querySelectorAll("button[data-filter]");
  buttons.forEach((button) => {
    const isActive = button.getAttribute("data-filter") === state.filter;
    button.classList.toggle("chip--active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.setAttribute("tabindex", isActive ? "0" : "-1");
  });
}

async function fetchOrders({ showLoading }) {
  if (showLoading) {
    state.loading = true;
    state.error = null;
    render();
  }

  try {
    const url = new URL(ENDPOINT, window.location.origin);
    if (state.lookback === "full") {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      url.searchParams.set("start", toToastTimestamp(start));
      url.searchParams.set("end", toToastTimestamp(now));
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const payload = await response.json();
    const orders = Array.isArray(payload?.orders) ? payload.orders : [];
    state.enrichedOrders = processOrders(orders);
    state.lastUpdatedAt = new Date();
    state.error = null;
  } catch (error) {
    console.error("Failed to fetch orders", error);
    state.error = error instanceof Error ? error.message : "Unknown error";
  } finally {
    state.loading = false;
    render();
  }
}

function processOrders(orders) {
  return orders
    .filter((order) => order && order.orderData && order.items)
    .map((order) => {
      const placedAt = parseToast(order.orderData.orderTime);
      const dueAt = order.orderData.timeDue ? parseToast(order.orderData.timeDue) : null;
      const combinedItems = combineItems(order.items ?? []);
      return {
        raw: order,
        placedAt,
        dueAt,
        combinedItems,
      };
    });
}

function parseToast(timestamp) {
  if (!timestamp || typeof timestamp !== "string") {
    return new Date();
  }
  const normalized = timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return new Date(normalized);
}

function toToastTimestamp(date) {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const millis = pad(date.getMilliseconds(), 3);
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetMins = pad(Math.abs(offsetMinutes) % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${offsetSign}${offsetHours}${offsetMins}`;
}

function combineItems(items) {
  const map = new Map();
  items.forEach((item) => {
    if (!item) return;
    const quantity = typeof item.quantity === "number" ? item.quantity : 1;
    if (quantity <= 0) return;
    const collapsedModifiers = collapseModifiers(item.modifiers ?? []);
    const modifiersKey = collapsedModifiers
      .map((mod) => `${mod.key}:${mod.quantity}`)
      .sort()
      .join("|");
    const key = `${item.menuItemId || item.itemName || "unknown"}__${modifiersKey}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        itemName: item.itemName || "Item",
        menuItemId: item.menuItemId || key,
        totalQuantity: 0,
        modifiers: new Map(),
        statuses: new Map(),
      };
      map.set(key, entry);
    }
    entry.totalQuantity += quantity;
    collapsedModifiers.forEach((modifier) => {
      const existing = entry.modifiers.get(modifier.key);
      if (existing) {
        existing.quantity += modifier.quantity * quantity;
        existing.priceCents += modifier.priceCents * quantity;
      } else {
        entry.modifiers.set(modifier.key, {
          key: modifier.key,
          name: modifier.name,
          groupName: modifier.groupName,
          quantity: modifier.quantity * quantity,
          priceCents: modifier.priceCents * quantity,
        });
      }
    });
    const statusKey = item.fulfillmentStatus || "UNKNOWN";
    entry.statuses.set(statusKey, (entry.statuses.get(statusKey) ?? 0) + quantity);
  });

  return Array.from(map.values()).map((entry) => ({
    key: entry.key,
    itemName: entry.itemName,
    menuItemId: entry.menuItemId,
    totalQuantity: entry.totalQuantity,
    modifiers: Array.from(entry.modifiers.values()),
    statusSummary: Array.from(entry.statuses.entries()),
  }));
}

function collapseModifiers(modifiers) {
  const map = new Map();
  modifiers.forEach((modifier) => {
    if (!modifier) return;
    const key = modifier.id || `${modifier.name ?? ""}|${modifier.groupName ?? ""}`;
    const quantity = typeof modifier.quantity === "number" ? modifier.quantity : 1;
    const priceCents = typeof modifier.priceCents === "number" ? modifier.priceCents : 0;
    const name = modifier.name || (modifier.groupName ? `${modifier.groupName} Option` : "Modifier");
    const groupName = modifier.groupName ?? null;
    const existing = map.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.priceCents += priceCents;
    } else {
      map.set(key, {
        key,
        name,
        groupName,
        quantity,
        priceCents,
      });
    }
  });
  return Array.from(map.values());
}

function render() {
  updateFilterChipSelection();
  renderStatus();
  renderOrders();
  renderModifierRail();
  updateLastUpdated();
}

function renderStatus() {
  elements.statusArea.innerHTML = "";
  if (state.loading) {
    const skeleton = document.createElement("div");
    skeleton.className = "loading-banner";
    skeleton.textContent = "Loading orders…";
    elements.statusArea.appendChild(skeleton);
    return;
  }
  if (state.error) {
    const errorBanner = document.createElement("div");
    errorBanner.className = "error-banner";
    const retryButton = document.createElement("button");
    retryButton.className = "retry-button";
    retryButton.textContent = "Retry";
    retryButton.addEventListener("click", () => fetchOrders({ showLoading: true }));
    errorBanner.textContent = state.error;
    errorBanner.appendChild(retryButton);
    elements.statusArea.appendChild(errorBanner);
    return;
  }
}

function renderOrders() {
  elements.ordersContainer.innerHTML = "";
  if (state.loading) {
    elements.ordersContainer.appendChild(createSkeletonCards());
    elements.openOrderCount.textContent = "Open Orders: --";
    return;
  }

  const filteredOrders = getFilteredOrders();
  elements.openOrderCount.textContent = `Open Orders: ${filteredOrders.length}`;

  if (filteredOrders.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "No orders match the current filters.";
    elements.ordersContainer.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();
  filteredOrders.forEach((order) => {
    fragment.appendChild(renderOrderCard(order));
  });
  elements.ordersContainer.appendChild(fragment);
}

function createSkeletonCards() {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 4; i += 1) {
    const card = document.createElement("article");
    card.className = "order-card order-card--skeleton";
    const header = document.createElement("div");
    header.className = "order-card-header skeleton";
    const body = document.createElement("div");
    body.className = "order-card-body skeleton";
    card.appendChild(header);
    card.appendChild(body);
    fragment.appendChild(card);
  }
  return fragment;
}

function getFilteredOrders() {
  const sorted = [...state.enrichedOrders].sort(compareOrders);
  return sorted.filter((order) => matchesFilter(order, state.filter));
}

function compareOrders(a, b) {
  const dueA = a.dueAt ? a.dueAt.getTime() : null;
  const dueB = b.dueAt ? b.dueAt.getTime() : null;
  if (dueA !== null && dueB !== null && dueA !== dueB) {
    return dueA - dueB;
  }
  if (dueA === null && dueB !== null) return 1;
  if (dueA !== null && dueB === null) return -1;

  const placedDiff = a.placedAt.getTime() - b.placedAt.getTime();
  if (placedDiff !== 0) return placedDiff;

  const numberA = a.raw.orderData?.orderNumber ?? "";
  const numberB = b.raw.orderData?.orderNumber ?? "";
  return String(numberA).localeCompare(String(numberB), undefined, { numeric: true });
}

function matchesFilter(order, filter) {
  const raw = order.raw;
  switch (filter) {
    case "all":
      return true;
    case "open":
      return isOpenOrder(raw);
    case "ready":
      return isReadyOrder(raw);
    case "delivery":
      return raw?.orderData?.orderType === "DELIVERY";
    default:
      return true;
  }
}

function isOpenOrder(order) {
  if (!order || !order.orderData) return false;
  if (order.orderData.deliveryState === "DELIVERED") {
    return false;
  }
  return true;
}

function isReadyOrder(order) {
  if (!order || !order.orderData) return false;
  if (order.orderData.fulfillmentStatus === "READY_FOR_PICKUP") {
    return true;
  }
  const items = Array.isArray(order.items) ? order.items : [];
  return items.length > 0 && items.every((item) => item?.fulfillmentStatus === "READY");
}

function renderOrderCard(order) {
  const { raw, placedAt, dueAt, combinedItems } = order;
  const card = document.createElement("article");
  card.className = "order-card";
  card.dataset.placedAt = placedAt.getTime();
  if (dueAt) {
    card.dataset.dueAt = dueAt.getTime();
  }

  const header = document.createElement("div");
  header.className = "order-card-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "order-card-title";

  const customerName = document.createElement("h3");
  customerName.textContent = raw.orderData?.customerName || "Guest";
  titleGroup.appendChild(customerName);

  const subtitle = document.createElement("div");
  subtitle.className = "order-card-subtitle";
  const orderNumber = raw.orderData?.orderNumber ? `#${raw.orderData.orderNumber}` : "No number";
  const orderType = raw.orderData?.orderType || "UNKNOWN";
  const placedLabel = formatTime(placedAt);
  const numberSpan = document.createElement("span");
  numberSpan.textContent = orderNumber;
  const typeBadge = document.createElement("span");
  typeBadge.className = "badge badge--muted";
  typeBadge.textContent = orderType;
  const placedSpan = document.createElement("span");
  placedSpan.textContent = `Placed ${placedLabel}`;
  subtitle.appendChild(numberSpan);
  subtitle.appendChild(document.createTextNode(" · "));
  subtitle.appendChild(typeBadge);
  subtitle.appendChild(document.createTextNode(" · "));
  subtitle.appendChild(placedSpan);
  titleGroup.appendChild(subtitle);

  header.appendChild(titleGroup);

  const statusGroup = document.createElement("div");
  statusGroup.className = "order-card-status";

  if (raw.orderData?.fulfillmentStatus) {
    statusGroup.appendChild(createStatusChip(raw.orderData.fulfillmentStatus));
  }

  const since = document.createElement("span");
  since.className = "since-placed";
  since.dataset.placedAt = placedAt.getTime();
  since.textContent = formatDuration(Date.now() - placedAt.getTime());
  statusGroup.appendChild(since);

  if (dueAt) {
    const due = document.createElement("span");
    due.className = "due-time";
    due.textContent = `Due ${formatTime(dueAt)}`;
    statusGroup.appendChild(due);
  }

  header.appendChild(statusGroup);

  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "order-card-body";

  combinedItems.forEach((item) => {
    body.appendChild(renderCombinedItem(item));
  });

  card.appendChild(body);

  updateDueClasses(card);
  return card;
}

function createStatusChip(status) {
  const span = document.createElement("span");
  span.className = `status-chip status-${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  span.textContent = status;
  return span;
}

function renderCombinedItem(item) {
  const row = document.createElement("div");
  row.className = "order-item";

  const header = document.createElement("div");
  header.className = "order-item-header";

  const name = document.createElement("span");
  name.className = "order-item-name";
  name.textContent = item.itemName;
  header.appendChild(name);

  const quantity = document.createElement("span");
  quantity.className = "quantity-chip";
  quantity.textContent = `×${item.totalQuantity}`;
  header.appendChild(quantity);

  header.appendChild(renderItemStatusSummary(item.statusSummary));

  row.appendChild(header);

  if (item.modifiers.length > 0) {
    const modifierList = document.createElement("ul");
    modifierList.className = "modifier-list";
    item.modifiers.forEach((modifier) => {
      const li = document.createElement("li");
      li.className = "modifier-row";
      const label = document.createElement("span");
      label.className = "modifier-name";
      label.textContent = modifier.name;
      if (modifier.groupName) {
        label.title = modifier.groupName;
      }
      const count = document.createElement("span");
      count.className = "modifier-quantity";
      count.textContent = `×${modifier.quantity}`;
      li.appendChild(label);
      li.appendChild(count);
      modifierList.appendChild(li);
    });
    row.appendChild(modifierList);
  }

  return row;
}

function renderItemStatusSummary(statusEntries) {
  const container = document.createElement("div");
  container.className = "item-status-group";
  statusEntries.forEach(([status, count]) => {
    const chip = document.createElement("span");
    chip.className = `status-chip status-${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    chip.textContent = count > 1 ? `${status} (${count})` : status;
    container.appendChild(chip);
  });
  return container;
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function updateLiveClock() {
  elements.currentTime.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function updateLastUpdated() {
  if (!state.lastUpdatedAt) {
    elements.lastUpdated.textContent = "Last updated --:--:--";
    return;
  }
  elements.lastUpdated.textContent = `Last updated ${new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(state.lastUpdatedAt)}`;
}

function renderModifierRail() {
  const orders = getFilteredOrders();
  const aggregate = aggregateModifiers(orders);
  elements.modifierRailList.innerHTML = "";
  if (aggregate.length === 0) {
    const empty = document.createElement("div");
    empty.className = "modifier-empty";
    empty.textContent = "No modifiers";
    elements.modifierRailList.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  aggregate.forEach((row) => {
    const item = document.createElement("div");
    item.className = "modifier-row";
    const name = document.createElement("span");
    name.className = "modifier-name";
    name.textContent = row.name;
    if (row.groupName) {
      name.title = row.groupName;
    }
    const badge = document.createElement("span");
    badge.className = "modifier-count";
    badge.textContent = row.count;
    item.appendChild(name);
    item.appendChild(badge);
    fragment.appendChild(item);
  });
  elements.modifierRailList.appendChild(fragment);
}

function aggregateModifiers(orders) {
  const map = new Map();
  orders.forEach((order) => {
    order.combinedItems.forEach((item) => {
      item.modifiers.forEach((modifier) => {
        const existing = map.get(modifier.key);
        if (existing) {
          existing.count += modifier.quantity;
        } else {
          map.set(modifier.key, {
            key: modifier.key,
            name: modifier.name,
            groupName: modifier.groupName,
            count: modifier.quantity,
          });
        }
      });
    });
  });
  return Array.from(map.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_MODIFIERS_IN_RAIL);
}

function scheduleTimerTick() {
  animationFrame = requestAnimationFrame((timestamp) => {
    if (!lastTimerUpdate || timestamp - lastTimerUpdate >= 500) {
      updateTimers();
      lastTimerUpdate = timestamp;
    }
    scheduleTimerTick();
  });
}

function updateTimers() {
  const now = Date.now();
  document.querySelectorAll(".since-placed").forEach((element) => {
    const placedAt = Number(element.dataset.placedAt);
    if (!Number.isFinite(placedAt)) return;
    element.textContent = formatDuration(now - placedAt);
  });
  document.querySelectorAll(".order-card").forEach((card) => updateDueClasses(card));
}

function updateDueClasses(card) {
  const dueAt = Number(card.dataset.dueAt);
  card.classList.remove("order-card--overdue", "order-card--due-soon");
  if (!Number.isFinite(dueAt) || dueAt <= 0) return;
  const now = Date.now();
  if (dueAt < now) {
    card.classList.add("order-card--overdue");
  } else if (dueAt - now <= DUE_SOON_THRESHOLD_MS) {
    card.classList.add("order-card--due-soon");
  }
}

window.addEventListener("beforeunload", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (animationFrame) cancelAnimationFrame(animationFrame);
});

init();
