import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/api/orders/latest.js');
const { createOrdersLatestHandler } = module;

function createEnv(overrides = {}) {
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
    ...overrides,
  };
}

function buildOrder(guid, openedDate, overrides = {}) {
  const inferredBusinessDate =
    typeof openedDate === 'string'
      ? openedDate.replace(/[^0-9]/g, '').slice(0, 8) || '20241010'
      : '20241010';
  const businessDate = overrides.businessDate ?? inferredBusinessDate;
  return {
    guid,
    openedDate,
    createdDate: openedDate,
    businessDate,
    context: {
      locationGuid: overrides.locationGuid ?? 'loc-main',
      businessDate,
    },
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

function buildResponse(orders, nextPage) {
  return { orders, nextPage };
}

test('orders/latest returns every order for the requested business date', async () => {
  const env = createEnv();
  const calls = [];
  const responses = [
    buildResponse(
      [
        buildOrder('order-latest', '2024-10-10T12:00:00+0000'),
        buildOrder('order-oldest', '2024-10-10T09:00:00+0000'),
      ],
      2
    ),
    buildResponse([buildOrder('order-middle', '2024-10-10T10:30:00+0000')], null),
  ];

  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params);
      return responses.shift() ?? buildResponse([], null);
    },
  });

  const response = await handler(
    env,
    new Request('https://worker.test/api/orders/latest?businessDate=20241010')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.limit, 5);
  assert.equal(body.pageSize, 100);
  assert.equal(body.count, 3);
  assert.deepEqual(body.ids, ['order-latest', 'order-middle', 'order-oldest']);
  assert.deepEqual(
    body.orders.map((order) => order.guid),
    ['order-latest', 'order-middle', 'order-oldest']
  );
  assert.equal(body.window.businessDate, '20241010');
  assert.equal(body.window.start, '2024-10-10T00:00:00.000+00:00');
  assert.equal(body.window.end, '2024-10-11T00:00:00.000+00:00');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].startIso, '2024-10-10T00:00:00.000+0000');
  assert.equal(calls[0].endIso, '2024-10-11T00:00:00.000+0000');
  assert.equal(calls[0].page, 1);
  assert.equal(calls[1].page, 2);
});

test('orders/latest forwards pageSize query parameter', async () => {
  const env = createEnv();
  const calls = [];
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params);
      return buildResponse([], null);
    },
  });

  const response = await handler(
    env,
    new Request('https://worker.test/api/orders/latest?businessDate=20241010&pageSize=7')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.pageSize, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pageSize, 7);
});

test('orders/latest supports detail=ids and omits data payload', async () => {
  const env = createEnv();
  const handler = createOrdersLatestHandler({
    async getOrdersBulk() {
      return buildResponse(
        [buildOrder('order-ids', '2024-10-11T09:15:00+0000', { businessDate: '20241011' })],
        null
      );
    },
  });

  const response = await handler(
    env,
    new Request('https://worker.test/api/orders/latest?detail=ids&businessDate=20241011')
  );
  const body = await response.json();

  assert.equal(body.detail, 'ids');
  assert.deepEqual(body.ids, ['order-ids']);
  assert.deepEqual(body.orders, ['order-ids']);
  assert.equal('data' in body, false);
});

test('orders/latest uses the configured time zone when building the request window', async () => {
  const env = createEnv({ TOAST_TIME_ZONE: 'America/Los_Angeles' });
  const calls = [];
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params);
      return buildResponse([], null);
    },
  });

  const response = await handler(
    env,
    new Request('https://worker.test/api/orders/latest?businessDate=20240704')
  );
  const body = await response.json();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].startIso, '2024-07-04T00:00:00.000-0700');
  assert.equal(calls[0].endIso, '2024-07-05T00:00:00.000-0700');
  assert.equal(body.window.start, '2024-07-04T00:00:00.000-07:00');
  assert.equal(body.window.end, '2024-07-05T00:00:00.000-07:00');
  assert.equal(body.window.timeZone, 'America/Los_Angeles');
});
