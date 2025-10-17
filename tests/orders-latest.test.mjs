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

test('orders/latest returns deterministic, deduped latest orders', async () => {
  const calls = [];
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push({
        startIso: params.startIso,
        endIso: params.endIso,
        page: params.page,
      });
      return {
        orders: [
          { guid: 'order-b', createdDate: '2023-10-10T13:00:00+0000' },
          { guid: 'order-a', createdDate: '2023-10-10T13:00:00+0000' },
          { guid: 'order-a', createdDate: '2023-10-10T11:00:00+0000' },
          { guid: 'order-c', createdDate: '2023-10-09T12:00:00+0000', voided: true },
        ],
        nextPage: null,
      };
    },
  });

  const env = { ...createEnv(), DEBUG: '1' };
  const request = new Request('https://worker.test/api/orders/latest?limit=2&debug=1');
  const response = await handler(env, request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.deepEqual(body.ids, ['order-a', 'order-b']);
  assert.deepEqual(body.orders, ['order-a', 'order-b']);
  assert.equal(body.data[0].guid, 'order-a');
  assert.equal(body.data[1].guid, 'order-b');
  assert.ok(body.debug);
  assert.equal(body.debug.totals.finalReturned, 2);
  assert.equal(body.debug.totals.uniqueKept >= 2, true);
  assert.equal(calls.length, 1);
});

test('orders/latest widens window when needed', async () => {
  let attempt = 0;
  const starts = [];
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      starts.push(params.startIso);
      attempt += 1;
      if (attempt === 1) {
        return { orders: [], nextPage: null };
      }
      return {
        orders: [
          { guid: 'older-order', createdDate: '2023-10-10T08:00:00+0000' },
          { guid: 'latest-order', createdDate: '2023-10-10T09:00:00+0000' },
        ],
        nextPage: null,
      };
    },
  });

  const request = new Request('https://worker.test/api/orders/latest?limit=2');
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.deepEqual(body.ids, ['latest-order', 'older-order']);

  assert.equal(starts.length >= 2, true);
  const diffMs = Date.parse(starts[0]) - Date.parse(starts[1]);
  assert.equal(Math.round(diffMs / 60_000), 60);
});

test('orders/latest applies location and status filters', async () => {
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, _params) {
      return {
        orders: [
          {
            guid: 'match',
            createdDate: '2023-10-10T09:00:00+0000',
            restaurantLocationGuid: 'LOC-1',
            status: 'PAID',
          },
          {
            guid: 'wrong-location',
            createdDate: '2023-10-10T09:10:00+0000',
            restaurantLocationGuid: 'LOC-2',
            status: 'PAID',
          },
          {
            guid: 'wrong-status',
            createdDate: '2023-10-10T09:20:00+0000',
            restaurantLocationGuid: 'LOC-1',
            status: 'OPEN',
          },
        ],
        nextPage: null,
      };
    },
  });

  const request = new Request(
    'https://worker.test/api/orders/latest?limit=5&locationId=loc-1&status=paid'
  );
  const response = await handler(createEnv(), request);
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.count, 1);
  assert.deepEqual(body.ids, ['match']);
});
