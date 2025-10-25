import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/api/orders/latest.js');
const { createOrdersLatestHandler } = module;

function createMemoryKv() {
  const store = new Map();
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

function createEnv() {
  const cacheKv = createMemoryKv();
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
    CACHE_KV: cacheKv,
  };
}

function buildOrder(guid, openedDate, itemStatus) {
  return {
    guid,
    openedDate,
    createdDate: openedDate,
    checks: [
      {
        guid: `${guid}-check`,
        selections: [
          {
            guid: `${guid}-item`,
            quantity: 1,
            item: { guid: 'item-guid' },
            fulfillmentStatus: itemStatus,
          },
        ],
      },
    ],
  };
}

test('orders/latest caches responses and sorts by openedDate', async () => {
  const env = createEnv();
  const calls = [];
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params);
      return {
        orders: [
          buildOrder('order-2', '2024-10-10T10:05:00+0000', 'READY'),
          buildOrder('order-1', '2024-10-10T10:00:00+0000', 'SENT'),
        ],
        nextPage: null,
      };
    },
  });

  const request = new Request('https://worker.test/api/orders/latest?limit=5');
  const response = await handler(env, request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.deepEqual(body.ids, ['order-2', 'order-1']);
  assert.equal(Array.isArray(body.data), true);
  assert.equal(body.data.length, 2);
  assert.equal(body.limit, 5);
  assert.equal(body.detail, 'full');
  assert.equal(body.pageSize, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pageSize, 5);

  const cursorRaw = env.CACHE_KV.store.get('orders:lastFulfilledCursor');
  const cursor = JSON.parse(cursorRaw);
  assert.equal(cursor.orderGuid, 'order-2');
  assert.ok(cursor.ts.includes('2024-10-10T10:05'));

  const recentRaw = env.CACHE_KV.store.get('orders:recentIndex');
  const recent = JSON.parse(recentRaw);
  assert.deepEqual(recent, ['order-2', 'order-1']);
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

  const response = await handler(env, new Request('https://worker.test/api/orders/latest?pageSize=5'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.pageSize, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pageSize, 5);
});

test('orders/latest uses fulfilled cursor for incremental fetches', async () => {
  const env = createEnv();
  const calls = [];
  const responses = [
    {
      orders: [
        buildOrder('order-ready', '2024-10-10T12:00:00+0000', 'READY'),
        buildOrder('order-open', '2024-10-10T11:00:00+0000', 'SENT'),
      ],
      nextPage: null,
    },
    {
      orders: [buildOrder('order-new', '2024-10-10T12:30:00+0000', 'READY')],
      nextPage: null,
    },
  ];

  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env, params) {
      calls.push(params);
      return responses.shift() ?? { orders: [], nextPage: null };
    },
  });

  await handler(env, new Request('https://worker.test/api/orders/latest'));
  const cursorRaw = env.CACHE_KV.store.get('orders:lastFulfilledCursor');
  const cursor = JSON.parse(cursorRaw);
  const secondResponse = await handler(env, new Request('https://worker.test/api/orders/latest'));
  const secondBody = await secondResponse.json();

  assert.equal(calls.length >= 2, true);
  assert.equal(secondBody.ids[0], 'order-new');
  assert.equal(calls[1].startIso, cursor.ts);
  assert.equal(secondBody.count >= 1, true);
});

test('orders/latest supports detail=ids', async () => {
  const env = createEnv();
  const handler = createOrdersLatestHandler({
    async getOrdersBulk(_env) {
      return {
        orders: [buildOrder('order-ids', '2024-10-11T09:15:00+0000', 'READY')],
        nextPage: null,
      };
    },
  });

  await handler(env, new Request('https://worker.test/api/orders/latest'));
  const response = await handler(env, new Request('https://worker.test/api/orders/latest?detail=ids'));
  const body = await response.json();

  assert.equal(body.detail, 'ids');
  assert.deepEqual(body.ids, ['order-ids']);
  assert.equal('data' in body, false);
});

