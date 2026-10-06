import test from 'node:test';
import assert from 'node:assert/strict';
import { secretIndicators } from '../scripts/audit-git-secrets.mjs';

test('redacted scanner detects private keys and provider secrets without returning values', () => {
  const fake = '-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(100) + '\n-----END PRIVATE KEY-----';
  assert.deepEqual(secretIndicators(fake), ['private-key']);
  const token = 'ghp_' + 'A'.repeat(40);
  assert.deepEqual(secretIndicators(token), ['provider-secret']);
  assert.ok(!JSON.stringify(secretIndicators(token)).includes(token));
});
test('scanner distinguishes public anon JWTs, secret service JWTs and placeholders', () => {
  const jwt = role => Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ role, aud: 'authenticated' })).toString('base64url') + '.' + 'A'.repeat(40);
  assert.deepEqual(secretIndicators(jwt('service_role')), ['service-role-jwt']);
  assert.deepEqual(secretIndicators(jwt('anon')), ['public-anon-jwt-review']);
  assert.deepEqual(secretIndicators('API_KEY="YOUR_TEST_PLACEHOLDER_KEY"'), []);
  assert.deepEqual(secretIndicators('API_KEY="' + '0'.repeat(32) + '"'), ['credential-literal-review']);
});
