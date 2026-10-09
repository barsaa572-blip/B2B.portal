// Isolated PostgreSQL/WASM only. No production access, credentials or supplier calls.
import { PGlite } from '../.tmp-retail-db/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const read = file => readFile(new URL(file, migrations), 'utf8');
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const files = (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort();
  const baselineFile = files.find(f => f.endsWith('_nexahub_baseline.sql'));
  const cleanupFile = files.find(f => f.endsWith('_retire_expiry_optimize_access.sql'));
  const baseline = await read(baselineFile), cleanup = await read(cleanupFile);
  await db.exec(`begin; ${baseline} commit;`);
  const catalogQuery = baseline.match(/with snapshot as \(([\s\S]*?)\) select md5\(catalog::text\)/)[1];
  const actualCatalog = (await db.query(catalogQuery)).rows[0].catalog;
  const expectedCatalog = JSON.parse(await readFile(new URL('../supabase/baseline-catalog.json',import.meta.url),'utf8'));
  const normalized = value => JSON.parse(JSON.stringify(value, (key,v) => key==='acl' && typeof v==='string'
    ? '{'+v.slice(1,-1).split(',').sort().join(',')+'}' : key==='definition' && typeof v==='string' ? v.replace(/\r\n/g,'\n') : v));
  for(const kind of Object.keys(expectedCatalog)) {
    const sort = rows => rows.sort((a,b)=>JSON.stringify(a.signature||a.name||a.tablename+' '+a.policyname).localeCompare(JSON.stringify(b.signature||b.name||b.tablename+' '+b.policyname)));
    const actual=sort(normalized(actualCatalog[kind])), expected=sort(normalized(expectedCatalog[kind]));
    for(let index=0;index<Math.max(actual.length,expected.length);index++) {
      if(JSON.stringify(actual[index])!==JSON.stringify(expected[index])) {
        const a=actual[index],e=expected[index];
        const fields=Object.keys(e||{}).filter(k=>JSON.stringify(a?.[k])!==JSON.stringify(e[k]));
        console.error('CATALOG DIFFERENCE',kind,e?.name||e?.signature||e?.policyname,index,fields,
          fields.map(k=>[k,JSON.stringify(a?.[k])?.slice(0,140),JSON.stringify(e?.[k])?.slice(0,140)]));
      }
    }
  }
  await db.exec(`begin; ${baseline} commit;`); // Existing schema must match; no rebuild.
  const before = (await db.query(`select md5(string_agg(pg_get_functiondef(oid), '\n' order by oid)) as h
    from pg_proc where pronamespace='public'::regnamespace
      and proname not in ('current_agency_id','is_platform_admin','expire_pending_topup_requests')`)).rows[0];
  await db.exec(`begin; ${cleanup} commit;`);
  await db.exec(`begin; ${cleanup} commit;`);
  const after = (await db.query(`select md5(string_agg(pg_get_functiondef(oid), '\n' order by oid)) as h
    from pg_proc where pronamespace='public'::regnamespace
      and proname not in ('current_agency_id','is_platform_admin','expire_pending_topup_requests')`)).rows[0];
  assert.deepEqual(after,before,'Approval/payment/refund bodies must be unchanged');
  const readinessFile=files.find(f=>f.endsWith('_verify_sql_cleanup_readiness.sql'));
  await db.exec(`begin; ${await read(readinessFile)} commit;`);
  assert.equal((await db.query('select public.portal_sql_cleanup_ready() as ready')).rows[0].ready,true);
  await db.exec('set role service_role');
  assert.equal((await db.query('select public.portal_sql_cleanup_ready() as ready')).rows[0].ready,true);
  await db.exec('reset role');
  for (const name of ['platform_reset_all_wallets(uuid)','expire_pending_topup_requests()']) {
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed',[role,'public.'+name,'EXECUTE'])).rows[0].allowed,false);
    }
  }
  await assert.rejects(db.query('select public.expire_pending_topup_requests()'),{code:'42501',message:'INVOICE_EXPIRY_DISABLED'});
  const expiry = (await db.query(`select column_default,is_nullable from information_schema.columns
    where table_schema='public' and table_name='topup_requests' and column_name='expires_at'`)).rows[0];
  assert.deepEqual(expiry,{column_default:null,is_nullable:'YES'});
  const indexes = (await db.query(`select count(*)::int as n from pg_indexes where schemaname='public'
    and indexname in ('bookings_agency_id_idx','bookings_branch_id_idx','bookings_created_by_idx',
    'cny_funding_receipts_verified_by_idx','financial_operations_actor_id_idx','profiles_agency_id_idx',
    'profiles_branch_id_idx','retail_pricing_actor_id_idx','retail_pricing_settled_by_idx',
    'topup_requests_agency_id_idx','topup_requests_approved_by_idx','topup_requests_requested_by_idx',
    'wallet_transactions_agency_id_idx','wallet_transactions_created_by_idx')`)).rows[0];
  assert.equal(indexes.n,14);
  for(const helper of ['current_agency_id()','is_platform_admin()']) {
    assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed',['anon','public.'+helper,'EXECUTE'])).rows[0].allowed,false);
    assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed',['authenticated','public.'+helper,'EXECUTE'])).rows[0].allowed,true);
  }
  const ids = ['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'];
  await db.query('insert into auth.users(id) values($1),($2),($3)',ids);
  await db.query("insert into agencies(id,name) values($1,'Isolated Agency')",[ids[2]]);
  await db.query("insert into profiles(id,agency_id,role,full_name) values($1,$3,'agent','Agent'),($2,null,'platform_admin','Admin')",ids);
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[0]]);
  assert.deepEqual((await db.query('select public.current_agency_id() as agency,public.is_platform_admin() as admin')).rows[0],{agency:ids[2],admin:false});
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[1]]);
  assert.equal((await db.query('select public.is_platform_admin() as admin')).rows[0].admin,true);
  await db.exec('reset role');
  // Old entry points must stop before replacing any financial function.
  await db.exec(`create schema supabase_migrations; create table supabase_migrations.schema_migrations(name text);
    insert into supabase_migrations.schema_migrations values('nexahub_baseline');`);
  const historical = (await readdir(new URL('../supabase/',import.meta.url))).filter(f=>f.endsWith('.sql'));
  for(const file of historical) {
    await assert.rejects(db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8')),/HISTORICAL_SQL_DISABLED/);
  }
  await assert.rejects(db.exec(`begin; ${baseline} commit;`),/BASELINE_DRIFT/);
  await db.exec('rollback');
  console.log('PASS: exact baseline/repeat/drift, cleanup/repeat, 14 indexes, disabled expiry/reset, helper roles and historical SQL guards; financial functions unchanged');
} catch (error) {
  console.error('FAIL:', error.code || '', error.message);
  process.exitCode = 1;
} finally { await db.close(); }
