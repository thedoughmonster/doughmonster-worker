import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/orders-detailed.js');
const { createOrdersDetailedHandler } = module;

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
  const { getDiningOptions, diningOptions, fetch: customFetch, menuCacheHit = false, menuMetadata } =
    overrides;

  const resolveUrl = (input) => {
    if (typeof input === 'string') {
      return new URL(input, 'https://worker.test');
    }
    if (input instanceof URL) {
      return new URL(input.toString());
    }
    if (input && typeof input.url === 'string') {
      return new URL(input.url);
    }
    return new URL(String(input), 'https://worker.test');
  };

  const resolveOrdersData = (url) => {
    if (typeof orders === 'function') {
      return orders(url);
    }
    return orders;
  };

  const defaultFetch = async (input, init) => {
    const url = resolveUrl(input);

    if (url.origin === 'https://toast.example' && url.pathname === '/orders/v2/ordersBulk') {
      const raw = resolveOrdersData(url);
      const data = Array.isArray(raw) ? raw : [];
      const responseBody = {
        orders: JSON.parse(JSON.stringify(data)),
        totalCount: data.length,
        page: Number(url.searchParams.get('page') ?? '1'),
        pageSize: Number(url.searchParams.get('pageSize') ?? String(data.length || 100)),
        nextPage: null,
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.origin === 'https://toast.example' && url.pathname === '/auth') {
      return new Response(
        JSON.stringify({
          token: {
            accessToken: 'test-token',
            tokenType: 'Bearer',
            expiresIn: 3600,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.pathname === '/api/orders/latest') {
      const raw = resolveOrdersData(url);
      const data = Array.isArray(raw) ? raw : [];
      const cloned = JSON.parse(JSON.stringify(data));
      return new Response(
        JSON.stringify({ ok: true, detail: 'full', data: cloned }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.pathname === '/api/menus') {
      const metadata =
        menuMetadata && typeof menuMetadata === 'object'
          ? menuMetadata
          : { lastUpdated: '2024-01-01T00:00:00Z' };
      return new Response(
        JSON.stringify({
          ok: true,
          metadata,
          menu: menuDoc,
          cacheHit: Boolean(menuCacheHit),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (typeof customFetch === 'function') {
      return customFetch(input, init);
    }

    throw new Error(`Unexpected fetch to ${url.pathname}`);
  };

  const fetchImpl =
    typeof customFetch === 'function'
      ? (input, init) => customFetch(input, init, defaultFetch)
      : defaultFetch;

  const handler = createOrdersDetailedHandler({
    fetch: fetchImpl,
    async getDiningOptions(env) {
      if (typeof getDiningOptions === 'function') {
        return getDiningOptions(env);
      }
      return Array.isArray(diningOptions) ? diningOptions : [];
    },
  });

  return async (env, request) => {
    const runtimeEnv = { ...env };
    const cacheStore = new Map();
    const menuPayload = menuDoc ?? null;
    const metadataObject =
      menuMetadata && typeof menuMetadata === 'object'
        ? menuMetadata
        : { lastUpdated: '2024-01-01T00:00:00Z' };
    const updatedAtRaw = typeof metadataObject.lastUpdated === 'string'
      ? metadataObject.lastUpdated
      : '2024-01-01T00:00:00Z';
    const updatedAtMs = Date.parse(updatedAtRaw);
    const baseMs = Number.isNaN(updatedAtMs) ? Date.now() : updatedAtMs;
    const staleAt = new Date(baseMs + 30 * 60 * 1000).toISOString();
    const expireAt = new Date(baseMs + 24 * 60 * 60 * 1000).toISOString();

    cacheStore.set('menu:published:v1', JSON.stringify(menuPayload));
    cacheStore.set(
      'menu:published:meta:v1',
      JSON.stringify({ updatedAt: updatedAtRaw, staleAt, expireAt })
    );

    runtimeEnv.CACHE_KV = {
      async get(key) {
        return cacheStore.has(key) ? cacheStore.get(key) : null;
      },
      async put(key, value) {
        cacheStore.set(key, value);
        return undefined;
      },
      async delete(key) {
        cacheStore.delete(key);
        return undefined;
      },
      async list() {
        return {
          keys: Array.from(cacheStore.keys()).map((name) => ({
            name,
            expiration: null,
            metadata: null,
          })),
          list_complete: true,
          cursor: null,
          cacheStatus: null,
        };
      },
    };
    runtimeEnv.__TEST_GET_ORDERS_BULK = async (_env, params) => {
      const fakeUrl = new URL('/api/orders/latest', 'https://worker.test');
      if (params.startIso) fakeUrl.searchParams.set('start', params.startIso);
      if (params.endIso) fakeUrl.searchParams.set('end', params.endIso);
      const resolved = resolveOrdersData(fakeUrl);
      const data = Array.isArray(resolved) ? resolved : [];
      const cloned = JSON.parse(JSON.stringify(data));
      const pageSizeInput = params.pageSize ?? (cloned.length || 100);
      const pageSize = Number(pageSizeInput) || cloned.length || 100;
      return {
        orders: cloned,
        totalCount: cloned.length,
        page: params.page,
        pageSize,
        nextPage: null,
        raw: { orders: cloned, totalCount: cloned.length, page: params.page, pageSize, nextPage: null },
        responseHeaders: {},
      };
    };
    return handler(runtimeEnv, request);
  };
}

test('orders-detailed calculates modifier totals with quantities and exposes modifier quantity', async () => {
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
    new Request('https://worker.test/api/orders-detailed?limit=50')
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

test('orders-detailed collapses identical modifiers on a single item into one entry', async () => {
  const orders = [
    {
      guid: 'order-modifiers-collapsed',
      createdDate: '2024-01-01T12:02:00.000+0000',
      checks: [
        {
          guid: 'check-modifiers-collapsed',
          selections: [
            {
              guid: 'sel-modifiers-collapsed',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 4,
              item: { guid: 'item-collapsed' },
              modifiers: [
                {
                  guid: 'dup-1',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.4,
                  optionGroup: { name: 'Extras' },
                  item: { guid: 'mod-identical' },
                },
                {
                  guid: 'dup-2',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.4,
                  optionGroup: { name: 'Extras' },
                  item: { guid: 'mod-identical' },
                },
                {
                  guid: 'dup-3',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.4,
                  optionGroup: { name: 'Extras' },
                  item: { guid: 'mod-identical' },
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const response = await handler(createEnv(), new Request('https://worker.test/api/orders-detailed?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);

  const [order] = body.orders;
  const [item] = order.items;
  assert.equal(item.modifiers.length, 1);
  assert.equal(item.modifiers[0].id, 'mod-identical');
  assert.equal(item.modifiers[0].quantity, 3);
  assert.equal(item.modifiers[0].priceCents, 120);
  assert.equal(item.money.modifierTotalCents, 120);
  assert.equal(
    item.money.modifierTotalCents,
    item.modifiers.reduce((sum, mod) => sum + mod.priceCents, 0)
  );
});

test('orders-detailed collapses duplicate modifiers emitted separately', async () => {
  const orders = [
    {
      guid: 'order-duplicate-modifiers',
      createdDate: '2024-01-01T12:05:00.000+0000',
      checks: [
        {
          guid: 'check-duplicate-modifiers',
          selections: [
            {
              guid: 'sel-duplicate-item',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 9,
              item: { guid: 'item-duplicate' },
              modifiers: [
                {
                  guid: 'sel-duplicate-mod-1',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.5,
                  optionGroup: { name: 'Toppings' },
                  item: { guid: 'mod-cheese' },
                },
                {
                  guid: 'sel-duplicate-mod-2',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.5,
                  optionGroup: { name: 'Toppings' },
                  item: { guid: 'mod-cheese' },
                },
                {
                  guid: 'sel-duplicate-mod-unique',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 1.25,
                  optionGroup: { name: 'Toppings' },
                  item: { guid: 'mod-bacon' },
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
    new Request('https://worker.test/api/orders-detailed?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  const item = body.orders[0].items[0];
  assert.equal(item.modifiers.length, 2);
  assert.equal(item.modifiers[0].id, 'mod-bacon');
  assert.equal(item.modifiers[0].groupName, 'Toppings');
  assert.equal(item.modifiers[0].quantity, 1);
  assert.equal(item.modifiers[0].priceCents, 125);
  assert.equal(item.modifiers[1].id, 'mod-cheese');
  assert.equal(item.modifiers[1].quantity, 2);
  assert.equal(item.modifiers[1].priceCents, 100);
  assert.equal(item.money.modifierTotalCents, 225);
  assert.equal(
    item.money.modifierTotalCents,
    item.modifiers.reduce((sum, mod) => sum + mod.priceCents, 0)
  );
});

test('orders-detailed collapses duplicate modifiers without ids using name and group fallback', async () => {
  const orders = [
    {
      guid: 'order-duplicate-noid',
      createdDate: '2024-01-01T12:10:00.000+0000',
      checks: [
        {
          guid: 'check-duplicate-noid',
          selections: [
            {
              guid: 'sel-duplicate-noid',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 6,
              item: { guid: 'item-noid' },
              modifiers: [
                {
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.75,
                  displayName: 'Extra Sauce',
                  optionGroup: { name: 'Sauces' },
                  item: { itemType: 'MODIFIER' },
                },
                {
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.75,
                  displayName: 'Extra Sauce',
                  optionGroup: { name: 'Sauces' },
                  item: { itemType: 'MODIFIER' },
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
    new Request('https://worker.test/api/orders-detailed?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  const item = body.orders[0].items[0];
  assert.equal(item.modifiers.length, 1);
  assert.equal(item.modifiers[0].name, 'Extra Sauce');
  assert.equal(item.modifiers[0].groupName, 'Sauces');
  assert.equal(item.modifiers[0].quantity, 2);
  assert.equal(item.modifiers[0].priceCents, 150);
  assert.equal(item.money.modifierTotalCents, 150);
});

test('orders-detailed collapses duplicate nested modifiers after flattening', async () => {
  const orders = [
    {
      guid: 'order-nested-duplicates',
      createdDate: '2024-01-01T12:15:00.000+0000',
      checks: [
        {
          guid: 'check-nested-duplicates',
          selections: [
            {
              guid: 'sel-nested-parent',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 11,
              item: { guid: 'item-nested' },
              modifiers: [
                {
                  guid: 'sel-nested-parent-mod',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0,
                  item: { guid: 'mod-parent' },
                  modifiers: [
                    {
                      guid: 'sel-nested-child-1',
                      selectionType: 'MENU_ITEM',
                      quantity: 1,
                      price: 0.4,
                      optionGroup: { name: 'Sauces' },
                      item: { guid: 'mod-child' },
                    },
                    {
                      guid: 'sel-nested-child-2',
                      selectionType: 'MENU_ITEM',
                      quantity: 1,
                      price: 0.4,
                      optionGroup: { name: 'Sauces' },
                      item: { guid: 'mod-child' },
                    },
                  ],
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
    new Request('https://worker.test/api/orders-detailed?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  const item = body.orders[0].items[0];
  assert.equal(item.modifiers.length, 2);
  const child = item.modifiers.find((mod) => mod.id === 'mod-child');
  assert.ok(child);
  assert.equal(child.quantity, 2);
  assert.equal(child.priceCents, 80);
  assert.equal(
    item.money.modifierTotalCents,
    item.modifiers.reduce((sum, mod) => sum + mod.priceCents, 0)
  );
});

test('orders-detailed exposes orderData block with required metadata as first key', async () => {
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
    new Request('https://worker.test/api/orders-detailed?limit=50')
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
  assert.equal(data.orderTypeNormalized, 'TAKEOUT');
  assert.equal(data.diningOptionGuid, 'dining-1');
  assert.equal('deliveryInfo' in data, false);
  assert.equal(order.orderId, undefined);
  assert.equal(order.orderNumber, undefined);
  assert.equal(order.orderType, undefined);
  assert.equal(order.location, undefined);
  assert.equal(order.times, undefined);
  assert.equal(order.status, undefined);
  assert.equal(order.customerName, undefined);
  assert.equal(order.checkId, undefined);
  assert.equal(order.diningOptionGuid, undefined);
  assert.equal(order.fulfillmentStatus, undefined);
});

test('orders-detailed prefers catalog dining option labels when available', async () => {
  const orders = [
    {
      guid: 'order-catalog-label',
      createdDate: '2024-01-01T14:00:00.000+0000',
      context: { diningOption: { guid: 'dining-catalog-guid', behavior: 'TAKE_OUT' } },
      checks: [
        {
          guid: 'check-catalog-label',
          selections: [
            {
              guid: 'sel-catalog-label',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 10,
              item: { guid: 'item-catalog-label', itemType: 'MENU_ITEM' },
            },
          ],
        },
      ],
    },
  ];

  const diningOptions = [
    {
      guid: 'dining-catalog-guid',
      behavior: 'DoorDash - Delivery',
      name: 'DoorDash - Delivery',
    },
  ];

  const handler = createHandlerWithOrders(orders, null, { diningOptions });
  const response = await handler(
    createEnv(),
    new Request('https://worker.test/api/orders-detailed?limit=25')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  const [order] = body.orders;

  assert.equal(order.orderData.diningOptionGuid, 'dining-catalog-guid');
  assert.equal(order.orderData.orderType, 'DoorDash - Delivery');
  assert.equal(order.orderData.orderTypeNormalized, 'DELIVERY');
  assert.equal(order.orderData.diningOptionBehavior, 'DoorDash - Delivery');
  assert.equal(order.orderData.diningOptionName, 'DoorDash - Delivery');
});

test('orders-detailed filters out special requests and fees from items array', async () => {
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
    new Request('https://worker.test/api/orders-detailed?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].items.length, 1);
  assert.equal(body.orders[0].items[0].lineItemId, 'sel-real');
});

test('orders-detailed derives order type from dining option configuration when behavior is missing', async () => {
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
    new Request('https://worker.test/api/orders-detailed?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  const order = body.orders[0];
  assert.equal(order.orderData.orderType, 'Curbside Pickup');
  assert.equal(order.orderData.orderTypeNormalized, 'CURBSIDE');
  assert.equal(order.orderData.diningOptionGuid, 'option-guid');
  assert.equal(lookupCalls, 1);
});

test('orders-detailed uses customer name fallbacks when direct customer data is missing', async () => {
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
    new Request('https://worker.test/api/orders-detailed?limit=50')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].customerName, undefined);
  assert.equal(body.orders[0].orderData.customerName, 'VIP Table');
});

test('orders-detailed resolves totals using the higher of upstream and computed values', async () => {
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
  const response = await handler(createEnv(), new Request('https://worker.test/api/orders-detailed?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  const money = body.orders[0].items[0].money;
  assert.equal(money.baseItemPriceCents, 200);
  assert.equal(money.modifierTotalCents, 50);
  assert.equal(money.totalItemPriceCents, 250);
});

test('orders-detailed maintains totals when modifiers are deduplicated', async () => {
  const orders = [
    {
      guid: 'order-total-dedup',
      createdDate: '2024-01-01T15:30:00.000+0000',
      checks: [
        {
          guid: 'check-total-dedup',
          selections: [
            {
              guid: 'sel-total-dedup',
              selectionType: 'MENU_ITEM',
              quantity: 2,
              receiptLinePrice: 5,
              price: 12,
              item: { guid: 'item-total-dedup', itemType: 'MENU_ITEM' },
              modifiers: [
                {
                  guid: 'mod-total-a',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.5,
                  item: { guid: 'mod-total', itemType: 'MENU_ITEM' },
                },
                {
                  guid: 'mod-total-b',
                  selectionType: 'MENU_ITEM',
                  quantity: 1,
                  price: 0.5,
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
  const response = await handler(createEnv(), new Request('https://worker.test/api/orders-detailed?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);

  const [order] = body.orders;
  assert.equal(order.totals.baseItemsSubtotalCents, 1000);
  assert.equal(order.totals.modifiersSubtotalCents, 200);
  assert.equal(order.totals.grandTotalCents, 1200);
  const [item] = order.items;
  assert.equal(item.modifiers.length, 1);
  assert.equal(item.modifiers[0].priceCents, 200);
  assert.equal(item.money.modifierTotalCents, 200);
});

test('orders-detailed derives order type from available metadata', async () => {
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
  const response = await handler(createEnv(), new Request('https://worker.test/api/orders-detailed?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  const curbside = body.orders.find((order) => order.orderData.orderId === 'order-curbside');
  const delivery = body.orders.find((order) => order.orderData.orderId === 'order-delivery');
  const takeout = body.orders.find((order) => order.orderData.orderId === 'order-takeout');

  assert.ok(curbside, 'curbside order should be present');
  assert.ok(delivery, 'delivery order should be present');
  assert.ok(takeout, 'takeout order should be present');

  assert.equal(curbside.orderData.orderType, 'CURBSIDE');
  assert.equal(curbside.orderData.orderTypeNormalized, 'CURBSIDE');
  assert.equal(delivery.orderData.orderType, 'DELIVERY');
  assert.equal(delivery.orderData.orderTypeNormalized, 'DELIVERY');
  assert.equal(takeout.orderData.orderType, 'TAKEOUT');
  assert.equal(takeout.orderData.orderTypeNormalized, 'TAKEOUT');
});

test('orders-detailed includes behavior-specific enrichment data when available', async () => {
  const orders = [
    {
      guid: 'order-delivery',
      createdDate: '2024-01-01T17:00:00.000+0000',
      deliveryInfo: { deliveryState: 'IN_PROGRESS' },
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
  const response = await handler(createEnv(), new Request('https://worker.test/api/orders-detailed?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 4);

  const byId = Object.fromEntries(body.orders.map((order) => [order.orderData.orderId, order]));

  const delivery = byId['order-delivery'];
  assert.ok(delivery.orderData.deliveryInfo, 'delivery info should be present');
  assert.equal(delivery.orderData.deliveryInfo.recipientName, 'Alex Recipient');
  assert.equal(delivery.orderData.deliveryInfo.address1, '123 Main St');
  assert.equal(delivery.orderData.deliveryInfo.notes, 'Leave at door');
  assert.equal(delivery.orderData.deliveryInfo.quotedDeliveryDate, '2024-01-01T18:30:00.000+0000');
  assert.equal(delivery.orderData.deliveryState, 'IN_PROGRESS');

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

test('orders-detailed exposes aggregated fulfillment status on orderData', async () => {
  const orders = [
    {
      guid: 'order-fulfillment-status',
      createdDate: '2024-01-01T12:25:00.000+0000',
      checks: [
        {
          guid: 'check-fulfillment-status',
          fulfillmentStatus: 'HOLD',
          selections: [
            {
              guid: 'sel-fulfillment-new',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 5,
              price: 5,
              item: { guid: 'item-fulfillment-new' },
              fulfillmentStatus: 'NEW',
            },
            {
              guid: 'sel-fulfillment-ready',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 7,
              price: 7,
              item: { guid: 'item-fulfillment-ready' },
              fulfillmentStatus: 'READY',
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const response = await handler(createEnv(), new Request('https://worker.test/api/orders-detailed?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);

  const [order] = body.orders;
  assert.equal(order.orderData.fulfillmentStatus, 'IN_PREPARATION');
  const statuses = order.items.map((item) => item.fulfillmentStatus);
  assert.deepEqual(statuses, ['NEW', 'READY']);
});

test('orders-detailed keeps newest qualifying orders and item order stable across polls', async () => {
  const orders = [
    {
      guid: 'order-new-2',
      createdDate: '2024-01-01T12:30:00.000+0000',
      checks: [
        {
          guid: 'order-new-2-check',
          selections: [
            {
              guid: 'sel-new-2',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 9,
              item: { guid: 'item-new-2' },
            },
          ],
        },
      ],
    },
    {
      guid: 'order-non-1',
      createdDate: '2024-01-01T12:15:00.000+0000',
      checks: [
        {
          guid: 'order-non-1-check',
          selections: [],
        },
      ],
    },
    {
      guid: 'order-new-3',
      createdDate: '2024-01-01T12:00:00.000+0000',
      checks: [
        {
          guid: 'order-new-3-check',
          selections: [
            {
              selectionType: 'OPEN_ITEM',
              displayName: 'Chef Special',
              quantity: 1,
              receiptLinePrice: 7,
              selectionIndex: 3,
              item: {},
            },
          ],
        },
      ],
    },
    {
      guid: 'order-non-2',
      createdDate: '2024-01-01T11:45:00.000+0000',
      checks: [
        {
          guid: 'order-non-2-check',
          selections: [],
        },
      ],
    },
    {
      guid: 'order-new-1',
      createdDate: '2024-01-01T13:00:00.000+0000',
      checks: [
        {
          guid: 'order-new-1-check',
          selections: [
            {
              guid: 'sel-b',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 4,
              receiptLinePosition: 2,
              selectionIndex: 2,
              item: { guid: 'item-b' },
            },
            {
              selectionType: 'OPEN_ITEM',
              displayName: 'Daily Special',
              quantity: 1,
              receiptLinePrice: 3,
              receiptLinePosition: 3,
              selectionIndex: 3,
              item: {},
            },
            {
              guid: 'sel-a',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 5,
              receiptLinePosition: 1,
              selectionIndex: 1,
              item: { guid: 'item-a' },
            },
          ],
        },
      ],
    },
    {
      guid: 'order-old',
      createdDate: '2024-01-01T11:00:00.000+0000',
      checks: [
        {
          guid: 'order-old-check',
          selections: [
            {
              guid: 'sel-old',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 2,
              item: { guid: 'item-old' },
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const env = createEnv();
  const request = new Request('https://worker.test/api/orders-detailed?limit=3');

  const responseA = await handler(env, request);
  const bodyA = await responseA.json();

  assert.equal(responseA.status, 200);
  assert.equal(bodyA.orders.length, 3);
  assert.deepEqual(
    bodyA.orders.map((order) => order.orderData.orderId),
    ['order-new-1', 'order-new-2', 'order-new-3']
  );
  const topItemsA = bodyA.orders[0].items.map((item) => item.lineItemId);

  const responseB = await handler(env, request);
  const bodyB = await responseB.json();

  assert.equal(responseB.status, 200);
  assert.deepEqual(
    bodyB.orders.map((order) => order.orderData.orderId),
    ['order-new-1', 'order-new-2', 'order-new-3']
  );
  assert.deepEqual(
    bodyB.orders[0].items.map((item) => item.lineItemId),
    topItemsA
  );
});

test('orders-detailed reports READY_FOR_PICKUP when all selections are ready', async () => {
  const orders = [
    {
      guid: 'order-fulfillment-ready',
      createdDate: '2024-01-01T12:40:00.000+0000',
      checks: [
        {
          guid: 'check-fulfillment-ready',
          selections: [
            {
              guid: 'sel-ready-1',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 4,
              price: 4,
              item: { guid: 'item-ready-1' },
              fulfillmentStatus: 'READY',
            },
            {
              guid: 'sel-ready-2',
              selectionType: 'MENU_ITEM',
              quantity: 2,
              receiptLinePrice: 3,
              price: 6,
              item: { guid: 'item-ready-2' },
              fulfillmentStatus: 'READY',
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const response = await handler(createEnv(), new Request('https://worker.test/api/orders-detailed?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);

  const [order] = body.orders;
  assert.equal(order.orderData.fulfillmentStatus, 'READY_FOR_PICKUP');
  assert.deepEqual(order.items.map((item) => item.fulfillmentStatus), ['READY', 'READY']);
});

test('orders-detailed sorts candidates before building orders and reports diagnostics', async () => {
  const orders = [
    {
      guid: 'order-low',
      createdDate: '2024-01-01T09:00:00.000+0000',
      checks: [
        {
          guid: 'check-low',
          selections: [
            {
              guid: 'sel-low',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 3,
              item: { guid: 'item-low' },
            },
          ],
        },
      ],
    },
    {
      guid: 'order-empty',
      createdDate: '2024-01-01T14:00:00.000+0000',
      checks: [
        {
          guid: 'check-empty',
          selections: [
            {
              guid: 'sel-empty',
              selectionType: 'FEE',
              quantity: 1,
              receiptLinePrice: 2,
            },
          ],
        },
      ],
    },
    {
      guid: 'order-high-a',
      createdDate: '2024-01-01T16:00:00.000+0000',
      checks: [
        {
          guid: 'check-high-a',
          selections: [
            {
              guid: 'sel-high-a',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 5,
              item: { guid: 'item-high-a' },
            },
          ],
        },
      ],
    },
    {
      guid: 'order-high-b',
      createdDate: '2024-01-01T13:00:00.000+0000',
      checks: [
        {
          guid: 'check-high-b',
          selections: [
            {
              guid: 'sel-high-b',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 4,
              item: { guid: 'item-high-b' },
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const request = new Request('https://worker.test/api/orders-detailed?limit=2&debug=1');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.orders.map((order) => order.orderData.orderId),
    ['order-high-a', 'order-high-b']
  );
  assert.equal(body.orders.length, 2);
  assert.equal(body.orders[0].items.length, 1);
  assert.equal(body.orders[1].items.length, 1);
  assert.equal(body.debug.diagnostics.ordersSeen, 4);
  assert.equal(body.debug.diagnostics.checksSeen, 4);
  assert.equal(body.debug.diagnostics.itemsIncluded, 2);
});

test('orders-detailed prioritizes webhook-derived fulfillment status over selection states', async () => {
  const orders = [
    {
      guid: 'order-fulfillment-webhook',
      createdDate: '2024-01-01T12:45:00.000+0000',
      context: {
        guestOrderFulfillmentStatusHistory: [
          { status: 'IN_PREPARATION' },
          { status: 'READY_FOR_PICKUP' },
        ],
      },
      checks: [
        {
          guid: 'check-fulfillment-webhook',
          selections: [
            {
              guid: 'sel-webhook-1',
              selectionType: 'MENU_ITEM',
              quantity: 1,
              receiptLinePrice: 5,
              price: 5,
              item: { guid: 'item-webhook-1' },
              fulfillmentStatus: 'HOLD',
            },
          ],
        },
      ],
    },
  ];

  const handler = createHandlerWithOrders(orders);
  const response = await handler(createEnv(), new Request('https://worker.test/api/orders-detailed?limit=50'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);

  const [order] = body.orders;
  assert.equal(order.orderData.fulfillmentStatus, 'READY_FOR_PICKUP');
  assert.deepEqual(order.items.map((item) => item.fulfillmentStatus), ['HOLD']);
});

test('orders-detailed surfaces menu cache info and upstream diagnostics', async () => {
  const handler = createHandlerWithOrders([], { menus: [] }, { menuCacheHit: true });
  const request = new Request('https://worker.test/api/orders-detailed?debug=1&limit=5');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(body.orders), true);
  assert.equal(body.orders.length, 0);
  assert.equal(body.cacheInfo.menu, 'hit-fresh');
  assert.equal(body.cacheInfo.menuUpdatedAt, '2024-01-01T00:00:00Z');
  assert.equal(typeof body.debug, 'object');
  assert.equal(body.debug.menuUpstream.ok, true);
  assert.equal(body.debug.menuUpstream.status, 200);
  assert.equal(typeof body.debug.menuUpstream.absoluteUrl, 'string');
  assert.ok(body.debug.menuUpstream.absoluteUrl.includes('/api/menus'));
  assert.equal(body.debug.menuUpstream.snippet, null);
});

test('menu index cache reuses indexes for matching metadata', async () => {
  const menuIndexModule = await import('../dist/routes/orders-detailed/menu-index.js');
  menuIndexModule.resetMenuIndexCacheForTests();

  const buildDocument = () => ({
    modifierOptionReferences: {},
    menus: [
      {
        menuGroups: [
          {
            items: [
              {
                guid: 'item-1',
                name: 'Latte',
                multiLocationId: 101,
                referenceId: 1001,
              },
            ],
            menuGroups: [],
          },
        ],
      },
    ],
  });

  const firstDoc = buildDocument();
  const firstIndex = menuIndexModule.getCachedMenuIndex(firstDoc, '2024-01-01T00:00:00Z');
  const secondIndex = menuIndexModule.getCachedMenuIndex(buildDocument(), '2024-01-01T00:00:00Z');
  assert.strictEqual(firstIndex, secondIndex);

  const thirdIndex = menuIndexModule.getCachedMenuIndex(buildDocument(), '2024-01-02T00:00:00Z');
  assert.notStrictEqual(secondIndex, thirdIndex);

  const fallbackFirst = menuIndexModule.getCachedMenuIndex(buildDocument(), null);
  const fallbackSecond = menuIndexModule.getCachedMenuIndex(buildDocument(), null);
  assert.strictEqual(fallbackFirst, fallbackSecond);

  menuIndexModule.getCachedMenuIndex(null, null);
  const fallbackAfterReset = menuIndexModule.getCachedMenuIndex(buildDocument(), null);
  assert.notStrictEqual(fallbackSecond, fallbackAfterReset);

  menuIndexModule.resetMenuIndexCacheForTests();
});
