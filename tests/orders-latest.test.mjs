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
      async get() {
        return null;
      },
      async put() {
        return undefined;
      },
    },
  };
}

function buildOrder(guid, openedDate, overrides = {}) {
  return {
    guid,
    openedDate,
    createdDate: openedDate,
    context: { locationGuid: overrides.locationGuid ?? 'loc-main' },
    status: overrides.status ?? 'READY',
    checks: [
      {
        guid: `${guid}-check`,
        selections: [
          {
            guid: `${guid}-item`,
            quantity: 1,
            item: { guid: 'item-guid' },
            fulfillmentStatus: overrides.itemStatus ?? 'READY',
          },
        ],
      },
    ],
  };
}

test('orders/latest returns toast results with minimal processing', async () => {
  const env = createEnv();
  let capturedParams = null;
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      capturedParams = params;
      return {
        orders: [
          buildOrder('order-1', '2024-10-10T10:00:00+0000'),
          buildOrder('order-2', '2024-10-10T09:30:00+0000'),
          buildOrder('order-3', '2024-10-10T09:00:00+0000'),
        ],
      };
    },
  });

  const response = await handler(env, new Request('https://worker.test/api/orders/latest?limit=2'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.route, '/api/orders/latest');
  assert.equal(body.limit, 2);
  assert.equal(body.detail, 'full');
  assert.equal(body.count, 2);
  assert.deepEqual(body.ids, ['order-1', 'order-2']);
  assert.deepEqual(body.orders, body.data);
  assert.equal(body.data.length, 2);
  assert.equal(body.pageSize, 5);
  assert.equal(Array.isArray(body.expandUsed), true);
  assert.equal(body.expandUsed.length > 0, true);
  assert.equal(typeof body.minutes, 'number');
  assert.equal(typeof body.window.start, 'string');
  assert.equal(typeof body.window.end, 'string');

  assert.ok(capturedParams);
  assert.equal(capturedParams.page, 1);
  assert.equal(capturedParams.pageSize, 5);
  assert.deepEqual(capturedParams.expansions, [
    'checks',
    'items',
    'payments',
    'discounts',
    'serviceCharges',
    'customers',
    'employee',
  ]);
  assert.equal(typeof capturedParams.startIso, 'string');
  assert.equal(typeof capturedParams.endIso, 'string');
});

test('orders/latest forwards pageSize query parameter', async () => {
  const env = createEnv();
  const calls = [];
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params);
      return { orders: [] };
    },
  });

  const response = await handler(
    env,
    new Request('https://worker.test/api/orders/latest?pageSize=7')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.pageSize, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pageSize, 7);
});

test('orders/latest supports detail=ids', async () => {
  const env = createEnv();
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env) {
      return {
        orders: [buildOrder('order-ids', '2024-10-11T09:15:00+0000')],
      };
    },
  });

  const response = await handler(
    env,
    new Request('https://worker.test/api/orders/latest?detail=ids')
  );
  const body = await response.json();

  assert.equal(body.detail, 'ids');
  assert.deepEqual(body.ids, ['order-ids']);
  assert.deepEqual(body.orders, ['order-ids']);
  assert.equal('data' in body, false);
});
