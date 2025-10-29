import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/routes/orders-detailed/compose.js');
const { buildExpandedOrders, __private } = module;

function createOrdersPayload() {
  const order = {
    guid: 'order-001',
    createdDate: '2024-05-01T12:00:00.000Z',
    checks: [
      {
        guid: 'check-001',
        lastModifiedDate: '2024-05-01T12:05:00.000Z',
        version: 3,
        customerName: 'Customer Name',
        appliedDiscounts: [{ discountAmount: 1 }],
        appliedServiceCharges: [{ chargeAmount: 2 }],
        payments: [{ tipAmount: 1.5 }],
        selections: [
          {
            guid: 'selection-001',
            item: { guid: 'menu-item-001' },
            quantity: 2,
            receiptLinePrice: 5,
            price: 5,
            appliedDiscounts: [{ discountAmount: 0.5 }],
            fulfillmentStatus: 'READY',
          },
        ],
      },
    ],
  };

  return {
    ok: true,
    detail: 'full',
    data: [order],
  };
}

test('orders-detailed builder reuses memoized orders for identical payloads', () => {
  __private.resetOrderCacheForTests();

  const payload = createOrdersPayload();
  const args = {
    ordersPayload: payload,
    menuDocument: null,
    menuUpdatedAt: '2024-05-01T12:00:00.000Z',
    limit: 5,
    startedAt: Date.now(),
    timeBudgetMs: 10_000,
  };

  const first = buildExpandedOrders(args);
  assert.equal(first.orders.length, 1);
  const statsAfterFirst = __private.getOrderCacheStats();
  assert.equal(statsAfterFirst.misses, 1, 'initial build should populate the cache');
  assert.equal(statsAfterFirst.hits, 0, 'no cache hits expected before reuse');
  assert.equal(statsAfterFirst.size, 1, 'cache should hold the built order');

  first.orders[0].orderData.customerName = 'Mutated Name';

  const payloadClone = JSON.parse(JSON.stringify(payload));
  const second = buildExpandedOrders({
    ...args,
    startedAt: Date.now(),
    ordersPayload: payloadClone,
  });
  assert.equal(second.orders.length, 1);
  const statsAfterSecond = __private.getOrderCacheStats();
  assert.equal(statsAfterSecond.hits, 1, 'second build should reuse cached order');
  assert.equal(statsAfterSecond.misses, 1, 'no additional miss expected for identical payload');
  assert.equal(statsAfterSecond.size, 1, 'cache should not grow for identical payload');

  assert.equal(
    second.orders[0].orderData.customerName,
    'Customer Name',
    'cached result should be deep-cloned before returning'
  );
});
