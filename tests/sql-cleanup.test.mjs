import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const directory = new URL('../supabase/', import.meta.url);
const read = name => readFileSync(new URL(name,directory),'utf8');

test('standalone historical SQL stops before any schema or financial operation', () => {
  for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql'))) {
    const sql=read(file);
    assert.ok(sql.startsWith('-- HISTORICAL BOOTSTRAP ONLY:'),file);
    const end=sql.indexOf('$historical_guard$;',sql.indexOf('do $historical_guard$'));
    assert.ok(end>0,file);
    assert.match(sql.slice(0,end),/HISTORICAL_SQL_DISABLED/);
    assert.match(sql.slice(0,end),/nexahub_baseline/);
  }
});

test('versioned cleanup keeps invoices indefinite without touching business rows or financial RPCs', () => {
  const files=readdirSync(new URL('migrations/',directory));
  const sql=read('migrations/'+files.find(f=>f.endsWith('_retire_expiry_optimize_access.sql')));
  assert.match(sql,/alter column expires_at drop default/);
  assert.match(sql,/alter column expires_at drop not null/);
  assert.match(sql,/INVOICE_EXPIRY_DISABLED/);
  assert.doesNotMatch(sql,/\b(insert into|delete from|update public|truncate|drop table)\b/i);
  assert.doesNotMatch(sql,/create or replace function public\.(approve|issue|settle|record_change)/);
  assert.equal((sql.match(/create index if not exists/g)||[]).length,14);
  assert.equal((sql.match(/alter policy /g)||[]).length,4);
  assert.match(sql,/from public, anon;/);
  assert.match(sql,/to authenticated, service_role;/);
  const client=readFileSync(new URL('../backend/supabase-client.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(client,/expirePendingTopupRequests|rpc\/expire_pending_topup_requests/);
  assert.doesNotMatch(read('remove-topup-expiry.sql'),/create or replace function public\.approve_topup_request/);
});

test('baseline verifies existing schema, guards occupied empty projects and captures schema only', () => {
  const files=readdirSync(new URL('migrations/',directory));
  const sql=read('migrations/'+files.find(f=>f.endsWith('_nexahub_baseline.sql')));
  assert.match(sql,/BASELINE_DRIFT/);
  assert.match(sql,/BASELINE_REQUIRES_EMPTY_PROJECT/);
  assert.match(sql,/COLLATE "C"/);
  const catalog=JSON.parse(read('baseline-catalog.json'));
  assert.equal(catalog.tables.length,12);
  assert.equal(catalog.functions.length,29);
  assert.ok(catalog.tables.every(t=>t.rls));
  assert.ok(!('rows' in catalog));
  const journal=JSON.parse(read('migration-journal.json'));
  assert.equal(journal.migrations.length,4);
  assert.deepEqual(journal.migrations.map(m=>`${m.version}_${m.name}.sql`).sort(),files.sort());
});
