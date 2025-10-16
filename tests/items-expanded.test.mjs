import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/items-expanded.js');
const { createItemsExpandedHandler } = module;

function createEnv() {
  return {
    TOAST_API_BASE: 'https://toast.example',
    TOAST_AUTH_URL: 'https://toast.example/auth',
    TOAST_CLIENT_ID: 'id',
    TOAST_CLIENT_SECRET: 'secret',
    TOAST_RESTAURANT_GUID: 'restaurant-guid',
    TOKEN_KV: {
      get: async () => null,
      put: async () => undefined,
    },
  };
}

function createHandlerWithOrders(orders, menuDoc = null) {
  return createItemsExpandedHandler({
    async getOrdersBulk() {
      return { orders, nextPage: null };
    },
    async getPublishedMenus() {
      return menuDoc;
    },
  });
}

test('items-expanded calculates modifier totals with quantities and exposes modifier quantity', async () => {
  const orders = [
    {
      guid: 'order-modifiers',
      createdDate: '2024-01-01T12:00:00.000+0000',
      checks: [
        {
          guid: 'check-modifiers',
          selections: [
            {
              guid: 'sel-item',
              selectionType: 'MENU_ITEM',
              quantity: 3,
              receiptLinePrice: 1,
              item: { guid: 'item-1' },
              modifiers: [
                {
                  guid: 'sel-mod',
                  selectionType: 'MENU_ITEM',
                  quantity: 2,
                  price: 0.5,
                  item: { guid: 'mod-1' },
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const response = await handler(
    createEnv(),
    new Request('https://worker.test/api/items-expanded?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  const item = body.orders[0].items[0];
  assert.equal(item.modifiers.length, 1);
  assert.equal(item.modifiers[0].quantity, 2);
  assert.equal(item.modifiers[0].priceCents, 300);
  assert.equal(item.money.baseItemPriceCents, 300);
  assert.equal(item.money.modifierTotalCents, 300);
  assert.equal(item.money.totalItemPriceCents, 600);
});

test('items-expanded filters out special requests and fees from items array', async () => {
  const orders = [
    {
      guid: 'order-filter',
      createdDate: '2024-01-01T13:00:00.000+0000',
      checks: [
        {
          guid: 'check-filter',
          selections: [
            {
              guid: 'sel-special',
              selectionType: 'SPECIAL_REQUEST',
              item: { guid: 'special-1', itemType: 'SPECIAL_REQUEST' },
              receiptLinePrice: 0,
            },
            {
              guid: 'sel-fee',
              selectionType: 'FEE',
              item: { guid: 'fee-1', itemType: 'FEE' },
              receiptLinePrice: 2,
            },
            {
              guid: 'sel-real',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 4,
              item: { guid: 'item-real', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const response = await handler(
    createEnv(),
    new Request('https://worker.test/api/items-expanded?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].items.length, 1);
  assert.equal(body.orders[0].items[0].lineItemId, 'sel-real');
});

test('items-expanded uses customer name fallbacks when direct customer data is missing', async () => {
  const orders = [
    {
      guid: 'order-customer',
      createdDate: '2024-01-01T14:00:00.000+0000',
      context: {
        deliveryInfo: { recipientName: 'Delivery Dropoff' },
      },
      checks: [
        {
          guid: 'check-customer',
          tabName: 'VIP Table',
          curbsidePickupInfo: { name: 'Curbside Name' },
          guests: [{ firstName: 'Guest', lastName: 'One' }],
          selections: [
            {
              guid: 'sel-customer',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 5,
              item: { guid: 'item-customer', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const response = await handler(
    createEnv(),
    new Request('https://worker.test/api/items-expanded?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].customerName, 'VIP Table');
});

test('items-expanded resolves totals using the higher of upstream and computed values', async () => {
  const orders = [
    {
      guid: 'order-totals',
      createdDate: '2024-01-01T15:00:00.000+0000',
      checks: [
        {
          guid: 'check-totals',
          selections: [
            {
              guid: 'sel-total',
              selectionType: 'MENU_ITEM',
              quantity: 2,
              receiptLinePrice: 1,
              price: 1.5,
              item: { guid: 'item-total', itemType: 'MENU_ITEM' },
              modifiers: [
                {
                  guid: 'sel-total-mod',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.25,
                  item: { guid: 'mod-total', itemType: 'MENU_ITEM' },
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const response = await handler(createEnv(), new Request('https://worker.test/api/items-expanded?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  const money = body.orders[0].items[0].money;
  assert.equal(money.baseItemPriceCents, 200);
  assert.equal(money.modifierTotalCents, 50);
  assert.equal(money.totalItemPriceCents, 250);
});

test('items-expanded derives order type from available metadata', async () => {
  const orders = [
    {
      guid: 'order-curbside',
      createdDate: '2024-01-01T10:00:00.000+0000',
      checks: [
        {
          guid: 'check-curbside',
          curbsidePickupInfo: { name: 'Curbside Pickup' },
          selections: [
            {
              guid: 'sel-curb',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 3,
              item: { guid: 'item-curb', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
    {
      guid: 'order-delivery',
      createdDate: '2024-01-01T11:00:00.000+0000',
      context: {
        deliveryInfo: { recipientName: 'Deliver To' },
      },
      checks: [
        {
          guid: 'check-delivery',
          selections: [
            {
              guid: 'sel-delivery',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 6,
              item: { guid: 'item-delivery', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
    {
      guid: 'order-takeout',
      createdDate: '2024-01-01T12:00:00.000+0000',
      orderType: 'Takeout',
      checks: [
        {
          guid: 'check-takeout',
          selections: [
            {
              guid: 'sel-takeout',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 7,
              item: { guid: 'item-takeout', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const response = await handler(createEnv(), new Request('https://worker.test/api/items-expanded?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  const curbside = body.orders.find((order) => order.orderId === 'order-curbside');
  const delivery = body.orders.find((order) => order.orderId === 'order-delivery');
  const takeout = body.orders.find((order) => order.orderId === 'order-takeout');

  assert.ok(curbside, 'curbside order should be present');
  assert.ok(delivery, 'delivery order should be present');
  assert.ok(takeout, 'takeout order should be present');

  assert.equal(curbside.orderType, 'CURBSIDE');
  assert.equal(delivery.orderType, 'DELIVERY');
  assert.equal(takeout.orderType, 'TAKEOUT');
});
