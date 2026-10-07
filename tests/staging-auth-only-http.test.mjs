import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('actual supplier-disabled HTTP boundary preserves login/local reads but denies supplier routes before writes or network', async t => {
  const calls = [];
  const provider = createServer((req, res) => {
    calls.push({ method: req.method, path: new URL(req.url, 'http://localhost').pathname });
    res.setHeader('content-type', 'application/json');
    const path = calls.at(-1).path;
    if (path === '/auth/v1/user') return res.end(JSON.stringify({ id: 'mock-admin', email: 'test@example.invalid' }));
    if (path === '/auth/v1/token') return res.end(JSON.stringify({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600, user: { id: 'mock-admin' } }));
    if (path === '/rest/v1/profiles') return res.end(JSON.stringify([{ id: 'mock-admin', role: 'platform_admin', active: true }]));
    res.end('[]');
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const upstream = `http://127.0.0.1:${provider.address().port}`;
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(SUPABASE_|SPRING_|AUTH_|STAGING_|SERPAPI_)/.test(key)) delete env[key];
  Object.assign(env, { PORT: String(port), APP_ENV: 'staging', STAGING_SUPPLIER_MODE: 'disabled', SUPABASE_URL: upstream, SUPABASE_SECRET_KEY: 'fake-local-test', SUPABASE_PUBLISHABLE_KEY: 'fake-local-test', AUTH_EMAIL_OTP_REQUIRED: 'false', AUTH_PASSWORD_ROTATION_REQUIRED: 'false',
    // Deliberately invalid real-deployment config: direct-server tests prove the
    // route/transport guard still blocks even if stale credentials were retained.
    SPRING_HTTP_BASE_URL: upstream, SPRING_OAUTH_CLIENT_ID: 'fake-only', SPRING_OAUTH_CLIENT_SECRET: 'fake-only', SPRING_XML_WSDL_URL: upstream + '/supplier?wsdl', SPRING_XML_USERNAME: 'fake-only', SPRING_XML_PASSWORD: 'fake-only', SPRING_CREDIT_PAYMENT_ENABLED: 'true', SPRING_BOOKING_ENABLED: 'true', SERPAPI_KEY: 'fake-fallback' });
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    await new Promise(resolve => provider.close(resolve));
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Isolated test server did not start.')), 15000);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('listening on')) { clearTimeout(timeout); resolve(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Isolated test server exited before ready.')); });
  });
  const request = (path, options = {}) => fetch(origin + path, options).catch(error => {
    throw new Error(`Isolated HTTP request failed: ${error.cause?.code || error.cause?.message || error.message}`);
  });
  assert.equal((await request('/api/health')).status, 200);
  assert.match(await (await request('/')).text(), /Spring OFF/);
  assert.equal((await request('/api/flights')).status, 401);
  const auth = { authorization: 'Bearer fake-access', origin, 'content-type': 'application/json' };
  for (const [method, path] of [['GET', '/api/flights'], ['POST', '/api/flights/price'], ['POST', '/api/flights/prices'], ['POST', '/api/bookings'], ['POST', '/api/bookings/MOCK/issue'], ['POST', '/api/bookings/MOCK/sync'], ['GET', '/api/bookings/MOCK/change-options'], ['POST', '/api/bookings/MOCK/change-submit'], ['POST', '/api/bookings/MOCK/refund-submit'], ['DELETE', '/api/bookings/MOCK'], ['GET', '/api/bookings/MOCK/future-supplier-action']]) {
    const before = calls.length;
    const result = await request(path, { method, headers: auth, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(result.status, 503, `${method} ${path}`);
    assert.equal((await result.json()).code, 'SUPPLIER_DISABLED');
    assert.ok(calls.slice(before).every(call => call.method === 'GET' && ['/auth/v1/user', '/rest/v1/profiles'].includes(call.path)), 'only authentication reads may occur before denial');
  }
  const status = await request('/api/backend/status', { headers: auth });
  assert.equal(status.status, 200);
  const readiness = await status.json();
  assert.equal(readiness.spring.httpJsonReady, false);
  assert.equal(readiness.springSoap.orderDetailReady, false);
  const bookings = await request('/api/bookings', { headers: auth });
  assert.equal(bookings.status, 200);
  assert.deepEqual(await bookings.json(), []);
  const login = await request('/api/auth/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'test@example.invalid', password: 'Fake-only-123!' }) });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).accessToken, 'cookie');
  assert.ok(calls.every(call => call.path.startsWith('/auth/v1/') || call.path.startsWith('/rest/v1/')), 'no Spring, SOAP, or fallback search request was sent');
  assert.ok(!calls.some(call => call.path.includes('claim_spring_status')));
});
