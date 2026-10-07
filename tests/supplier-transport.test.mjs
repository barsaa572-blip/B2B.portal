import test from 'node:test';
import assert from 'node:assert/strict';
import { springEndpoint } from '../backend/supplier-transport.mjs';
import { createSpringClient } from '../backend/spring-client.mjs';
import { createSpringSoapClient } from '../backend/spring-soap-client.mjs';
import { readFileSync } from 'node:fs';
test('HTTP compatibility stays explicit; TLS mode refuses plaintext, credentials and unknown protocols', () => {
  assert.equal(springEndpoint('http://supplier.test:7001/path', {}), 'http://supplier.test:7001/path');
  assert.equal(springEndpoint('https://supplier.test/path', { SPRING_REQUIRE_TLS: 'true' }), 'https://supplier.test/path');
  assert.throws(() => springEndpoint('http://supplier.test', { SPRING_REQUIRE_TLS: 'true' }), /no HTTP fallback/);
  const embedded = new URL('https://supplier.test'); embedded.username = 'test-only'; embedded.password = 'test-only';
  for (const url of ['file:///private', 'ftp://supplier.test', embedded.href, 'not-a-url']) assert.throws(() => springEndpoint(url, {}), /invalid/);
});
test('SOAP rejection logs never contain raw XML or reflected free-text errors', () => {
  const source = readFileSync(new URL('../backend/spring-soap-client.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("console.warn('Spring credit payment rejected'");
  const log = source.slice(start, source.indexOf('});', start));
  assert.doesNotMatch(log, /responseXml|result\.errMsg|response:/);
  assert.match(log, /SUPPLIER_ERROR/);
});
test('SOAP TLS policy blocks plaintext before sending XML credentials or payment data', async () => {
  const client = createSpringSoapClient({ SPRING_REQUIRE_TLS: 'true', SPRING_CREDIT_PAYMENT_ENABLED: 'true',
    SPRING_XML_WSDL_URL: 'http://127.0.0.1:1/service?wsdl', SPRING_XML_USERNAME: 'test-only', SPRING_XML_PASSWORD: 'test-only' });
  await assert.rejects(client.getOrderDetailInfoC2({ orderNo: 'LOCAL-MOCK' }), /no HTTP fallback/);
  await assert.rejects(client.payInCredit4OTA({ orderNo: 'LOCAL-MOCK', orderMoney: 100 }), /no HTTP fallback/);
});
test('supplier requests reject redirects so credentials cannot follow them to another server', async t => {
  const options = [];
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    options.push(opts);
    return { ok: true, json: async () => ({ ifSuccess: 'Y', oauth2ResultDTO: { accessToken: 'fake-test' } }), text: async () => JSON.stringify({ ifSuccess: 'Y' }) };
  });
  const client = createSpringClient({ SPRING_HTTP_BASE_URL: 'https://supplier.test', SPRING_OAUTH_CLIENT_ID: 'test-only', SPRING_OAUTH_CLIENT_SECRET: 'fake-test' });
  await client.getAccessToken(); await client.searchFlights({}, 'fake-test');
  assert.equal(options.length, 2); options.forEach(o => assert.equal(o.redirect, 'error'));
});
