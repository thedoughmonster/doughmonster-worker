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

function createHandlerWithOrders(orders, menuDoc = null, overrides = {}) {
  const { getDiningOptions, diningOptions } = overrides;
  return createItemsExpandedHandler({
    async getOrdersBulk() {
      return { orders, nextPage: null };
    },
    async getPublishedMenus() {
      return menuDoc;
    },
    async getDiningOptions(env) {
      if (typeof getDiningOptions === 'function') {
        return getDiningOptions(env);
      }
      return Array.isArray(diningOptions) ? diningOptions : [];
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

test('items-expanded exposes orderData block with required metadata as first key', async () => {
  const orders = [
    {
      guid: 'order-data',
      createdDate: '2024-01-01T09:00:00.000+0000',
      promisedDate: '2024-01-01T09:30:00.000+0000',
      displayNumber: '42',
      status: 'APPROVED',
      restaurantLocationGuid: 'location-1',
      context: {
        diningOption: { guid: 'dining-1', behavior: 'TAKE_OUT' },
      },
      checks: [
        {
          guid: 'check-data',
          customer: { firstName: 'Sam', lastName: 'Guest' },
          selections: [
            {
              guid: 'sel-data',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 8,
              item: { guid: 'item-data', itemType: 'MENU_ITEM' },
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
  const order = body.orders[0];
  const keys = Object.keys(order);
  assert.equal(keys[0], 'orderData');

  const data = order.orderData;
  assert.equal(data.orderId, 'order-data');
  assert.deepEqual(data.location, { locationId: 'location-1' });
  assert.equal(data.orderTime, '2024-01-01T09:00:00.000+0000');
  assert.equal(data.timeDue, '2024-01-01T09:30:00.000+0000');
  assert.equal(data.orderNumber, '42');
  assert.equal(data.checkId, 'check-data');
  assert.equal(data.status, 'APPROVED');
  assert.equal(data.customerName, 'Sam Guest');
  assert.equal(data.orderType, 'TAKEOUT');
  assert.equal(data.diningOptionGuid, 'dining-1');
  assert.equal('deliveryInfo' in data, false);
  assert.equal(order.orderId, 'order-data');
  assert.equal(order.orderNumber, '42');
  assert.equal(order.orderData.customerName, 'Sam Guest');
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

test('items-expanded derives order type from dining option configuration when behavior is missing', async () => {
  let lookupCalls = 0;
  const orders = [
    {
      guid: 'order-config',
      createdDate: '2024-01-01T16:00:00.000+0000',
      context: {
        diningOption: { guid: 'option-guid' },
      },
      checks: [
        {
          guid: 'check-config',
          selections: [
            {
              guid: 'sel-config',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 4,
              item: { guid: 'item-config', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders, null, {
    async getDiningOptions() {
      lookupCalls += 1;
      return [{ guid: 'option-guid', behavior: 'CURBSIDE', name: 'Curbside Pickup' }];
    },
  });

  const response = await handler(
    createEnv(),
    new Request('https://worker.test/api/items-expanded?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  const order = body.orders[0];
  assert.equal(order.orderData.orderType, 'CURBSIDE');
  assert.equal(order.orderData.diningOptionGuid, 'option-guid');
  assert.equal(lookupCalls, 1);
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
  assert.equal(body.orders[0].orderData.customerName, 'VIP Table');
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
  assert.equal(curbside.orderData.orderType, 'CURBSIDE');
  assert.equal(delivery.orderType, 'DELIVERY');
  assert.equal(delivery.orderData.orderType, 'DELIVERY');
  assert.equal(takeout.orderType, 'TAKEOUT');
  assert.equal(takeout.orderData.orderType, 'TAKEOUT');
});

test('items-expanded includes behavior-specific enrichment data when available', async () => {
  const orders = [
    {
      guid: 'order-delivery',
      createdDate: '2024-01-01T17:00:00.000+0000',
      context: {
        diningOption: { guid: 'delivery-guid', behavior: 'DELIVERY' },
        deliveryInfo: {
          recipientName: 'Alex Recipient',
          address1: '123 Main St',
          city: 'Boston',
          state: 'MA',
          zipCode: '02101',
          notes: 'Leave at door',
          quotedDeliveryDate: '2024-01-01T18:30:00.000+0000',
        },
      },
      checks: [
        {
          guid: 'check-delivery-enrich',
          selections: [
            {
              guid: 'sel-delivery-enrich',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 9,
              item: { guid: 'item-delivery-enrich', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
    {
      guid: 'order-curbside-enrich',
      createdDate: '2024-01-01T17:05:00.000+0000',
      context: { diningOption: { guid: 'curb-guid', behavior: 'CURBSIDE' } },
      checks: [
        {
          guid: 'check-curbside-enrich',
          curbsidePickupInfo: {
            name: 'Jamie',
            transportColor: 'Blue',
            transportDescription: 'Honda Civic',
            notes: 'Trunk open',
          },
          selections: [
            {
              guid: 'sel-curbside-enrich',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 7,
              item: { guid: 'item-curbside-enrich', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
    {
      guid: 'order-dinein',
      createdDate: '2024-01-01T17:10:00.000+0000',
      context: { diningOption: { guid: 'dine-guid', behavior: 'DINE_IN' } },
      checks: [
        {
          guid: 'check-dinein',
          table: { guid: 'table-7', name: 'Table 7' },
          openedBy: { guid: 'server-1', name: 'Taylor' },
          selections: [
            {
              guid: 'sel-dinein',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 11,
              seatNumber: 2,
              item: { guid: 'item-dinein', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
    {
      guid: 'order-takeout-enrich',
      createdDate: '2024-01-01T17:15:00.000+0000',
      promisedDate: '2024-01-01T19:00:00.000+0000',
      estimatedFulfillmentDate: '2024-01-01T19:20:00.000+0000',
      context: { diningOption: { guid: 'take-guid', behavior: 'TAKE_OUT' } },
      checks: [
        {
          guid: 'check-takeout-enrich',
          selections: [
            {
              guid: 'sel-takeout-enrich',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 5,
              item: { guid: 'item-takeout-enrich', itemType: 'MENU_ITEM' },
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
  assert.equal(body.orders.length, 4);

  const byId = Object.fromEntries(body.orders.map((order) => [order.orderId, order]));

  const delivery = byId['order-delivery'];
  assert.ok(delivery.orderData.deliveryInfo, 'delivery info should be present');
  assert.equal(delivery.orderData.deliveryInfo.recipientName, 'Alex Recipient');
  assert.equal(delivery.orderData.deliveryInfo.address1, '123 Main St');
  assert.equal(delivery.orderData.deliveryInfo.notes, 'Leave at door');
  assert.equal(delivery.orderData.deliveryInfo.quotedDeliveryDate, '2024-01-01T18:30:00.000+0000');

  const curbside = byId['order-curbside-enrich'];
  assert.ok(curbside.orderData.curbsidePickupInfo);
  assert.equal(curbside.orderData.curbsidePickupInfo.transportColor, 'Blue');
  assert.equal(curbside.orderData.curbsidePickupInfo.transportDescription, 'Honda Civic');
  assert.equal(curbside.orderData.curbsidePickupInfo.notes, 'Trunk open');

  const dineIn = byId['order-dinein'];
  assert.ok(dineIn.orderData.table);
  assert.equal(dineIn.orderData.table.guid, 'table-7');
  assert.deepEqual(dineIn.orderData.seats, [2]);
  assert.equal(dineIn.orderData.employee.guid, 'server-1');

  const takeout = byId['order-takeout-enrich'];
  assert.equal(takeout.orderData.promisedDate, '2024-01-01T19:00:00.000+0000');
  assert.equal(takeout.orderData.estimatedFulfillmentDate, '2024-01-01T19:20:00.000+0000');
});
