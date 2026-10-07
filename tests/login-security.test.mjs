import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessions } from '../backend/browser-session.mjs';
import { createLoginSecurity, passwordDeadline, passwordDue } from '../backend/login-security.mjs';
import { createRememberedEmail } from '../backend/remembered-email.mjs';

function fixture({ email = true, rotation = true, remember = false, changed = '2026-08-31T10:20:30.000Z' } = {}) {
  let now = Date.parse('2026-10-06T00:00:00Z');
  let profile = { id: 'self', email: 'self@example.invalid', role: 'agent', passwordSecurity: changed ? { password_changed_at: changed, revision: 'r1' } : null };
  const pending = createBrowserSessions({ cookieName: 'pending', ttl: 300000, now: () => now });
  const sessions = createBrowserSessions({ now: () => now });
  const response = () => { const headers = new Map(); return { getHeader: name => headers.get(name), setHeader: (name, value) => headers.set(name, value) }; };
  let req = { headers: { host: 'portal.test' } }, res = response();
  const jar = new Map();
  const nextRequest = () => {
    for (const cookie of [].concat(res.getHeader('set-cookie') || [])) {
      const pair = cookie.split(';')[0], name = pair.split('=')[0];
      if (cookie.includes('Max-Age=0')) jar.delete(name); else jar.set(name, pair);
    }
    req = { headers: { host: 'portal.test', cookie: [...jar.values()].join('; ') } }; res = response();
  };
  const events = [];
  let badCode = false, identity = 'self', delay;
  const normal = { access_token: 'server-password-token', refresh_token: 'server-password-refresh', user: { id: 'self' }, expires_in: 3600 };
  const verified = { access_token: 'server-otp-token', refresh_token: 'server-otp-refresh', user: { id: 'self' }, expires_in: 3600 };
  const guard = createLoginSecurity({ pending, sessions, now: () => now,
    remembered: remember ? createRememberedEmail({ secret: () => 'a'.repeat(64), now: () => now }) : undefined,
    emailRequired: () => email, rotationRequired: () => rotation,
    signIn: async (email, password) => { events.push(['password', email, password]); return normal; },
    profileForToken: async () => ({ ...profile }),
    sendCode: async email => events.push(['send', email]),
    verifyCode: async (email, code) => { events.push(['verify', email, code]); if (delay) await delay; if (badCode) throw Object.assign(new Error('Invalid code'), { status: 400 }); return { ...verified, user: { id: identity } }; },
    changePassword: async (p, data) => events.push(['change', p.id, data]),
    revoke: async token => events.push(['revoke', token]),
    assertReady: async () => events.push(['ready']), limit: () => {}
  });
  return { guard, pending, sessions, events, nextRequest,
    get req() { return req; }, get res() { return res; },
    advance: ms => now += ms, changeProfile: values => profile = { ...profile, ...values },
    badCode: value => badCode = value, identity: value => identity = value, delay: value => delay = value,
    start: () => guard.start(req, res, { email: 'self@example.invalid', password: 'Password123!', role: 'platform_admin' }) };
}

test('password renewal uses calendar months, clamps month end and includes time', () => {
  assert.equal(new Date(passwordDeadline('2026-08-31T10:20:30.000Z')).toISOString(), '2027-02-28T10:20:30.000Z');
  assert.equal(new Date(passwordDeadline('2023-08-31T10:20:30.000Z')).toISOString(), '2024-02-29T10:20:30.000Z');
  assert.equal(passwordDeadline('not-a-date'), null);
  for (const value of [undefined, null, 'not-a-date', '2030-01-01T00:00:00Z']) assert.equal(passwordDue({ passwordSecurity: { password_changed_at: value } }, Date.parse('2026-10-06')), true);
  const profile = { passwordSecurity: { password_changed_at: '2026-04-06T00:00:00Z' } };
  assert.equal(passwordDue(profile, Date.parse('2026-10-05T23:59:59Z')), false);
  assert.equal(passwordDue(profile, Date.parse('2026-10-06T00:00:00Z')), true);
});

test('remembered browser still checks password but skips email for a fixed 24 hours after logout', async () => {
  const f = fixture({ remember: true }); await f.start(); f.nextRequest();
  await f.guard.verify(f.req, f.res, { code: '123456' }); f.nextRequest();
  assert.ok(f.req.headers.cookie.includes('__Host-nexahub_email_device='));
  f.sessions.clear(f.req, f.res); f.nextRequest();
  assert.equal(f.sessions.find(f.req), null);
  f.advance(23 * 3600000);
  assert.equal((await f.start()).accessToken, 'cookie');
  assert.equal(f.events.filter(e => e[0] === 'password').length, 2);
  assert.equal(f.events.filter(e => e[0] === 'send').length, 1);
  f.nextRequest(); f.sessions.clear(f.req, f.res); f.nextRequest();
  f.advance(3600000);
  assert.equal((await f.start()).nextStep, 'email');
  assert.equal(f.events.filter(e => e[0] === 'send').length, 2);
});

test('password revision change invalidates remembered email even within 24 hours', async () => {
  const f = fixture({ remember: true }); await f.start(); f.nextRequest();
  await f.guard.verify(f.req, f.res, { code: '123456' }); f.nextRequest();
  f.changeProfile({ passwordSecurity: { password_changed_at: '2026-10-06T00:00:00Z', revision: 'changed' } });
  assert.equal((await f.start()).nextStep, 'email');
});

