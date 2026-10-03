import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './verify.js';

test('accepts another universe owned by the licensed owner', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls = [];

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes('/licenses?')) {
      return new Response(JSON.stringify([{
        owner_id: '123',
        owner_type: 'User',
        product: 'kit-naka',
        status: 'active',
        universe_id: '999'
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/installations?')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url}`);
  };

  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };

  try {
    await handler({
      method: 'POST',
      headers: { 'x-forwarded-for': '127.0.0.77', 'user-agent': 'test' },
      socket: {},
      body: {
        ownerId: '123',
        ownerType: 'User',
        product: 'kit-naka',
        placeId: '456',
        universeId: '777'
      }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.valid, true);
    assert.equal(response.body.universeId, '777');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
