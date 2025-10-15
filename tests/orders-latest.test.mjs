import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/api/orders/latest.js');
const { createOrdersLatestHandler } = module;

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

test('orders/latest returns sorted orders with deduped ids', async () => {
  const calls = [];
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params.page);
      if (params.page === 1) {
        return {
          orders: [
            { guid: 'order-b', updatedDate: '2023-10-10T12:00:00Z' },
            { guid: 'order-a', updatedDate: '2023-10-10T13:00:00Z' },
            { guid: 'order-a', updatedDate: '2023-10-10T11:00:00Z' },
          ],
          nextPage: null,
        };
      }
      return { orders: [], nextPage: null };
    },
  });

  const request = new Request('https://worker.test/api/orders/latest?minutes=5&debug=1');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 3);
  assert.deepEqual(body.ids, ['order-a', 'order-b']);
  assert.deepEqual(body.orders, ['order-a', 'order-b']);
  assert.equal(body.data[0].guid, 'order-a');
  assert.equal(body.data[1].guid, 'order-b');
  assert.ok(body.debug);
  assert.deepEqual(calls, [1]);
});

test('orders/latest handles empty windows', async () => {
  const handler = createOrdersLatestHandler({
    async getOrdersBulk() {
      return { orders: [], nextPage: null };
    },
  });

  const request = new Request('https://worker.test/api/orders/latest');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.count, 0);
  assert.deepEqual(body.orders, []);
  assert.deepEqual(body.data, []);
});
