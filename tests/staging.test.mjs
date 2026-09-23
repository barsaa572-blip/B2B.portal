import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productionReference, assertStaging } from '../deploy/staging/safety.mjs';
import { environmentPage } from '../backend/environment-page.mjs';
import { buildSchema, migrations } from '../deploy/staging/build-schema.mjs';

const production = { SUPABASE_URL:'https://live.supabase.co', SUPABASE_PUBLISHABLE_KEY:'live-public', SUPABASE_SECRET_KEY:'live-secret', SPRING_HTTP_BASE_URL:'https://live-supplier.invalid/api', SPRING_OAUTH_CLIENT_ID:'live-client', SPRING_OAUTH_CLIENT_SECRET:'live-supplier-secret' };
const reference = productionReference(production);
const staging = { APP_ENV:'staging', PORT:'4174', FRONTEND_ORIGIN:'https://test.nexahub.airsales.ub.mn', SUPABASE_URL:'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY:'test-public', SUPABASE_SECRET_KEY:'test-secret', STAGING_SPRING_ALLOWED_ORIGINS:'https://test-supplier.invalid', SPRING_HTTP_BASE_URL:'https://test-supplier.invalid/api', SPRING_TOKEN_URL:'https://test-supplier.invalid/token', SPRING_FLIGHT_SEARCH_URL:'https://test-supplier.invalid/search', SPRING_PRICE_CHECK_URL:'https://test-supplier.invalid/price', SPRING_FARE_RULES_URL:'https://test-supplier.invalid/rules', SPRING_OAUTH_CLIENT_ID:'test-client', SPRING_OAUTH_CLIENT_SECRET:'test-supplier-secret', SPRING_BOOKING_ENABLED:'false', SPRING_CREDIT_PAYMENT_ENABLED:'false' };
test('isolated staging accepts separate endpoints without storing production secrets', () => {
  assert.doesNotThrow(() => assertStaging(staging, reference));
  const snapshot = JSON.stringify(reference);
  for (const key of ['SUPABASE_SECRET_KEY','SPRING_OAUTH_CLIENT_ID','SPRING_OAUTH_CLIENT_SECRET']) assert.ok(!snapshot.includes(production[key]));
});
test('staging refuses production database, keys, supplier targets, missing fields and transaction opt-in', () => {
  for (const [key,value] of Object.entries({ PORT:'4173', APP_ENV:'production', FRONTEND_ORIGIN:'https://nexahub.airsales.ub.mn', SUPABASE_URL:production.SUPABASE_URL, SUPABASE_SECRET_KEY:production.SUPABASE_SECRET_KEY, SPRING_OAUTH_CLIENT_SECRET:production.SPRING_OAUTH_CLIENT_SECRET, SPRING_PRICE_CHECK_URL:'https://live-supplier.invalid/price', SPRING_XML_WSDL_URL:'https://unknown.invalid?wsdl', STAGING_SPRING_ALLOWED_ORIGINS:'https://live-supplier.invalid', SPRING_BOOKING_ENABLED:'true', SPRING_CREDIT_PAYMENT_ENABLED:'true', SPRING_TOKEN_URL:'' })) {
    assert.throws(() => assertStaging({ ...staging,[key]:value }, reference), key);
  }
  assert.throws(() => assertStaging(staging, {}));
  assert.throws(() => productionReference({}));
  assert.throws(() => assertStaging({ ...staging, SPRING_TOKEN_URL:'https://user:secret@test-supplier.invalid/token' }, reference));
  assert.doesNotThrow(() => assertStaging({ ...staging, SPRING_BOOKING_ENABLED:'true', STAGING_TRANSACTIONS_CONFIRMED:'true' }, reference));
});
test('test label and noindex are staging only; production HTML remains byte-for-byte unchanged', () => {
  const input = readFileSync(new URL('../index.html',import.meta.url));
  assert.equal(environmentPage(input, undefined),input);
  assert.equal(environmentPage(input, 'production'),input);
  const page = environmentPage(input, 'staging');
  assert.match(page, /data-environment="staging"/);
  assert.match(page, /\[TEST\] NEXAHUB/);
  assert.match(page, /noindex,nofollow/);
  assert.match(page, /TEST ENVIRONMENT/);
});
test('empty test schema has an empty-project guard, one transaction and security hardening last', () => {
  const sql = buildSchema();
  assert.match(sql, /pg_tables where schemaname = 'public'/);
  assert.match(sql, /exists \(select 1 from auth.users\)/);
  assert.equal((sql.match(/^begin;$/gm)||[]).length,1);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
  assert.equal(migrations.at(-1),'security-hardening.sql');
  assert.ok(sql.indexOf('raise exception') < sql.indexOf('create type'));
  assert.equal(sql,readFileSync(new URL('../deploy/staging/empty-test-schema.sql',import.meta.url),'utf8'));
});
test('service and HTTPS config target test only and private files stay blocked', () => {
  const service=readFileSync(new URL('../deploy/staging/flightb2b-test.service',import.meta.url),'utf8');
  assert.match(service,/User=flightb2b-test/);
  assert.match(service,/ExecStart=\/opt\/nexahub-node\/bin\/node /);
  assert.doesNotMatch(service,/ExecStart=\/usr\/bin\/node /);
  assert.match(service,/InaccessiblePaths=\/etc\/flightb2b \/opt\/flightb2b/);
  assert.match(service,/MemoryMax=768M/);
  const nginx=readFileSync(new URL('../deploy/staging/nginx-https.conf',import.meta.url),'utf8');
  assert.match(nginx,/proxy_pass http:\/\/127.0.0.1:4174;/);
  assert.doesNotMatch(nginx,/default_server|:4173/);
});
