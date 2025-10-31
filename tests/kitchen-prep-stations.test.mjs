import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/api/kitchen/prep-stations.js');
const { createKitchenPrepStationsHandler } = module;

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
    CACHE_KV: {
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

test('kitchen prep stations route returns structured payload', async () => {
  const env = createEnv();
  const handler = createKitchenPrepStationsHandler({
    async getPrepStations() {
      return {
        prepStations: [
          {
            guid: 'station-1',
            entityType: 'PrepStation',
            name: 'Grill',
          },
          {
            guid: 'station-2',
            entityType: 'PrepStation',
            name: 'Expo',
            expoRouting: 'SEND_TO_EXPO',
          },
        ],
        nextPageToken: 'next-token',
        raw: { toast: 'payload' },
        responseHeaders: {},
      };
    },
  });

  const response = await handler(
    env,
    new Request('https://worker.test/api/kitchen/prep-stations')
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.route, '/api/kitchen/prep-stations');
  assert.equal(body.count, 2);
  assert.equal(body.nextPageToken, 'next-token');
  assert.deepEqual(body.request, { pageToken: null, lastModified: null });
  assert.deepEqual(
    body.prepStations.map((station) => station.guid),
    ['station-1', 'station-2']
  );
  assert.deepEqual(body.raw, { toast: 'payload' });
});

test('kitchen prep stations route forwards query parameters', async () => {
  const env = createEnv();
  const calls = [];
  const handler = createKitchenPrepStationsHandler({
    async getPrepStations(_env, params) {
      calls.push(params);
      return {
        prepStations: [],
        nextPageToken: null,
        raw: null,
        responseHeaders: {},
      };
    },
  });

  const response = await handler(
    env,
    new Request(
      'https://worker.test/api/kitchen/prep-stations?pageToken= token-1 &lastModified=2024-10-01T00%3A00%3A00.000%2B0000 '
    )
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    pageToken: 'token-1',
    lastModified: '2024-10-01T00:00:00.000+0000',
  });
  assert.deepEqual(body.request, calls[0]);
});

test('kitchen prep stations route propagates upstream errors', async () => {
  const env = createEnv();
  const handler = createKitchenPrepStationsHandler({
    async getPrepStations() {
      const error = new Error('Toast upstream failure');
      error.status = 503;
      throw error;
    },
  });

  const response = await handler(
    env,
    new Request('https://worker.test/api/kitchen/prep-stations')
  );
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.route, '/api/kitchen/prep-stations');
  assert.equal(body.error, 'Toast upstream failure');
});
