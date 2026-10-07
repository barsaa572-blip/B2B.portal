import test from 'node:test';
import assert from 'node:assert/strict';
import { createRememberedEmail } from '../backend/remembered-email.mjs';

const profile = { id: 'agent-a', email: 'agent@example.invalid', passwordSecurity: { revision: 'r1' } };
const req = cookie => ({ headers: { host: 'portal.test', cookie } });
function fixture() {
  let now = 1000;
  const secret = () => 'a'.repeat(64);
  const remembered = createRememberedEmail({ secret, now: () => now });
  const headers = new Map();
  const res = { getHeader: n => headers.get(n), setHeader: (n, v) => headers.set(n, v) };
  remembered.establish(req(), res, profile);
  const cookie = headers.get('set-cookie')[0];
  return { remembered, cookie, secret, advance: ms => now += ms, now: () => now };
}
test('receipt survives server restart, is private and is not a login/session token', () => {
  const f = fixture();
  assert.match(f.cookie, /^__Host-nexahub_email_device=/);
  assert.match(f.cookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=86400; Secure/);
  assert.doesNotMatch(f.cookie, /Domain=|access_token|agent-a|agent@example/);
  const restarted = createRememberedEmail({ secret: f.secret, now: f.now });
  assert.equal(restarted.find(req(f.cookie), profile).until, 86401000);
});
test('tampering, duplicate cookies, missing key and different account/email/revision fail closed', () => {
  const f = fixture(), pair = f.cookie.split(';')[0];
  assert.equal(f.remembered.find(req(pair.replace(/.$/, 'X')), profile), null);
  assert.equal(f.remembered.find(req(pair + '; ' + pair), profile), null);
  for (const changed of [{ id: 'other' }, { email: 'other@example.invalid' }, { passwordSecurity: { revision: 'r2' } }]) {
    assert.equal(f.remembered.find(req(pair), { ...profile, ...changed }), null);
  }
  const missing = createRememberedEmail({ secret: () => '' });
  assert.throws(() => missing.assertReady(), { status: 503 });
  assert.equal(missing.find(req(pair), profile), null);
});
test('24 hour expiry is fixed, never extended by receipt reads or a new server', () => {
  const f = fixture(); f.advance(86399999);
  assert.ok(f.remembered.find(req(f.cookie), profile));
  f.advance(1); assert.equal(f.remembered.find(req(f.cookie), profile), null);
});
