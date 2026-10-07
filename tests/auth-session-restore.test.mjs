import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const auth = readFileSync(new URL('../auth.js', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../session-activity.js', import.meta.url), 'utf8');

function fixture({ status = 200, body, storedDeadline = 99999999 } = {}) {
  let now = 1000;
  const profile = { id: 'self', role: 'agent', full_name: 'Mock Agent' };
  const values = new Map([['flightb2b-session', JSON.stringify({ accessToken: 'cookie', refreshToken: 'cookie',
    expiresAt: 99999999, profile, idleExpiresAt: storedDeadline, sessionExpiresAt: 43201000 })]]);
  const calls = [], intervals = new Map(), listeners = {}, classes = new Set();
  const notice = { textContent: '', hidden: true }, form = { addEventListener() {} };
  const root = { hidden: false, innerHTML: '', textContent: '', querySelector: key => key === 'form' ? form : notice };
  const doc = { visibilityState: 'visible', querySelector: key => key === '#auth-root' ? root : null,
    querySelectorAll: () => [], addEventListener: (key, fn) => { listeners[key] = fn; },
    body: { classList: { remove: (...items) => items.forEach(item => classes.delete(item)), add: item => classes.add(item) } } };
  class Clock extends Date { static now() { return now; } }
  const ctx = { Date: Clock, URLSearchParams, document: doc, location: { hash: '', origin: 'http://portal.invalid' },
    sessionStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    safeHtml: value => value, setTimeout: () => 1, clearTimeout() {},
    setInterval: fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),
    fetch: async (path, options) => {
      calls.push({ path, body: options?.body });
      if (path === '/api/auth/session') return { ok: status === 200, status, json: async () => body ?? {
        idleExpiresAt: 1201000, sessionExpiresAt: 43201000, profile } };
      if (path === '/api/auth/logout') return { ok: true, json: async () => ({ ok: true }) };
      throw new Error('Unexpected request: ' + path);
    } };
  ctx.window = ctx;
  vm.createContext(ctx); vm.runInContext(activity, ctx); vm.runInContext(auth, ctx);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { calls, root, notice, values, classes, flush, advance: async ms => {
    now += ms; for (const tick of [...intervals.values()]) tick(); await flush();
  } };
}

test('reload verifies the cookie before showing signed-in UI and replaces cached deadlines', async () => {
  const f = fixture();
  assert.equal(f.root.hidden, false);
  assert.equal(f.classes.has('role-agent'), false);
  await f.flush();
  assert.equal(f.root.hidden, true);
  assert.equal(f.classes.has('role-agent'), true);
  assert.equal(JSON.parse(f.values.get('flightb2b-session')).idleExpiresAt, 1201000);
  assert.deepEqual(f.calls.map(item => item.path), ['/api/auth/session']);
});
test('reload with an expired cookie cannot trust a future deadline in browser storage', async () => {
  const f = fixture({ status: 401 }); await f.flush();
  assert.equal(f.root.hidden, false);
  assert.equal(f.classes.has('role-agent'), false);
  assert.equal(f.values.has('flightb2b-session'), false);
  assert.match(f.notice.textContent, /session expired/i);
  assert.deepEqual(f.calls.map(item => item.path), ['/api/auth/session', '/api/auth/logout']);
});
test('restored auth UI logs out at twenty minutes without any activity request', async () => {
  const f = fixture(); await f.flush();
  await f.advance(19 * 60000); assert.equal(f.root.hidden, true);
  await f.advance(60000); assert.equal(f.root.hidden, false);
  assert.equal(f.values.has('flightb2b-session'), false);
  assert.match(f.notice.textContent, /inactivity/i);
  assert.equal(f.calls.filter(item => item.path === '/api/auth/activity').length, 0);
});
test('malformed snapshot fails closed rather than showing a cached signed-in account', async () => {
  const f = fixture({ body: { ok: true } }); await f.flush();
  assert.equal(f.root.hidden, false);
  assert.equal(f.values.has('flightb2b-session'), false);
});
