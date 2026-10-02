import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('real HTTP cookie login, refresh, CSRF, tenant scope and logout with isolated providers', async t => {
  const profiles = {
    a: { id: 'agent-a', role: 'agent', agency_id: 'agency-a', active: true },
    b: { id: 'agent-b', role: 'agent', agency_id: 'agency-b', active: true },
    disabled: { id: 'disabled', role: 'agent', agency_id: 'agency-a', active: false }
  };
  const bookings = [
    { id: 'own', pnr: 'OWN', agency_id: 'agency-a', created_by: 'agent-a', status: 'Reserved' },
    { id: 'foreign', pnr: 'FOREIGN', agency_id: 'agency-b', created_by: 'agent-b', status: 'Reserved' },
    { id: 'former', pnr: 'FORMER', agency_id: 'agency-b', created_by: 'agent-a', status: 'Reserved' }
  ];
  const invoices = bookings.map(row => ({ id: row.id, agency_id: row.agency_id, requested_by: row.created_by, status: 'pending' }));
  const refreshes = [];
  const actionWrites = [];
  const provider = createServer(async (req, res) => {
    try {
      res.setHeader('content-type', 'application/json');
      const url = new URL(req.url, 'http://localhost');
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = body ? JSON.parse(body) : {};
      const send = value => res.end(JSON.stringify(value));
      if (url.pathname === '/auth/v1/token') {
        const refresh = url.searchParams.get('grant_type') === 'refresh_token';
        const identity = refresh ? (data.refresh_token === 'server-only-refresh-a' ? 'a' : null) :
          ({ 'a@example.invalid': 'a', 'b@example.invalid': 'b', 'disabled@example.invalid': 'disabled' })[data.email];
        if (!identity || (!refresh && data.password !== 'TestPassword1!')) {
          res.statusCode = 401;
          return send({ message: 'PRIVATE_UPSTREAM_ERROR' });
        }
        if (refresh) refreshes.push(data);
        return send({
          access_token: `server-only-access-${identity}${refresh ? '-renewed' : ''}`,
          refresh_token: `server-only-refresh-${identity}`, expires_in: 3600,
          user: { id: profiles[identity].id }
        });
      }
      if (url.pathname === '/auth/v1/user') {
        const token = req.headers.authorization || '';
        const identity = Object.keys(profiles).find(key =>
          token === `Bearer server-only-access-${key}` || token === `Bearer server-only-access-${key}-renewed`
        );
        if (!identity) { res.statusCode = 401; return send({ error: 'Invalid token' }); }
        return send({ id: profiles[identity].id, email: `${identity}@example.invalid` });
      }
      if (url.pathname === '/rest/v1/profiles') {
        return send(Object.values(profiles).filter(row => url.searchParams.get('id') === `eq.${row.id}`));
      }
      if (url.pathname === '/rest/v1/agencies') return send([{ active: true }]);
      if (url.pathname === '/fx') return send({ nonCashBuy: 532.5, nonCashSell: 540.8 });
      if (url.pathname === '/rest/v1/rpc/claim_spring_status_checks') return send([]);
      if (['/rest/v1/bookings', '/rest/v1/topup_requests'].includes(url.pathname)) {
        // Scheduled expiry is not an agent mutation. It has no rows in this fixture.
        if (url.searchParams.has('created_at')) return send([]);
        if (req.method !== 'GET') actionWrites.push({ path: url.pathname, method: req.method });
        const rows = url.pathname.endsWith('/bookings') ? bookings : invoices;
        return send(rows.filter(row => ['id', 'pnr', 'agency_id', 'created_by', 'requested_by'].every(field => {
          const condition = url.searchParams.get(field);
          return !condition || condition === `eq.${row[field]}`;
        })));
      }
      res.statusCode = 500;
      return send({ error: 'Unexpected mock endpoint' });
    } catch {
      res.statusCode = 500;
      res.end('{"error":"Mock provider failed"}');
    }
  });
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;
  const environment = {
    ...process.env, PORT: String(port), APP_ENV: 'test',
    SUPABASE_URL: providerUrl, SUPABASE_SECRET_KEY: 'test-only-server',
    SUPABASE_PUBLISHABLE_KEY: 'test-only-publishable',
    GOLOMT_BANK_CNY_RATE_API_URL: `${providerUrl}/fx`, TRUST_PROXY_LOOPBACK: 'false'
  };
  for (const name of Object.keys(environment)) if (name.startsWith('SPRING_')) environment[name] = '';
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.resume();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server did not start')), 10000);
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve(); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited: ${code}`)); });
  });
  // Native HTTP lets this loopback test simulate nginx's forwarded Host header.
  const call = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${port}${path}`, {
      method: options.method || 'GET', headers: { host: 'portal.test', ...options.headers }
    }, res => {
      const chunks = [];
      res.on('error', reject);
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: res.statusCode, headers: res.headers
      })));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Local test request timed out')));
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
  const login = email => call('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://portal.test' },
    body: JSON.stringify({ email, password: 'TestPassword1!', role: 'platform_admin', agencyId: 'agency-b' })
  });
  let cookie;
  await t.test('login returns only sentinels; cookie has security flags, not provider tokens', async () => {
    const response = await login('a@example.invalid');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.accessToken, 'cookie'); assert.equal(data.refreshToken, 'cookie');
    assert.equal(data.profile.role, 'agent'); assert.equal(data.profile.agency_id, 'agency-a');
    assert.doesNotMatch(JSON.stringify(data), /server-only/);
    const header = response.headers.get('set-cookie');
    assert.match(header, /^nexahub_session=[0-9a-f]{64};/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(header.includes(flag));
    cookie = header.split(';')[0];
  });
  await t.test('cookies authenticate real list endpoints with current agency and creator scope', async () => {
    for (const path of ['/api/bookings', '/api/topups']) {
      const response = await call(path, { headers: { cookie } });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).map(row => row.id), ['own']);
    }
  });
  await t.test('agent cookies cannot access admin reads or writes with a forged role payload', async () => {
    assert.equal((await call('/api/admin/overview', { headers: { cookie } })).status, 403);
    assert.equal((await call('/api/admin/users', {
      method: 'POST', headers: { cookie, origin: 'https://portal.test', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'platform_admin', agencyId: 'agency-b' })
    })).status, 403);
    assert.equal(actionWrites.length, 0);
  });
  await t.test('foreign and former-agency invoices/documents are denied through HTTP', async () => {
    for (const path of ['/api/invoices/foreign', '/api/invoices/former', '/api/bookings/FOREIGN/ticket.pdf', '/api/bookings/FORMER/receipt.pdf']) {
      assert.equal((await call(path, { headers: { cookie } })).status, 403);
    }
  });
  await t.test('cookie writes reject missing/foreign Origin without mutating records', async () => {
    for (const origin of [undefined, 'https://attacker.test']) {
      const headers = { cookie, ...(origin ? { origin } : {}) };
      assert.equal((await call('/api/topups/own', { method: 'DELETE', headers })).status, 403);
      assert.equal((await call('/api/auth/refresh', { method: 'POST', headers })).status, 403);
    }
    assert.equal(actionWrites.length, 0); assert.equal(refreshes.length, 0);
  });
  await t.test('same-origin foreign cancel/issue/delete are denied without financial writes', async () => {
    const headers = { cookie, origin: 'https://portal.test', 'content-type': 'application/json' };
    for (const path of ['/api/bookings/FOREIGN/cancel', '/api/bookings/FOREIGN/issue']) {
      assert.equal((await call(path, { method: 'POST', headers, body: '{}' })).status, 403);
    }
    assert.equal((await call('/api/topups/foreign', { method: 'DELETE', headers })).status, 403);
    assert.equal(actionWrites.length, 0);
  });
  await t.test('refresh ignores browser-supplied refresh tokens and does not expose real tokens', async () => {
    const response = await call('/api/auth/refresh', {
      method: 'POST', headers: { cookie, origin: 'https://portal.test', 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'attacker-refresh-token' })
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.accessToken, 'cookie'); assert.equal(data.refreshToken, 'cookie');
    assert.doesNotMatch(JSON.stringify(data), /server-only|attacker-refresh-token/);
    assert.deepEqual(refreshes, [{ refresh_token: 'server-only-refresh-a' }]);
  });
  await t.test('agency reassignment is checked on the next request despite the existing cookie', async () => {
    profiles.a.agency_id = 'agency-b';
    assert.equal((await call('/api/invoices/own', { headers: { cookie } })).status, 403);
    const response = await call('/api/bookings', { headers: { cookie } });
    assert.deepEqual((await response.json()).map(row => row.id), ['former']);
  });
  await t.test('inactive accounts cannot establish a browser session', async () => {
    const response = await login('disabled@example.invalid');
    assert.equal(response.status, 401); assert.equal(response.headers.get('set-cookie'), null);
  });
  await t.test('provider errors are not copied into login responses', async () => {
    const response = await login('unknown@example.invalid');
    assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /PRIVATE_UPSTREAM_ERROR/);
  });
  await t.test('logout clears cookie and invalidates the server-held session', async () => {
    const response = await call('/api/auth/logout', {
      method: 'POST', headers: { cookie, origin: 'https://portal.test' }
    });
    assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call('/api/bookings', { headers: { cookie } })).status, 401);
    assert.equal((await call('/api/auth/refresh', {
      method: 'POST', headers: { cookie, origin: 'https://portal.test' }
    })).status, 401);
  });
});
