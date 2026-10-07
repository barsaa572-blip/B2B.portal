import test from 'node:test';
import assert from 'node:assert/strict';
import { hardenedNginx, setEnvironment } from '../scripts/apply-vps-security.mjs';
import { parseEnvironment, publicConfiguration } from '../scripts/vps-security-preflight.mjs';
const nginx = `server {\n server_name nexahub.airsales.ub.mn;\n listen 443 ssl; # Certbot\n add_header Strict-Transport-Security "max-age=300" always;\n location / {\n proxy_pass http://127.0.0.1:4173;\n proxy_set_header Host $host;\n }\n}\n`;
test('HSTS becomes host-only one year, suppresses upstream duplicates and retains proxy/Certbot settings', () => {
  const value = hardenedNginx(nginx);
  assert.match(value, /max-age=31536000/); assert.doesNotMatch(value, /max-age=300|includeSubDomains|preload/);
  assert.match(value, /proxy_hide_header Strict-Transport-Security;/);
  assert.match(value, /proxy_pass http:\/\/127.0.0.1:4173;/);
  assert.match(value, /listen 443 ssl; # Certbot/);
  assert.equal(hardenedNginx(value), value);
  assert.throws(() => hardenedNginx(nginx.replace('nexahub.airsales.ub.mn', 'other.example')), /unexpected domains/);
});
test('missing HSTS is inserted only in expected TLS site', () => {
  const value = hardenedNginx(nginx.replace(/ add_header[^\n]+\n/, ''));
  assert.match(value, /max-age=31536000/);
  assert.throws(() => hardenedNginx('server_name nexahub.airsales.ub.mn;'), /listener/);
});
test('activation changes only named settings, rejects duplicates and does not change supplier endpoints', () => {
  const input = 'SPRING_TOKEN_URL=http://supplier.test:7001/path\nAUTH_EMAIL_OTP_REQUIRED=false\n# keep me\n';
  const output = setEnvironment(input, { AUTH_EMAIL_OTP_REQUIRED: 'true', AUTH_DEVICE_SECRET: 'test-only-placeholder' });
  assert.match(output, /SPRING_TOKEN_URL=http:\/\/supplier.test:7001\/path/);
  assert.match(output, /AUTH_EMAIL_OTP_REQUIRED=true/); assert.match(output, /# keep me/);
  assert.throws(() => setEnvironment(input + 'AUTH_EMAIL_OTP_REQUIRED=false\n', { AUTH_EMAIL_OTP_REQUIRED: 'true' }), /duplicate/);
});
test('preflight exposes only flags and URL protocols/hosts, never credentials or sensitive URL parts', () => {
  const url = new URL('https://supplier.test/path');
  url.username = 'test-only'; url.password = 'fake-private-password'; url.searchParams.set('token', 'private-token');
  const env = parseEnvironment('AUTH_EMAIL_OTP_REQUIRED=true\nAUTH_DEVICE_SECRET="' + 'a'.repeat(64) + '"\nSPRING_TOKEN_URL=' + url.href + '\nSUPABASE_SECRET_KEY=private-service-key\n');
  const output = JSON.stringify(publicConfiguration(env));
  assert.match(output, /supplier.test/); assert.match(output, /https:/);
  assert.doesNotMatch(output, /private-password|private-token|private-service-key|\/path|aaaa/);
});
