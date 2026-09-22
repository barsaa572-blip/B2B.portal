import test from 'node:test';
import assert from 'node:assert/strict';
import { changeOwnPassword, validatePasswordChange } from '../backend/supabase-client.mjs';

const input = { currentPassword:'Old-test-123!', newPassword:'New-test-456!', confirmPassword:'New-test-456!' };
test('password policy requires length, letter, number, symbol and matching confirmation', () => {
  for (const password of ['Ab1!', 'abcdefgh!', '12345678!', 'Abcdef123', 'Abc12345 ', 'a'.repeat(129)+'1!']) {
    assert.throws(() => validatePasswordChange({ ...input, newPassword:password, confirmPassword:password }), { status:400 });
  }
  assert.throws(() => validatePasswordChange({ ...input, confirmPassword:'different' }), /do not match/);
  assert.throws(() => validatePasswordChange({ ...input, currentPassword:input.newPassword }), /different/);
  assert.throws(() => validatePasswordChange({ ...input, currentPassword:null }), /current password/);
  assert.doesNotThrow(() => validatePasswordChange(input));
  assert.doesNotThrow(() => validatePasswordChange({ ...input, newPassword:'Монгол123!', confirmPassword:'Монгол123!' }));
});

test('password changes reauthenticate the server identity and use a user-scoped token only', async t => {
  const originalFetch = globalThis.fetch;
  const env = Object.fromEntries(['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY'].map(key => [key,process.env[key]]));
  Object.assign(process.env, { SUPABASE_URL:'http://password-test.invalid', SUPABASE_PUBLISHABLE_KEY:'public-test', SUPABASE_SECRET_KEY:'secret-never-for-passwords' });
  t.after(() => { globalThis.fetch = originalFetch; for (const [key,value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  let calls = [], badPassword = false, wrongIdentity = false, updateFailed = false;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options, body:options.body && JSON.parse(options.body) });
    assert.equal(options.headers.apikey, 'public-test');
    if (url.includes('/token?')) return Response.json(badPassword ? {} : { access_token:'fresh-user-token', user:{ id:wrongIdentity ? 'other-user' : 'self' } }, { status:badPassword ? 400 : 200 });
    assert.equal(options.headers.authorization, 'Bearer fresh-user-token');
    if (url.endsWith('/user')) return Response.json(updateFailed ? { message:input.newPassword } : { id:'self' }, { status:updateFailed ? 400 : 200 });
    assert.ok(url.includes('/logout?scope=local')); return new Response(null, { status:204 });
  };
  const profile = { id:'self', email:'self@example.invalid' };
  assert.deepEqual(await changeOwnPassword(profile, { ...input, email:'victim@example.invalid', id:'victim' }), { ok:true });
  assert.deepEqual(calls[0].body, { email:profile.email, password:input.currentPassword });
  assert.equal(calls[1].method,'PUT');
  assert.deepEqual(calls[1].body, { password:input.newPassword, current_password:input.currentPassword });
  assert.equal(calls.length,3);
  calls=[]; badPassword=true;
  await assert.rejects(changeOwnPassword(profile,input), /verify your current password/);
  assert.equal(calls.length,1);
  calls=[]; badPassword=false; wrongIdentity=true;
  await assert.rejects(changeOwnPassword(profile,input), { status:403 });
  assert.equal(calls.filter(c => c.method==='PUT').length,0);
  assert.equal(calls.length,2);
  calls=[]; wrongIdentity=false; updateFailed=true;
  await assert.rejects(changeOwnPassword(profile,input), error => error.status === 400 && !error.message.includes(input.newPassword));
  assert.ok(calls.at(-1).url.includes('/logout'));
});
