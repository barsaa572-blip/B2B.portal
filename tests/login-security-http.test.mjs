import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('HTTP email second-step, password rotation and bearer bypass controls use only local mocks', async t => {
  const id = '11111111-1111-4111-8111-111111111111';
  let security = null, currentPassword = 'OldPassword123!', codeValid = true, active = true, ready = true;
  const events = [];
  const provider = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {}, url = new URL(req.url, 'http://localhost');
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    events.push({ path: url.pathname, query: url.search, method: req.method, body, key: req.headers.apikey });
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') !== 'refresh_token' && body.password !== currentPassword) return reply(400, { error: 'PRIVATE_BAD_PASSWORD' });
      return reply(200, { access_token: 'server-password-token', refresh_token: 'server-password-refresh', expires_in: 3600, user: { id } });
    }
    if (url.pathname === '/auth/v1/otp') return reply(200, {});
    if (url.pathname === '/auth/v1/verify') return reply(codeValid ? 200 : 400, codeValid ? { access_token: 'server-email-token', refresh_token: 'server-email-refresh', expires_in: 3600, user: { id } } : { error: 'PRIVATE_BAD_CODE' });
    if (url.pathname === '/auth/v1/user') {
      if (req.method === 'PUT') { currentPassword = body.password; return reply(200, { id }); }
      return reply(200, { id, email: 'self@example.invalid' });
    }
    if (url.pathname === '/auth/v1/logout') return reply(200, {});
    if (url.pathname === '/rest/v1/profiles') return reply(200, [{ id, full_name: 'Mock Agent', role: 'agent', agency_id: id, active }]);
    if (url.pathname === '/rest/v1/agencies') return reply(200, [{ active: true }]);
    if (url.pathname === '/rest/v1/password_security') return reply(200, security ? [security] : []);
    if (url.pathname === '/rest/v1/rpc/portal_auth_security_ready') return reply(200, ready);
    if (url.pathname === '/rest/v1/rpc/record_portal_password_change') { security = { password_changed_at: new Date().toISOString(), revision: String(events.length) }; return reply(200, null); }
    if (url.pathname === '/rest/v1/bookings') return reply(200, []);
    if (url.pathname === '/rest/v1/rpc/claim_spring_status_checks') return reply(200, []);
    return reply(500, { error: 'Unexpected mock endpoint' });
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, PORT: String(port), APP_ENV: 'test', AUTH_EMAIL_OTP_REQUIRED: 'true', AUTH_PASSWORD_ROTATION_REQUIRED: 'true',
    AUTH_DEVICE_SECRET: 'a'.repeat(64), SUPABASE_URL: `http://127.0.0.1:${provider.address().port}`, SUPABASE_PUBLISHABLE_KEY: 'public-test', SUPABASE_SECRET_KEY: 'service-test' };
  for (const key of Object.keys(env)) if (key.startsWith('SPRING_')) env[key] = '';
  const child = spawn(process.execPath, ['server.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  });
  child.stderr.resume();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Mock portal failed to start')), 10000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve(); } });
    child.once('error', reject);
  });
  const origin = `http://127.0.0.1:${port}`;
  const call = (path, { cookie, body, noOrigin = false, authorization } = {}) => fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(noOrigin ? {} : { origin }),
      ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const cookieFrom = (response, name) => {
    const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie()
      : (response.headers.get('set-cookie') || '').split(/,\s*(?=[\w-]+=)/);
    return values.find(s => s.startsWith(name + '='))?.split(';')[0];
  };
  const login = () => call('/api/auth/login', { body: { email: 'self@example.invalid', password: currentPassword } });

  await t.test('migration and Origin gates block before issuing credentials or sending email', async () => {
    ready = false;
    assert.equal((await login()).status, 503);
    assert.equal(events.filter(e => e.path === '/auth/v1/token').length, 0); ready = true;
    assert.equal((await call('/api/auth/login', { body: { email: 'self@example.invalid', password: currentPassword }, noOrigin: true })).status, 403);
    assert.equal((await call('/api/bookings', { authorization: 'Bearer server-password-token' })).status, 401);
  });
  let pendingCookie;
  await t.test('password alone cannot read data, refresh, rotate or obtain browser tokens', async () => {
    const response = await login(); assert.equal(response.status, 200);
    assert.equal((await response.json()).nextStep, 'email'); pendingCookie = cookieFrom(response, 'nexahub_login_pending');
    assert.match(pendingCookie, /^nexahub_login_pending=[a-f0-9]{64}$/);
    assert.equal(cookieFrom(response, 'nexahub_session'), 'nexahub_session=');
    assert.equal((await call('/api/bookings', { cookie: pendingCookie })).status, 401);
    assert.equal((await call('/api/auth/refresh', { cookie: pendingCookie, body: { refreshToken: 'forged' } })).status, 401);
    assert.equal((await call('/api/auth/renew-password', { cookie: pendingCookie, body: {} })).status, 403);
    const sent = events.find(e => e.path === '/auth/v1/otp'); assert.deepEqual(sent.body, { email: 'self@example.invalid', create_user: false });
    assert.equal(sent.key, 'public-test');
  });
  await t.test('invalid code and early resend do not issue a portal session', async () => {
    codeValid = false;
    const rejected = await call('/api/auth/verify-email', { cookie: pendingCookie, body: { code: '123456' } });
    assert.equal(rejected.status, 400); assert.doesNotMatch(await rejected.text(), /PRIVATE|server-email/); codeValid = true;
    assert.equal((await call('/api/auth/resend-code', { cookie: pendingCookie, body: {} })).status, 429);
  });
  await t.test('OTP verifies only assigned email; expired password requires renewal, not data access', async () => {
    const response = await call('/api/auth/verify-email', { cookie: pendingCookie, body: { code: '123456', email: 'victim@example.invalid', role: 'platform_admin' } });
    assert.equal(response.status, 200); assert.equal((await response.json()).nextStep, 'password');
    assert.equal(cookieFrom(response, 'nexahub_session'), undefined);
    assert.equal((await call('/api/bookings', { cookie: pendingCookie })).status, 401);
    const verified = events.filter(e => e.path === '/auth/v1/verify').at(-1);
    assert.deepEqual(verified.body, { type: 'email', email: 'self@example.invalid', token: '123456' });
  });
  await t.test('password renewal records server identity, revokes sessions and asks for another login', async () => {
    const response = await call('/api/auth/renew-password', { cookie: pendingCookie, body: { currentPassword, newPassword: 'NewPassword456!', confirmPassword: 'NewPassword456!', id: 'victim' } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, signInAgain: true });
    const recorded = events.find(e => e.path === '/rest/v1/rpc/record_portal_password_change');
    assert.deepEqual(recorded.body, { p_user_id: id }); assert.equal(recorded.key, 'service-test');
    assert.ok(events.some(e => e.path === '/auth/v1/logout' && e.query === '?scope=global'));
    assert.equal((await call('/api/auth/verify-email', { cookie: pendingCookie, body: { code: '123456' } })).status, 401);
  });
  let sessionCookie, deviceCookie;
  await t.test('fresh password plus OTP gets a cookie; replay and raw OTP bearer remain blocked', async () => {
    const response = await login(); const pending = cookieFrom(response, 'nexahub_login_pending');
    const verified = await call('/api/auth/verify-email', { cookie: pending, body: { code: '123456' } });
    assert.equal(verified.status, 200); sessionCookie = cookieFrom(verified, 'nexahub_session');
    deviceCookie = cookieFrom(verified, 'nexahub_email_device_local');
    assert.ok(deviceCookie);
    const result = await verified.json(); assert.equal(result.accessToken, 'cookie'); assert.equal(result.profile.passwordSecurity, undefined);
    assert.doesNotMatch(JSON.stringify(result), /server-email|server-password/);
    assert.equal((await call('/api/bookings', { cookie: sessionCookie })).status, 200);
    assert.equal((await call('/api/bookings', { authorization: 'Bearer server-email-token' })).status, 401);
    assert.equal((await call('/api/auth/verify-email', { cookie: pending, body: { code: '123456' } })).status, 401);
  });
  await t.test('activity is authenticated and same-origin; daily receipt survives logout but cannot authenticate alone', async () => {
    assert.equal((await call('/api/auth/activity', { body: {} })).status, 401);
    assert.equal((await call('/api/auth/activity', { cookie: sessionCookie, body: {}, noOrigin: true })).status, 403);
    const touch = await call('/api/auth/activity', { cookie: sessionCookie, body: {} });
    assert.equal(touch.status, 200);
    const bounds = await touch.json(); assert.ok(bounds.idleExpiresAt > Date.now());
    assert.ok(bounds.idleExpiresAt <= bounds.sessionExpiresAt);
    const logout = await call('/api/auth/logout', { cookie: sessionCookie + '; ' + deviceCookie, body: {} });
    assert.equal(logout.status, 200); assert.equal(cookieFrom(logout, 'nexahub_email_device_local'), undefined);
    assert.equal((await call('/api/bookings', { cookie: deviceCookie })).status, 401);
    const sent = events.filter(e => e.path === '/auth/v1/otp').length;
    const loginAgain = await call('/api/auth/login', { cookie: deviceCookie, body: { email: 'self@example.invalid', password: currentPassword } });
    assert.equal(loginAgain.status, 200); assert.equal((await loginAgain.json()).accessToken, 'cookie');
    sessionCookie = cookieFrom(loginAgain, 'nexahub_session');
    assert.equal(events.filter(e => e.path === '/auth/v1/otp').length, sent);
    assert.equal((await call('/api/bookings', { cookie: sessionCookie })).status, 200);
    assert.equal((await call('/api/auth/login', { cookie: deviceCookie, body: { email: 'self@example.invalid', password: 'Wrong-password' } })).status, 401);
  });
  await t.test('password revision changes and inactive profiles invalidate existing cookies', async () => {
    security.revision = 'externally-changed';
    const refreshed = await call('/api/auth/refresh', { cookie: sessionCookie, body: {} });
    assert.equal(refreshed.status, 401);
    assert.equal(cookieFrom(refreshed, 'nexahub_session'), 'nexahub_session=');
    assert.ok(events.some(e => e.path === '/auth/v1/logout' && e.query === '?scope=local'));
    assert.equal((await call('/api/bookings', { cookie: sessionCookie })).status, 401);
    active = false; assert.equal((await login()).status, 401);
  });
});
