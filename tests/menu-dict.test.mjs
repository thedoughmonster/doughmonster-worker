import test from 'node:test';
import assert from 'node:assert/strict';

const routeModule = await import('../dist/routes/api/menu/dict.js');
const toastModule = await import('../dist/clients/toast.js');
const { createMenuDictHandler } = routeModule;
const { getMenuItems, getSalesCategories } = toastModule;

function createEnv(overrides = {}) {
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
    ...overrides,
  };
}

test('getMenuItems uses pageToken query parameter', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({ menuItems: [] }),
      { headers: { 'Toast-Next-Page-Token': 'token-next' } }
    );
  };

  try {
    const env = createEnv({
      TOKEN_KV: {
        get: async () => ({ accessToken: 'cached', expiresAt: Date.now() + 120_000 }),
        put: async () => undefined,
      },
    });

    const result = await getMenuItems(env, { pageToken: 'abc123' });

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.ok(call.url.includes('pageToken=abc123'));
    assert.ok(!('Toast-Next-Page-Token' in (call.init.headers ?? {})));
    assert.equal(result.nextPageToken, 'token-next');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getSalesCategories uses pageToken query parameter', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({ salesCategories: [] }),
      { headers: { 'Toast-Next-Page-Token': 'token-next' } }
    );
  };

  try {
    const env = createEnv({
      TOKEN_KV: {
        get: async () => ({ accessToken: 'cached', expiresAt: Date.now() + 120_000 }),
        put: async () => undefined,
      },
    });

    const result = await getSalesCategories(env, { pageToken: 'def456' });

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.ok(call.url.includes('pageToken=def456'));
    assert.ok(!('Toast-Next-Page-Token' in (call.init.headers ?? {})));
    assert.equal(result.nextPageToken, 'token-next');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('menu/dict returns normalized menu items in array mode', async () => {
  const pageCalls = [];
  const categoryCalls = [];
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
    async getSalesCategories(_env, params = {}) {
      categoryCalls.push(params.pageToken ?? null);
      return {
        categories: [
          { guid: 'cat-1', name: 'Coffee & Espresso' },
          { salesCategoryGuid: 'cat-2', salesCategoryName: 'Tea' },
        ],
        nextPageToken: null,
      };
    },
  });

  const request = new Request(
    'https://worker.test/api/menu/dict?lastModified=2023-10-01T00:00:00Z&as=array'
  );
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
  assert.deepEqual(categoryCalls, [null]);
});

test('menu/dict returns dictionary by default', async () => {
  const handler = createMenuDictHandler({
    async getMenuItems() {
      return {
        items: [
          { guid: 'item-1', name: 'Coffee', salesCategoryGuid: 'cat-1' },
          { guid: 'item-2', name: 'Tea', salesCategoryGuid: 'cat-2' },
        ],
        nextPageToken: null,
      };
    },
    async getSalesCategories() {
      return {
        categories: [
          { guid: 'cat-1', name: 'Coffee & Espresso' },
          { guid: 'cat-2', name: 'Tea' },
        ],
        nextPageToken: null,
      };
    },
  });

  const request = new Request('https://worker.test/api/menu/dict');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.deepEqual(body.data, {
    'item-1': {
      guid: 'item-1',
      name: 'Coffee',
      basePrice: null,
      salesCategoryName: 'Coffee & Espresso',
      multiLocationId: null,
    },
    'item-2': {
      guid: 'item-2',
      name: 'Tea',
      basePrice: null,
      salesCategoryName: 'Tea',
      multiLocationId: null,
    },
  });
});

test('menu/dict surfaces Toast entitlement errors', async () => {
  const handler = createMenuDictHandler({
    async getMenuItems() {
      const error = new Error('missing entitlement');
      error.status = 404;
      error.bodySnippet = JSON.stringify({ code: 10022 });
      error.toastRequestId = 'toast-req-123';
      throw error;
    },
    async getSalesCategories() {
      return { categories: [], nextPageToken: null };
    },
  });

  const request = new Request('https://worker.test/api/menu/dict');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.route, '/api/menu/dict');
  assert.equal(body.error, 'toast_configuration_not_available');
  assert.equal(
    body.hint,
    'Enable Configuration API (config:read) or Menus V2 (menus:read) for this client.'
  );
  assert.equal(body.toastRequestId, 'toast-req-123');
});
