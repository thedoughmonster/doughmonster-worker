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

test('orders/latest returns sorted orders limited by the query parameter', async () => {
  const env = createEnv();
  const calls = [];
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params);
      return {
        orders: [
          buildOrder('order-2', '2024-10-10T10:05:00+0000'),
          buildOrder('order-1', '2024-10-10T10:00:00+0000'),
          buildOrder('order-3', '2024-10-10T09:30:00+0000'),
        ],
        nextPage: null,
      };
    },
  });

  const request = new Request('https://worker.test/api/orders/latest?limit=2');
  const response = await handler(env, request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.deepEqual(body.ids, ['order-2', 'order-1']);
  assert.equal(body.limit, 2);
  assert.equal(body.pageSize, 100);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pageSize, 100);
});

test('orders/latest forwards pageSize query parameter', async () => {
  const env = createEnv();
  const calls = [];
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params);
      return { orders: [], nextPage: null };
    },
  });

  const response = await handler(env, new Request('https://worker.test/api/orders/latest?pageSize=7'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.pageSize, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pageSize, 7);
});

test('orders/latest returns more than five orders by default', async () => {
  const env = createEnv();
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env) {
      return {
        orders: [
          buildOrder('order-1', '2024-10-10T08:00:00+0000'),
          buildOrder('order-2', '2024-10-10T08:05:00+0000'),
          buildOrder('order-3', '2024-10-10T08:10:00+0000'),
          buildOrder('order-4', '2024-10-10T08:15:00+0000'),
          buildOrder('order-5', '2024-10-10T08:20:00+0000'),
          buildOrder('order-6', '2024-10-10T08:25:00+0000'),
        ],
        nextPage: null,
      };
    },
  });

  const response = await handler(env, new Request('https://worker.test/api/orders/latest'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.limit, 200);
  assert.equal(body.pageSize, 100);
  assert.equal(body.count, 6);
  assert.deepEqual(body.ids, [
    'order-6',
    'order-5',
    'order-4',
    'order-3',
    'order-2',
    'order-1',
  ]);
});

test('orders/latest continues fetching pages until enough matching results are found', async () => {
  const env = createEnv();
  const calls = [];
  const responses = [
    {
      orders: [
        buildOrder('order-ignored-1', '2024-10-10T08:00:00+0000', {
          locationGuid: 'loc-other',
        }),
      ],
      nextPage: 2,
    },
    {
      orders: [
        buildOrder('order-match-2', '2024-10-10T12:30:00+0000'),
        buildOrder('order-match-1', '2024-10-10T11:45:00+0000'),
      ],
      nextPage: null,
    },
  ];

  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params);
      return responses.shift() ?? { orders: [], nextPage: null };
    },
  });

  const response = await handler(env, new Request('https://worker.test/api/orders/latest?limit=2'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 2);
  assert.deepEqual(body.ids, ['order-match-2', 'order-match-1']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].page, 1);
  assert.equal(calls[1].page, 2);
});

test('orders/latest supports detail=ids', async () => {
  const env = createEnv();
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env) {
      return {
        orders: [buildOrder('order-ids', '2024-10-11T09:15:00+0000')],
        nextPage: null,
      };
    },
  });

  const response = await handler(env, new Request('https://worker.test/api/orders/latest?detail=ids'));
  const body = await response.json();

  assert.equal(body.detail, 'ids');
  assert.deepEqual(body.ids, ['order-ids']);
  assert.equal('data' in body, false);
});

test('collectLatestOrders defaults to current calendar day window', async () => {
  const moduleCollect = await import('../dist/lib/collectLatestOrders.js');
  const { collectLatestOrders } = moduleCollect;
  const { toToastIsoUtc } = await import('../dist/lib/order-utils.js');

  const env = createEnv();
  const calls = [];
  const now = new Date('2024-10-11T15:45:30.000Z');

  await collectLatestOrders({
    env,
    deps: {
      async getOrdersBulk(_env, params) {
        calls.push(params);
        return { orders: [], nextPage: null };
      },
    },
    limit: 10,
    detail: 'full',
    locationId: null,
    status: null,
    debug: false,
    pageSize: null,
    since: null,
    sinceRaw: null,
    windowOverride: null,
    now,
  });

  assert.equal(calls.length, 1);
  const expectedStart = toToastIsoUtc(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const expectedEnd = toToastIsoUtc(now);
  assert.equal(calls[0].startIso, expectedStart);
  assert.equal(calls[0].endIso, expectedEnd);
});
