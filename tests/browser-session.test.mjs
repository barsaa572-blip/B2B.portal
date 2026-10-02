import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessions } from '../backend/browser-session.mjs';

const request = (cookie = '', method = 'GET', origin) => ({
  method, headers: { host: 'portal.test', cookie, ...(origin ? { origin } : {}) }
});
function establish(sessions, req = request()) {
  let cookie;
  sessions.establish(req, { setHeader: (name, value) => {
    assert.equal(name, 'set-cookie'); cookie = value;
  } }, { access_token: 'server-only-access', refresh_token: 'server-only-refresh' });
  return cookie;
}

test('browser cookie is opaque, HttpOnly, Secure and same-site; tokens stay server-side', () => {
  const sessions = createBrowserSessions();
  const cookie = establish(sessions);
  assert.match(cookie, /^nexahub_session=[0-9a-f]{64};/);
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(cookie.includes(flag));
  assert.doesNotMatch(cookie, /server-only/);
  assert.equal(sessions.token(request(cookie)), 'server-only-access');
  assert.equal(sessions.find(request('nexahub_session=unknown')), null);
});

test('cookie mutations require same-origin for POST, PATCH and DELETE', () => {
  const sessions = createBrowserSessions();
  const cookie = establish(sessions);
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    for (const origin of [undefined, 'https://attacker.test', 'file://portal.test']) {
      assert.throws(() => sessions.checkMutation(request(cookie, method, origin)), error => error.status === 403);
    }
    assert.doesNotThrow(() => sessions.checkMutation(request(cookie, method, 'https://portal.test')));
  }
  assert.doesNotThrow(() => sessions.checkMutation(request(cookie)));
});

test('refresh cannot extend absolute expiry even if upstream includes deadline', () => {
  let now = 1000;
  const sessions = createBrowserSessions({ now: () => now, ttl: 100 });
  const cookie = establish(sessions);
  now = 1050;
  sessions.renew(request(cookie), { access_token: 'refreshed', deadline: 999999 });
  assert.equal(sessions.token(request(cookie)), 'refreshed');
  now = 1100;
  assert.equal(sessions.find(request(cookie)), null);
  assert.throws(() => sessions.renew(request(cookie), {}), error => error.status === 401);
});

test('login rotates session identity and logout invalidates the app session', () => {
  const sessions = createBrowserSessions();
  const first = establish(sessions);
  const second = establish(sessions, request(first));
  assert.notEqual(first, second);
  assert.equal(sessions.find(request(first)), null);
  assert.ok(sessions.find(request(second)));
  let cleared;
  sessions.clear(request(second), { setHeader: (_, value) => { cleared = value; } });
  assert.match(cleared, /Max-Age=0/);
  assert.equal(sessions.find(request(second)), null);
});

test('expired sessions free capacity; active session limit fails closed', () => {
  let now = 0;
  const sessions = createBrowserSessions({ now: () => now, ttl: 100, limit: 1 });
  establish(sessions);
  assert.throws(() => establish(sessions), error => error.status === 503);
  now = 100;
  assert.doesNotThrow(() => establish(sessions));
});
