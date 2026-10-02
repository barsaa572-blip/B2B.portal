import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptPortalInvitation, createUser, resendPortalInvitation } from '../backend/supabase-client.mjs';

const hash = 'a'.repeat(64);
const valid = { tokenHash: hash, newPassword: 'StrongPassword1!', confirmPassword: 'StrongPassword1!' };
function mockProvider(t, options = {}) {
  const previous = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://database.test', SUPABASE_PUBLISHABLE_KEY: 'fake-public', SUPABASE_SECRET_KEY: 'fake-secret' });
  t.after(() => { for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
    if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  } });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (href, init) => {
    const url = new URL(href); assert.equal(url.origin, 'https://database.test');
    const call = { path: url.pathname, search: url.search, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers };
    calls.push(call);
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (call.path === '/auth/v1/verify') return options.expired ? reply({ message: 'PRIVATE_TOKEN_ERROR' }, 403) : reply({ access_token: 'server-access', refresh_token: 'server-refresh', user: { id: 'new-user' } });
    if (call.path === '/auth/v1/user' && call.method === 'GET') return reply({ id: 'new-user', email: 'agent@example.invalid' });
    if (call.path === '/rest/v1/profiles' && call.method === 'GET') return reply(options.noProfile ? [] : [{ id: 'new-user', active: !options.inactive, agency_id: options.agency || 'agency-a', role: options.role || 'agent' }]);
    if (call.path === '/rest/v1/agencies') return reply([{ active: true }]);
    if (call.path === '/auth/v1/user' && call.method === 'PUT') return reply({ id: 'new-user' }, options.weak ? 422 : 200);
    if (call.path === '/auth/v1/logout') return reply({});
    if (call.path === '/auth/v1/admin/users' && call.method === 'POST') return options.exists ? reply({ message: 'EMAIL_EXISTS' }, 422) : reply({ id: 'new-user', email: 'agent@example.invalid' });
    if (call.path === '/auth/v1/admin/users/new-user' && call.method === 'GET') return reply({ id: 'new-user', email: 'agent@example.invalid', email_confirmed_at: options.confirmed ? '2026-10-02T00:00:00Z' : null });
    if (call.path === '/rest/v1/profiles' && call.method === 'POST') return reply([call.body]);
    if (call.path === '/auth/v1/invite') return options.smtpFailed ? reply({ error: 'PRIVATE_SMTP_PASSWORD' }, 500) : reply({ id: 'new-user' });
    if (call.path === '/auth/v1/admin/users/new-user' && call.method === 'DELETE') return reply({});
    throw new Error('Unexpected fake provider route');
  });
  return calls;
}

