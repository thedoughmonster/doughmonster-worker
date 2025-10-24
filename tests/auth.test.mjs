import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/lib/auth.js');
const { getToastHeaders } = module;

function createMemoryKv() {
  const store = new Map();
  return {
    store,
    async get(key) {
      if (!store.has(key)) {
        return null;
      }
      const raw = store.get(key);
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch (error) {
          throw new Error(`Failed to parse KV payload: ${error}`);
        }
      }
      return raw;
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
  return {
    TOAST_API_BASE: 'https://toast.example',
    TOAST_AUTH_URL: 'https://toast.example/auth',
    TOAST_CLIENT_ID: 'id',
    TOAST_CLIENT_SECRET: 'secret',
    TOAST_RESTAURANT_GUID: 'restaurant-guid',
    TOKEN_KV: createMemoryKv(),
  };
}

test('getToastHeaders reuses cached token on the same day', async () => {
  const env = createEnv();
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let fetchCalls = 0;

  try {
    Date.now = () => new Date('2024-10-10T10:00:00Z').getTime();
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return {
            token: {
              accessToken: 'token-same-day',
              tokenType: 'bearer',
              expiresIn: 86_400,
            },
          };
        },
        async text() {
          return '';
        },
      };
    };

    const headers1 = await getToastHeaders(env);
    assert.equal(headers1.Authorization, 'Bearer token-same-day');
    assert.equal(fetchCalls, 1);

    Date.now = () => new Date('2024-10-10T18:00:00Z').getTime();
    const headers2 = await getToastHeaders(env);
    assert.equal(headers2.Authorization, 'Bearer token-same-day');
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
});

test('getToastHeaders refreshes the token on a new calendar day', async () => {
  const env = createEnv();
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let fetchCalls = 0;
  const tokens = [
    {
      token: {
        accessToken: 'token-day-1',
        tokenType: 'bearer',
        expiresIn: 86_400,
      },
    },
    {
      token: {
        accessToken: 'token-day-2',
        tokenType: 'bearer',
        expiresIn: 86_400,
      },
    },
  ];

  try {
    Date.now = () => new Date('2024-10-10T10:00:00Z').getTime();
    globalThis.fetch = async () => {
      fetchCalls += 1;
      const payload = tokens.shift();
      return {
        ok: true,
        async json() {
          return payload;
        },
        async text() {
          return '';
        },
      };
    };

    const headers1 = await getToastHeaders(env);
    assert.equal(headers1.Authorization, 'Bearer token-day-1');
    assert.equal(fetchCalls, 1);

    Date.now = () => new Date('2024-10-11T09:00:00Z').getTime();
    const headers2 = await getToastHeaders(env);
    assert.equal(headers2.Authorization, 'Bearer token-day-2');
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
});

