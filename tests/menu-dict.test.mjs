import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/api/menu/dict.js');
const { createMenuDictHandler } = module;

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

test('menu/dict returns normalized menu items', async () => {
  const pageCalls = [];
  const handler = createMenuDictHandler({
    async getMenuItems(_env, params) {
      pageCalls.push(params.pageToken ?? null);
      if (!params.pageToken) {
        return {
          items: [
            {
              guid: 'item-1',
              name: 'Coffee',
              basePrice: 3.5,
              salesCategoryGuid: 'cat-1',
              multiLocationId: 'ml-1',
            },
          ],
          nextPageToken: 'token-2',
        };
      }

      return {
        items: [
          {
            menuItemGuid: 'item-2',
            displayName: 'Tea',
            priceInfo: { basePrice: '2.75' },
            salesCategory: { guid: 'cat-2' },
          },
          {
            itemGuid: 'item-3',
            menuItemName: 'Donut',
            price: { amount: 1.25 },
            salesCategoryGuid: 'cat-missing',
            multiLocationItemId: 'ml-3',
          },
          {
            menuItemGuid: null,
          },
        ],
        nextPageToken: null,
      };
    },
    async getSalesCategories() {
      return {
        categories: [
          { guid: 'cat-1', name: 'Coffee & Espresso' },
          { salesCategoryGuid: 'cat-2', salesCategoryName: 'Tea' },
        ],
      };
    },
  });

  const request = new Request('https://worker.test/api/menu/dict?lastModified=2023-10-01T00:00:00Z');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.route, '/api/menu/dict');
  assert.equal(body.lastModified, '2023-10-01T00:00:00Z');
  assert.equal(body.count, 3);
  assert.deepEqual(body.data, [
    {
      guid: 'item-1',
      name: 'Coffee',
      basePrice: 3.5,
      salesCategoryName: 'Coffee & Espresso',
      multiLocationId: 'ml-1',
    },
    {
      guid: 'item-2',
      name: 'Tea',
      basePrice: 2.75,
      salesCategoryName: 'Tea',
      multiLocationId: null,
    },
    {
      guid: 'item-3',
      name: 'Donut',
      basePrice: 1.25,
      salesCategoryName: null,
      multiLocationId: 'ml-3',
    },
  ]);
  assert.deepEqual(pageCalls, [null, 'token-2']);
});