test('invitation verifies server-side, uses assigned identity and never returns tokens', async t => {
  const calls = mockProvider(t);
  assert.deepEqual(await acceptPortalInvitation({ ...valid, type: 'recovery', role: 'platform_admin', userId: 'foreign' }), { ok: true });
  assert.deepEqual(calls[0].body, { type: 'invite', token_hash: hash });
  const update = calls.find(c => c.method === 'PUT');
  assert.equal(update.headers.authorization, 'Bearer server-access');
  assert.deepEqual(update.body, { password: valid.newPassword });
  assert.equal(calls.at(-1).search, '?scope=global');
});
test('bad hash, weak password and mismatch fail before consuming invitation', async t => {
  const calls = mockProvider(t);
  for (const input of [{ ...valid, tokenHash: 'bad' }, { ...valid, newPassword: 'short' }, { ...valid, confirmPassword: 'OtherPassword1!' }]) await assert.rejects(acceptPortalInvitation(input));
  assert.equal(calls.length, 0);
});
test('expired invitation errors are safe and never update a password', async t => {
  const calls = mockProvider(t, { expired: true });
  await assert.rejects(acceptPortalInvitation(valid), /expired/);
  assert.equal(calls.length, 1);
});
for (const mode of ['noProfile', 'inactive']) test(`${mode} prevents password setup and revokes temporary session`, async t => {
  const calls = mockProvider(t, { [mode]: true });
  await assert.rejects(acceptPortalInvitation(valid));
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  assert.equal(calls.at(-1).path, '/auth/v1/logout');
});
test('provider password rejection permits a scoped retry without consuming link twice', async t => {
  const options = { weak: true }, calls = mockProvider(t, options); let pending;
  await assert.rejects(acceptPortalInvitation(valid, { onVerified: session => { pending = session; } }), /five minutes/);
  assert.equal(pending.tokenHash, hash);
  assert.equal(calls.filter(c => c.path === '/auth/v1/logout').length, 0);
  options.weak = false;
  assert.deepEqual(await acceptPortalInvitation(valid, { session: pending }), { ok: true });
  assert.equal(calls.filter(c => c.path === '/auth/v1/verify').length, 1);
  assert.equal(calls.at(-1).path, '/auth/v1/logout');
});
test('new accounts have no admin password or auto-confirmation; profile precedes email', async t => {
  const calls = mockProvider(t);
  assert.equal((await createUser({ email: 'agent@example.invalid', password: 'Ignored1!', fullName: 'Test Agent', phone: '99112233', agencyId: 'agency-a', role: 'agent' })).invitationSent, true);
  assert.deepEqual(calls[0].body, { email: 'agent@example.invalid', email_confirm: false });
  assert.equal(calls[1].path, '/rest/v1/profiles');
  assert.equal(calls[2].path, '/auth/v1/invite');
});
test('SMTP failure cleans up only the newly created auth account', async t => {
  const calls = mockProvider(t, { smtpFailed: true });
  await assert.rejects(createUser({ email: 'agent@example.invalid', fullName: 'Test Agent', phone: '99112233', agencyId: 'agency-a', role: 'agent' }), /SMTP/);
  assert.equal(calls.at(-1).path, '/auth/v1/admin/users/new-user');
  assert.equal(calls.at(-1).method, 'DELETE');
});
test('existing account failure never modifies or deletes that account', async t => {
  const calls = mockProvider(t, { exists: true });
  await assert.rejects(createUser({ email: 'agent@example.invalid', fullName: 'Test Agent', phone: '99112233', agencyId: 'agency-a', role: 'agent' }));
  assert.equal(calls.length, 1);
});
test('resend uses the assigned auth email, never a browser-supplied recipient', async t => {
  const calls = mockProvider(t);
  assert.equal((await resendPortalInvitation({ id: 'manager', role: 'office_manager', agency_id: 'agency-a' }, 'new-user')).invitationSent, true);
  assert.deepEqual(calls.at(-1).body, { email: 'agent@example.invalid' });
});
for (const options of [{ agency: 'foreign' }, { role: 'office_manager' }, { inactive: true }]) test(`manager cannot resend to foreign, peer or inactive accounts: ${JSON.stringify(options)}`, async t => {
  const calls = mockProvider(t, options);
  await assert.rejects(resendPortalInvitation({ id: 'manager', role: 'office_manager', agency_id: 'agency-a' }, 'new-user'), /not permitted/);
  assert.equal(calls.length, 1);
});
test('confirmed accounts cannot be re-invited or have passwords changed by resend', async t => {
  const calls = mockProvider(t, { confirmed: true });
  await assert.rejects(resendPortalInvitation({ id: 'admin', role: 'platform_admin' }, 'new-user'), /already confirmed/);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
});
test('agents cannot resend and a pending setup cannot switch to another hash', async t => {
  const calls = mockProvider(t);
  await assert.rejects(resendPortalInvitation({ id: 'agent', role: 'agent' }, 'new-user'));
  await assert.rejects(acceptPortalInvitation(valid, { session: { tokenHash: 'b'.repeat(64), access_token: 'never-use' } }), /current invitation/);
  assert.equal(calls.length, 0);
});
