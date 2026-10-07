import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStaging, productionReference } from '../deploy/staging/safety.mjs';
import { authOnlyEnvironment } from '../deploy/staging/auth-only.mjs';
import { parseEnvironment } from '../scripts/vps-security-preflight.mjs';
import { environmentPage } from '../backend/environment-page.mjs';
import { blockedSupplierRoute, springEndpoint } from '../backend/supplier-transport.mjs';
import { createSpringClient, getSpringStatus } from '../backend/spring-client.mjs';
import { createSpringSoapClient, getSpringSoapStatus } from '../backend/spring-soap-client.mjs';

const live = { SUPABASE_URL: 'https://live.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'fake-public', SUPABASE_SECRET_KEY: 'fake-live-secret', SPRING_HTTP_BASE_URL: 'https://live-supplier.invalid', SPRING_OAUTH_CLIENT_ID: 'fake-live-client', SPRING_OAUTH_CLIENT_SECRET: 'fake-live-supplier-secret' };
const reference = productionReference(live);
const base = { APP_ENV: 'staging', PORT: '4174', FRONTEND_ORIGIN: 'https://test.nexahub.airsales.ub.mn', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'fake-test-public', SUPABASE_SECRET_KEY: 'fake-test-secret', STAGING_SUPPLIER_MODE: 'disabled', SPRING_BOOKING_ENABLED: 'false', SPRING_CREDIT_PAYMENT_ENABLED: 'false', SPRING_STATUS_SYNC_ENABLED: 'false', STAGING_TRANSACTIONS_CONFIRMED: 'false' };
const source = env => Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';

test('Spring-free test mode still requires a separate database, keys, origin and explicit disabled actions', () => {
  assert.doesNotThrow(() => assertStaging(base, reference));
  for (const [key, value] of Object.entries({ SUPABASE_URL: live.SUPABASE_URL, SUPABASE_SECRET_KEY: live.SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY: live.SUPABASE_PUBLISHABLE_KEY, FRONTEND_ORIGIN: 'https://nexahub.airsales.ub.mn', APP_ENV: 'production', PORT: '4173', STAGING_SUPPLIER_MODE: 'off', SPRING_BOOKING_ENABLED: 'true', SPRING_CREDIT_PAYMENT_ENABLED: '', SPRING_STATUS_SYNC_ENABLED: 'true', STAGING_TRANSACTIONS_CONFIRMED: 'true', SPRING_OAUTH_CLIENT_ID: live.SPRING_OAUTH_CLIENT_ID, SPRING_HTTP_BASE_URL: 'https://unused.invalid', SPRING_XML_PASSWORD: 'fake-unused', STAGING_SPRING_ALLOWED_ORIGINS: 'https://unused.invalid', SERPAPI_KEY: 'fake-unused' })) {
    assert.throws(() => assertStaging({ ...base, [key]: value }, reference), key);
  }
  assert.throws(() => assertStaging(base, {}));
});

test('test env preparation removes supplier values without changing test DB/auth secrets, and rejects live DB', () => {
  const input = source({ ...base, STAGING_SUPPLIER_MODE: 'spring', SPRING_OAUTH_CLIENT_ID: live.SPRING_OAUTH_CLIENT_ID, SPRING_OAUTH_CLIENT_SECRET: live.SPRING_OAUTH_CLIENT_SECRET, SPRING_HTTP_BASE_URL: live.SPRING_HTTP_BASE_URL, SERPAPI_KEY: 'fake-fallback', AUTH_DEVICE_SECRET: 'fake-test-value' });
  const output = authOnlyEnvironment(input, reference), parsed = parseEnvironment(output);
  assert.doesNotMatch(output, /fake-live|fake-fallback/);
  assert.equal(parsed.SUPABASE_SECRET_KEY, base.SUPABASE_SECRET_KEY);
  assert.equal(parsed.AUTH_DEVICE_SECRET, 'fake-test-value');
  assert.equal(parsed.SPRING_STATUS_SYNC_ENABLED, 'false');
  assert.equal(authOnlyEnvironment(output, reference), output);
  assert.throws(() => authOnlyEnvironment(source({ ...base, SUPABASE_SECRET_KEY: live.SUPABASE_SECRET_KEY }), reference));
  assert.throws(() => authOnlyEnvironment(input + 'PORT=4174\n', reference), /duplicate/);
  assert.throws(() => authOnlyEnvironment('export PORT=4174\n' + input, reference), /unsupported/);
});

test('disabled Spring cannot create HTTP/SOAP clients, expose ready statuses, or validate a transport endpoint', () => {
  const env = { ...base, ...live, SPRING_XML_WSDL_URL: 'https://supplier.invalid?wsdl', SPRING_XML_USERNAME: 'fake-user', SPRING_XML_PASSWORD: 'fake-password', SPRING_CREDIT_PAYMENT_ENABLED: 'true' };
  assert.throws(() => createSpringClient(env), /disabled/);
  assert.throws(() => createSpringSoapClient(env), /disabled/);
  assert.throws(() => springEndpoint('https://supplier.invalid', env), /disabled/);
  assert.equal(getSpringStatus(env).httpJsonReady, false);
  assert.equal(getSpringSoapStatus(env).orderDetailReady, false);
  assert.equal(getSpringSoapStatus(env).creditPaymentReady, false);
});

test('disabled mode denies all flight and booking actions including future routes, but permits only local reads', () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    for (const path of ['/api/flights', '/api/flights/price', '/api/flights/prices', '/api/flights/new-action', '/api/bookings/ABC/sync', '/api/bookings/ABC/issue', '/api/bookings/ABC/change-options', '/api/bookings/ABC/refund-submit', '/api/bookings/ABC/new-action']) assert.equal(blockedSupplierRoute(path, method, base), true, `${method} ${path}`);
  }
  for (const path of ['/api/bookings', '/api/bookings/dashboard', '/api/bookings/ABC/ticket.pdf', '/api/bookings/ABC/receipt.pdf']) {
    assert.equal(blockedSupplierRoute(path, 'GET', base), false);
    assert.equal(blockedSupplierRoute(path, 'POST', base), true);
  }
  for (const path of ['/api/auth/login', '/api/auth/activity', '/api/wallet', '/api/invoices/ABC', '/api/admin/overview']) assert.equal(blockedSupplierRoute(path, 'POST', base), false);
  assert.equal(blockedSupplierRoute('/api/flights', 'GET', {}), false);
});

test('supplier-disabled banner is test-only and cannot change production HTML', () => {
  const html = '<html lang="en"><head><title>NEXAHUB</title></head><body></body></html>';
  assert.match(environmentPage(html, 'staging', 'disabled'), /Spring OFF/);
  assert.doesNotMatch(environmentPage(html, 'staging', 'spring'), /Spring OFF/);
  assert.equal(environmentPage(html, 'production', 'disabled'), html);
});
