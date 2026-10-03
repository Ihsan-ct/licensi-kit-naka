import assert from 'node:assert/strict';
import test from 'node:test';
import { issueToken } from './_lib/admin.js';
import handler from './licenses.js';

test('returns every installation and the admin audit log', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    ADMIN_SECRET: process.env.ADMIN_SECRET,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };

  process.env.ADMIN_SECRET = 'test-admin-secret';
  delete process.env.ADMIN_SESSION_SECRET;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

  globalThis.fetch = async (url) => {
    const path = String(url);
    const json = path.includes('/licenses?') ? [{
      owner_id: '123', owner_type: 'User', product: 'kit-naka',
      status: 'active', created_at: '2026-01-01T00:00:00Z'
    }] : path.includes('/installations?') ? [
      { owner_id: '123', owner_type: 'User', product: 'kit-naka', place_id: '1', universe_id: '11', last_seen_at: '2026-01-03T00:00:00Z' },
      { owner_id: '123', owner_type: 'User', product: 'kit-naka', place_id: '2', universe_id: '22', last_seen_at: '2026-01-02T00:00:00Z' }
    ] : path.includes('/access_attempts?') ? [] : path.includes('/audit_logs?') ? [{
      id: 1, action: 'LICENSE_UPDATED', target_type: 'license',
      target_id: 'User:123:kit-naka', actor_label: 'admin',
      created_at: '2026-01-03T00:00:00Z'
    }] : null;

    if (json === null) throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
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
    const token = await issueToken();
    await handler({
      method: 'GET',
      url: '/api/licenses',
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '127.0.0.78' },
      socket: {}
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.licenses.map(row => row.universe_id), ['11', '22']);
    assert.equal(response.body.audits[0].action, 'LICENSE_UPDATED');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
