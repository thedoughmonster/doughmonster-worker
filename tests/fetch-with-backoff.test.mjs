import test from 'node:test';
import assert from 'node:assert/strict';

const { fetchWithBackoff } = await import('../dist/lib/http.js');

const originalFetch = globalThis.fetch;

test('fetchWithBackoff retries on 429 and succeeds', async (t) => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('Too Many Requests', { status: 429 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const response = await fetchWithBackoff('https://example.com/retry', {}, {
    retries: 2,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);

  const body = await response.json();
  assert.deepEqual(body, { ok: true });
});

test('fetchWithBackoff throws after retries exhausted', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('Server Error', { status: 503 });
  };

  await assert.rejects(
    () =>
      fetchWithBackoff('https://example.com/fail', {}, {
        retries: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
      }),
    (err) => {
      assert.equal(typeof err, 'object');
      assert.equal(err.status, 503);
      return true;
    }
  );

  assert.equal(calls, 2);
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
