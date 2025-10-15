import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/api/orders/latest-with-menu.js');
const { createOrdersLatestWithMenuHandler } = module;

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

test('orders/latest-with-menu enriches selections with menu data', async () => {
  const menuDocument = {
    restaurantGuid: 'restaurant-guid',
    lastUpdated: '2024-01-01T00:00:00Z',
    menus: [
      {
        guid: 'menu-1',
        name: 'Lunch',
        menuGroups: [
          {
            guid: 'group-1',
            name: 'Pizzas',
            items: [
              {
                guid: 'item-1',
                name: 'Margherita',
                description: 'Tomato, mozzarella, basil',
                price: 1299,
              },
            ],
          },
        ],
      },
    ],
    modifierGroupReferences: {
      'mod-group-1': {
        guid: 'mod-group-1',
        name: 'Toppings',
        options: [
          {
            guid: 'option-1',
            name: 'Extra Cheese',
            price: 199,
          },
        ],
      },
    },
    modifierOptionReferences: {},
    preModifierGroupReferences: {
      'pre-group-1': {
        guid: 'pre-group-1',
        name: 'Bake',
        options: [
          {
            guid: 'pre-option-1',
            name: 'Well Done',
          },
        ],
      },
    },
  };

  const order = {
    guid: 'order-1',
    modifiedDate: '2024-02-02T10:00:00Z',
    checks: [
      {
        guid: 'check-1',
        selections: [
          {
            guid: 'selection-1',
            item: { guid: 'item-1' },
            itemGroup: null,
            quantity: 2,
            selectionType: 'NONE',
            modifiers: [
              {
                guid: 'selection-2',
                item: { guid: 'option-1' },
                itemGroup: null,
                optionGroup: { guid: 'mod-group-1' },
                quantity: 1,
                selectionType: 'MODIFIER',
                modifiers: [],
              },
            ],
            preModifier: { guid: 'pre-option-1' },
          },
        ],
      },
    ],
  };

  const handler = createOrdersLatestWithMenuHandler({
    async getOrdersBulk(_env, params) {
      assert.equal(params.page, 1);
      return { orders: [order], nextPage: null };
    },
    async fetchPublishedMenu() {
      return { metadata: { restaurantGuid: 'restaurant-guid', lastUpdated: '2024-01-01T00:00:00Z' }, menu: menuDocument, cacheHit: false };
    },
  });

  const request = new Request('https://worker.test/api/orders/latest-with-menu?minutes=15');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.route, '/api/orders/latest-with-menu');
  assert.equal(body.count, 1);
  assert.equal(body.menu.metadata.lastUpdated, '2024-01-01T00:00:00Z');
  assert.equal(body.menu.hasMenu, true);
  assert.equal(body.lineItems.length, 2);

  const enrichedOrder = body.data[0];
  assert.equal(enrichedOrder.checks[0].selections[0].menuItem.name, 'Margherita');
  assert.equal(enrichedOrder.checks[0].selections[0].menuItemPath.menuName, 'Lunch');
  assert.equal(enrichedOrder.checks[0].selections[0].preModifierOption.name, 'Well Done');
  assert.equal(
    enrichedOrder.checks[0].selections[0].modifiers[0].modifierOption.name,
    'Extra Cheese'
  );

  const modifierLineItem = body.lineItems.find((item) => item.selectionGuid === 'selection-2');
  assert.ok(modifierLineItem);
  assert.equal(modifierLineItem.humanReadableName, 'Extra Cheese');
  assert.equal(modifierLineItem.modifierGroup.name, 'Toppings');
});

test('orders/latest-with-menu returns 503 when menu metadata is unavailable', async () => {
  const handler = createOrdersLatestWithMenuHandler({
    async getOrdersBulk() {
      return { orders: [], nextPage: null };
    },
    async fetchPublishedMenu() {
      return null;
    },
  });

  const request = new Request('https://worker.test/api/orders/latest-with-menu');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.match(body.error, /No published menu/);
});