test('password alone grants no portal authority; OTP identity comes from server', async () => {
  const f = fixture();
  assert.deepEqual(await f.start(), { nextStep: 'email', expiresIn: 300, resendAfter: 60 });
  f.nextRequest(); assert.equal(f.sessions.find(f.req), null); assert.ok(f.pending.find(f.req));
  const result = await f.guard.verify(f.req, f.res, { code: '123456', email: 'victim@example.invalid', role: 'platform_admin' });
  assert.equal(result.accessToken, 'cookie'); assert.equal(result.profile.role, 'agent');
  assert.equal(result.profile.passwordSecurity, undefined);
  assert.doesNotMatch(JSON.stringify(result), /server-otp|server-password/);
  assert.deepEqual(f.events.find(e => e[0] === 'verify'), ['verify', 'self@example.invalid', '123456']);
  const oldReq = f.req; f.nextRequest();
  assert.equal(f.sessions.find(f.req).emailVerified, true);
  assert.equal(f.sessions.find(f.req).securityRevision, 'r1');
  await assert.rejects(f.guard.verify(oldReq, f.res, { code: '123456' }), { status: 401 });
});

test('untracked old passwords require renewal AFTER OTP, with no portal access', async () => {
  const f = fixture({ changed: null }); await f.start(); f.nextRequest();
  await assert.rejects(f.guard.rotate(f.req, f.res, {}), { status: 403 });
  const value = await f.guard.verify(f.req, f.res, { code: '123456' });
  assert.equal(value.nextStep, 'password'); assert.equal(value.accessToken, undefined); assert.equal(f.sessions.find(f.req), null);
  assert.deepEqual(await f.guard.rotate(f.req, f.res, { currentPassword: 'old', newPassword: 'new' }), { ok: true, signInAgain: true });
  assert.equal(f.pending.find(f.req), null); assert.equal(f.events.filter(e => e[0] === 'change').length, 1);
});

test('five incorrect or malformed codes destroy the pending challenge', async () => {
  const f = fixture(); await f.start(); f.nextRequest(); f.badCode(true);
  for (let i = 0; i < 5; i++) await assert.rejects(f.guard.verify(f.req, f.res, { code: i ? '123456' : '<bad>' }), { status: 400 });
  assert.equal(f.pending.find(f.req), null);
  await assert.rejects(f.guard.verify(f.req, f.res, { code: '123456' }), { status: 401 });
  assert.equal(f.events.filter(e => e[0] === 'verify').length, 4);
});

test('resend never resets attempts or the five-minute absolute deadline', async () => {
  const f = fixture(); await f.start(); f.nextRequest();
  await assert.rejects(f.guard.resend(f.req, f.res), { status: 429 });
  f.badCode(true); await assert.rejects(f.guard.verify(f.req, f.res, { code: '123456' }));
  const before = f.pending.find(f.req).deadline;
  f.advance(60000); await f.guard.resend(f.req, f.res);
  assert.equal(f.pending.find(f.req).deadline, before); assert.equal(f.pending.find(f.req).attempts, 1);
  f.advance(240000);
  await assert.rejects(f.guard.verify(f.req, f.res, { code: '123456' }), { status: 401 });
});

test('wrong OTP identity or changed password revision fails closed', async () => {
  for (const change of [f => f.identity('foreign'), f => f.changeProfile({ passwordSecurity: { revision: 'changed' } })]) {
    const f = fixture(); await f.start(); f.nextRequest(); change(f);
    await assert.rejects(f.guard.verify(f.req, f.res, { code: '123456' }), { status: 401 });
    assert.equal(f.pending.find(f.req), null);
    assert.ok(f.events.some(e => e[0] === 'revoke' && e[1] === 'server-otp-token'));
  }
});

test('parallel, expired-in-flight and cancelled verification cannot issue a session', async () => {
  for (const mode of ['expire', 'cancel']) {
    const f = fixture(); await f.start(); f.nextRequest();
    let release; f.delay(new Promise(resolve => release = resolve));
    const verifying = f.guard.verify(f.req, f.res, { code: '123456' });
    await assert.rejects(f.guard.verify(f.req, f.res, { code: '123456' }), { status: 409 });
    if (mode === 'expire') f.advance(300000); else await f.guard.cancel(f.req, f.res);
    release(); await assert.rejects(verifying, { status: 401 }); assert.equal(f.sessions.find(f.req), null);
  }
});

test('disabled flags retain password login; rotation alone has no email step', async () => {
  const old = fixture({ email: false, rotation: false });
  assert.equal((await old.start()).accessToken, 'cookie'); assert.equal(old.events.filter(e => e[0] === 'send').length, 0);
  const rotate = fixture({ email: false, changed: null }); assert.equal((await rotate.start()).nextStep, 'password');
  rotate.nextRequest(); assert.equal(rotate.sessions.find(rotate.req), null);
});

test('cookie append preserves both identities; invalidation kills all user sessions', () => {
  const f = fixture(); f.sessions.establish(f.req, f.res, { userId: 'self' }); f.pending.establish(f.req, f.res, { userId: 'self' });
  assert.equal(f.res.getHeader('set-cookie').length, 2); f.nextRequest();
  assert.ok(f.sessions.find(f.req)); assert.ok(f.pending.find(f.req));
  f.sessions.invalidateUser('self'); f.pending.invalidateUser('self');
  assert.equal(f.sessions.find(f.req), null); assert.equal(f.pending.find(f.req), null);
});