test('orders/latest reads future business date index when UTC day lags', async () => {
  const env = createEnv();
  const futureBusinessDate = '20241025';
  const futureOrder = buildOrder('order-future', '2024-10-25T01:00:00+0000', 'READY');

  env.CACHE_KV.store.set(`orders:index:${futureBusinessDate}`, JSON.stringify(['order-future']));
  env.CACHE_KV.store.set(`orders:byId:order-future`, JSON.stringify(futureOrder));
  env.CACHE_KV.store.set('orders:recentIndex', JSON.stringify([]));

  const handler = createOrdersLatestHandler({
    async getOrdersBulk() {
      return { orders: [], nextPage: null };
    },
  });

  const fixedNow = Date.parse('2024-10-24T23:30:00Z');
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedNow);
      } else {
        super(...args);
      }
    }

    static now() {
      return fixedNow;
    }
  }
  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;

  globalThis.Date = MockDate;

  try {
    const response = await handler(env, new Request('https://worker.test/api/orders/latest'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.deepEqual(body.ids, ['order-future']);
    assert.equal(Array.isArray(body.data), true);
    assert.equal(body.data[0].guid, 'order-future');
  } finally {
    globalThis.Date = RealDate;
  }
});

test('orders/latest prioritizes next-day business date fallback before prior days', async () => {
  const env = createEnv();
  const previousBusinessDate = '20241024';
  const futureBusinessDate = '20241025';

  const previousOrderGuids = Array.from({ length: 5 }, (_, index) => `order-prev-${index + 1}`);
  const futureOrder = buildOrder('order-future', '2024-10-25T12:00:00+0000', 'READY');

  env.CACHE_KV.store.set(`orders:index:${futureBusinessDate}`, JSON.stringify(['order-future']));
  env.CACHE_KV.store.set(`orders:byId:order-future`, JSON.stringify(futureOrder));

  env.CACHE_KV.store.set(`orders:index:${previousBusinessDate}`, JSON.stringify(previousOrderGuids));
  for (const [index, guid] of previousOrderGuids.entries()) {
    const openedHour = String(9 + index).padStart(2, '0');
    const order = buildOrder(guid, `2024-10-24T${openedHour}:00:00+0000`, 'READY');
    env.CACHE_KV.store.set(`orders:byId:${guid}`, JSON.stringify(order));
  }

  env.CACHE_KV.store.set('orders:recentIndex', JSON.stringify([]));

  const handler = createOrdersLatestHandler({
    async getOrdersBulk() {
      return { orders: [], nextPage: null };
    },
  });

  const fixedNow = Date.parse('2024-10-24T23:30:00Z');
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedNow);
      } else {
        super(...args);
      }
    }

    static now() {
      return fixedNow;
    }
  }
  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;

  globalThis.Date = MockDate;

  try {
    const response = await handler(env, new Request('https://worker.test/api/orders/latest?limit=3'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.count, 3);
    assert.equal(body.ids.includes('order-future'), true);
    assert.equal(body.ids.length, 3);
  } finally {
    globalThis.Date = RealDate;
  }
});

test('orders/latest keeps future business date results even when recent index is saturated', async () => {
  const env = createEnv();
  const previousBusinessDate = '20241024';
  const futureBusinessDate = '20241025';

  const previousOrderGuids = Array.from({ length: 3 }, (_, index) => `order-prev-${index + 1}`);
  const futureOrder = buildOrder('order-future', '2024-10-25T08:00:00+0000', 'READY');

  env.CACHE_KV.store.set(`orders:index:${futureBusinessDate}`, JSON.stringify(['order-future']));
  env.CACHE_KV.store.set(`orders:byId:order-future`, JSON.stringify(futureOrder));

  env.CACHE_KV.store.set(`orders:index:${previousBusinessDate}`, JSON.stringify(previousOrderGuids));
  for (const [index, guid] of previousOrderGuids.entries()) {
    const openedHour = String(9 + index).padStart(2, '0');
    const order = buildOrder(guid, `2024-10-24T${openedHour}:00:00+0000`, 'READY');
    env.CACHE_KV.store.set(`orders:byId:${guid}`, JSON.stringify(order));
  }

  env.CACHE_KV.store.set('orders:recentIndex', JSON.stringify(previousOrderGuids));

  const handler = createOrdersLatestHandler({
    async getOrdersBulk() {
      return { orders: [], nextPage: null };
    },
  });

  const fixedNow = Date.parse('2024-10-24T23:30:00Z');
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedNow);
      } else {
        super(...args);
      }
    }

    static now() {
      return fixedNow;
    }
  }
  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;

  globalThis.Date = MockDate;

  try {
    const response = await handler(env, new Request('https://worker.test/api/orders/latest?limit=2'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.count, 2);
    assert.equal(body.ids.includes('order-future'), true);
  } finally {
    globalThis.Date = RealDate;
  }
});
