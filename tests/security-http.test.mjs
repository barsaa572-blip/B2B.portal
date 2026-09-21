import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('HTTP boundary blocks private files, anonymous finance, forged origins and spam', async t => {
  let writes = 0;
  let priceCalls = 0;
  const db = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url, 'http://localhost');
    const admin = req.headers.authorization === 'Bearer admin-test';
    if (url.pathname === '/auth/oauth2/accessToken') return res.end(JSON.stringify({ ifSuccess: 'Y', oauth2ResultDTO: { accessToken: 'fake-spring-token' } }));
    if (url.pathname === '/apiFlightSearch/ota/normalFlightSearch/getSpecificPriceNew') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        priceCalls++;
        assert.equal(req.headers.accesstoken, 'fake-spring-token');
        assert.deepEqual(JSON.parse(body), { lang: 'zh_cn', moneyClassId: 0, segType: 'N', segHeadIds: [123], cabinNames: ['S'], cabinTypes: [3] });
        const row = value => [{ cabinPrice: value, fuelFee: 0, portPay: 0, otherFeeSum: 0 }];
        res.end(JSON.stringify({ ifSuccess: 'Y', adultTravPriceForSeg: row(100), childTravPriceForSeg: row(50), infantTravPriceForSeg: row(10) }));
      });
      return;
    }
    if (url.pathname === '/auth/v1/user') return res.end(JSON.stringify({ id: admin ? 'admin' : 'agent', email: 'test@example.invalid' }));
    if (url.pathname === '/rest/v1/profiles') return res.end(JSON.stringify([{ id: url.search.includes('admin') ? 'admin' : 'agent', active: true, role: url.search.includes('admin') ? 'platform_admin' : 'agent', agency_id: 'agency-a' }]));
    if (url.pathname === '/rest/v1/agencies') return res.end(JSON.stringify([{ active: true }]));
    if (req.method !== 'GET') writes++;
    res.end('[]');
  });
  db.listen(0, '127.0.0.1'); await once(db, 'listening');
  const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
  const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), SUPABASE_URL: `http://127.0.0.1:${db.address().port}`, SUPABASE_SECRET_KEY: 'fake-local-test', SUPABASE_PUBLISHABLE_KEY: 'fake-local-test', SPRING_HTTP_BASE_URL: `http://127.0.0.1:${db.address().port}`, SPRING_TOKEN_URL: `http://127.0.0.1:${db.address().port}/auth/oauth2/accessToken`, SPRING_PRICE_CHECK_URL: `http://127.0.0.1:${db.address().port}/apiFlightSearch/ota/normalFlightSearch/getSpecificPriceNew`, SPRING_OAUTH_CLIENT_ID: 'fake-key', SPRING_OAUTH_CLIENT_SECRET: 'fake-secret', TRUST_PROXY_LOOPBACK: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => { child.kill(); db.closeAllConnections(); await new Promise(resolve => db.close(resolve)); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve(); } });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
  });
  const call = (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options);
  const home = await call('/');
  assert.equal(home.status, 200); assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  const logo = await call('/nexahub-logo.png');
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await logo.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  for (const path of ['/.env', '/.git/config', '/server.mjs', '/backend/supabase-client.mjs', '/supabase/schema.sql', '/README.md']) assert.equal((await call(path)).status, 404, path);
  for (const path of ['/api/wallet', '/api/bookings', '/api/topups', '/api/flights', '/api/backend/status']) assert.equal((await call(path)).status, 401, path);
  const initialWrites = writes;
  for (const path of ['/api/bookings/OTHER/issue', '/api/bookings/OTHER/change-pay', '/api/bookings/OTHER/refund-submit', '/api/admin/topups/OTHER/approve']) assert.equal((await call(path, { method: 'POST' })).status, 401);
  assert.equal(writes, initialWrites);
  assert.equal((await call('/api/topups', { method: 'POST', headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await call('/api/topups', { method: 'POST', body: 'not-json' })).status, 415);
  const auth = { authorization: 'Bearer agent-test' };
  assert.equal((await call('/api/flights/price', { method: 'POST' })).status, 401);
  const quoteBody = { flights: [{ spring: { segHeadId: 123, cabinType: 3, adultCabin: 'S', combId: 1, combType: 1, combPrice: 100, moneyClassId: 0 } }], passengers: { adults: 1, children: 1, infants: 1 } };
  const priced = await call('/api/flights/price', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(quoteBody) });
  assert.equal(priced.status, 200);
  const quote = await priced.json(); assert.equal(quote.total, 160); assert.ok(quote.quoteId); assert.equal(quote.breakdown.length, 3);
  quoteBody.passengers.children = -1;
  assert.equal((await call('/api/flights/price', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(quoteBody) })).status, 400);
  assert.equal(priceCalls, 1);
  assert.equal((await call('/api/flights/prices', { method: 'POST' })).status, 401);
  const batchBody = { selections: [quoteBody.flights, quoteBody.flights], passengers: { adults: 1, children: 1, infants: 1 } };
  const batch = await call('/api/flights/prices', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(batchBody) });
  assert.equal(batch.status, 200);
  assert.deepEqual((await batch.json()).results.map(result => result.price.total), [160, 160]);
  assert.equal(priceCalls, 3);
  batchBody.selections = Array(33).fill(quoteBody.flights);
  assert.equal((await call('/api/flights/prices', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(batchBody) })).status, 400);
  assert.equal(priceCalls, 3);
  assert.equal((await call('/api/admin/overview', { headers: auth })).status, 403);
  assert.equal((await call('/api/backend/status', { headers: auth })).status, 403);
  for (const action of ['issue', 'refund-submit', 'sync']) assert.equal((await call(`/api/bookings/OTHER/${action}`, { method: 'POST', headers: auth })).status, 403);
  assert.equal((await call('/api/bookings/OTHER/change-submit', { method: 'POST', headers: auth })).status, 403);
  assert.equal((await call('/api/admin/wallet-reset', { method: 'POST', headers: { authorization: 'Bearer admin-test' } })).status, 403);
  for (let index = 0; index < 30; index++) assert.equal((await call('/api/auth/login', { method: 'POST' })).status, 400);
  const limited = await call('/api/auth/login', { method: 'POST' });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
