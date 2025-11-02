import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/api/orders/by-id.js');
const { createOrderByIdHandler } = module;

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

test('order-by-id handler returns the Toast order payload', async () => {
  const env = createEnv();
  const guid = '123e4567-e89b-12d3-a456-426614174000';
  const expectedOrder = { guid, status: 'READY' };
  let calls = 0;

  const handler = createOrderByIdHandler({
    async getOrderById(receivedEnv, receivedGuid) {
      calls += 1;
      assert.equal(receivedEnv, env);
      assert.equal(receivedGuid, guid);
      return expectedOrder;
    },
  });

  const response = await handler(
    env,
    new Request(`https://worker.test/api/orders/${guid}`)
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.guid, guid);
  assert.equal(body.route, `/api/orders/${guid}`);
  assert.deepEqual(body.order, expectedOrder);
  assert.equal(calls, 1);
});

test('order-by-id handler rejects malformed GUIDs with a 400 error', async () => {
  const env = createEnv();
  let calls = 0;

  const handler = createOrderByIdHandler({
    async getOrderById() {
      calls += 1;
      throw new Error('should not be called');
    },
  });

  const response = await handler(
    env,
    new Request('https://worker.test/api/orders/not-a-guid')
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /valid UUID/i);
  assert.equal(body.guid, 'not-a-guid');
  assert.equal(calls, 0);
});

test('order-by-id handler surfaces Toast 404 and 500 errors', async () => {
  const env = createEnv();
  const guid = '123e4567-e89b-12d3-a456-426614174000';

  const notFoundHandler = createOrderByIdHandler({
    async getOrderById() {
      const err = new Error('Order missing');
      err.status = 404;
      throw err;
    },
  });

  const missingResponse = await notFoundHandler(
    env,
    new Request(`https://worker.test/api/orders/${guid}`)
  );
  const missingBody = await missingResponse.json();

  assert.equal(missingResponse.status, 404);
  assert.equal(missingBody.ok, false);
  assert.equal(missingBody.error, `Order ${guid} was not found.`);

  const serverErrorHandler = createOrderByIdHandler({
    async getOrderById() {
      const err = new Error('Toast exploded');
      err.status = 500;
      throw err;
    },
  });

  const serverResponse = await serverErrorHandler(
    env,
    new Request(`https://worker.test/api/orders/${guid}`)
  );
  const serverBody = await serverResponse.json();

  assert.equal(serverResponse.status, 500);
  assert.equal(serverBody.ok, false);
  assert.match(serverBody.error, /Toast is currently unavailable/i);
});
