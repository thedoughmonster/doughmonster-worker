import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/api/menus.js');
const handleMenus = module.default;

function createMemoryKv(initial = new Map()) {
  const store = initial;
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function createEnvWithMenu(document, metaOverrides = {}) {
  const now = Date.now();
  const defaultMeta = {
    updatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
    staleAt: new Date(now + 25 * 60 * 1000).toISOString(),
    expireAt: new Date(now + 23 * 60 * 60 * 1000).toISOString(),
  };
  const meta = { ...defaultMeta, ...metaOverrides };
  const store = new Map();
  store.set('menu:published:v1', JSON.stringify(document ?? null));
  store.set('menu:published:meta:v1', JSON.stringify(meta));

  return {
    TOAST_API_BASE: 'https://toast.example',
    TOAST_AUTH_URL: 'https://toast.example/auth',
    TOAST_CLIENT_ID: 'id',
    TOAST_CLIENT_SECRET: 'secret',
    TOAST_RESTAURANT_GUID: 'restaurant-guid',
    TOKEN_KV: {
      async get() {
        return null;
      },
      async put() {
        return undefined;
      },
    },
    CACHE_KV: createMemoryKv(store),
  };
}

test('GET /api/menus returns cached menu with metadata and cache hit flag', async () => {
  const document = { menus: [{ guid: 'menu-1' }] };
  const updatedAt = '2024-10-01T12:00:00.000Z';
  const env = createEnvWithMenu(document, {
    updatedAt,
    staleAt: '2099-01-01T00:00:00.000Z',
    expireAt: '2099-01-02T00:00:00.000Z',
  });

  const response = await handleMenus(env, new Request('https://worker.test/api/menus'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.menu, document);
  assert.deepEqual(body.metadata, { lastUpdated: updatedAt });
  assert.equal(body.cacheHit, true);
});
