// Local-only PostgreSQL WASM integration test. No credentials or network calls.
// npm install --prefix .tmp-retail-db --no-save --no-package-lock --ignore-scripts @electric-sql/pglite@0.3.14
import { PGlite } from '../.tmp-retail-db/node_modules/@electric-sql/pglite/dist/index.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchema } from '../deploy/staging/build-schema.mjs';
import { retailAmount, publicRetail } from '../backend/retail-pricing.mjs';

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  await db.exec(buildSchema());
  // Re-applying the production migration must not wrap/debit a second time.
  await db.exec(readFileSync(new URL('../supabase/retail-rounding.sql', import.meta.url), 'utf8'));
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const actor = '00000000-0000-0000-0000-000000000001';
  const admin = '00000000-0000-0000-0000-000000000002';
  const agency = '00000000-0000-0000-0000-000000000003';
  await q('insert into auth.users(id) values ($1),($2)', [actor, admin]);
  await q("insert into agencies(id,name) values ($1,'Local test')", [agency]);
  await q("insert into profiles(id,agency_id,role,full_name) values ($1,$3,'agent','Agent'),($2,null,'platform_admin','Admin')", [actor, admin, agency]);
  await q('insert into wallets(agency_id,balance_cny) values ($1,9245)', [agency]);
  const booking = (await q("insert into bookings(pnr,agency_id,created_by,status,total_cny,itinerary,passengers) values ('TEST',$1,$2,'Reserved',2041,'{}','{}') returning id", [agency, actor]))[0].id;
  const snap = retailAmount(2041, 540.8);
  const store = (action, ref, snapshot) => q('select store_retail_price($1,$2,$3,$4,$5,$6)', ['TEST',action,ref,actor,snapshot,publicRetail(snapshot)]);
  const begin = (action, ref, amount, snapshot) => q('select begin_financial_operation($1,$2,$3,$4,$5,$6) as id', [actor,'TEST',action,ref,amount,publicRetail(snapshot)]);
  const balance = async () => Number((await q('select balance_cny from wallets where agency_id=$1',[agency]))[0].balance_cny);
  await store('issue','TEST',snap);
  await q('update wallets set balance_cny=2041.02 where agency_id=$1',[agency]);
  await assert.rejects(begin('issue','TEST',2041,snap),/Insufficient wallet balance/);
  assert.equal((await q('select count(*)::int as count from financial_operations'))[0].count,0,'A failed guard must roll back its operation');
  await q('update wallets set balance_cny=9245 where agency_id=$1',[agency]);
  await q("update retail_pricing set updated_at=now()-interval '16 minutes'");
  await assert.rejects(begin('issue','TEST',2041,snap),/expired or changed/);
  await store('issue','TEST',snap);
  await assert.rejects(begin('issue','TEST',2041,{...snap, amountMnt:1103900}), /confirmed retail price/);
  assert.equal(await balance(),9245);
  const issue = (await begin('issue','TEST',2041,snap))[0].id;
  await assert.rejects(store('issue','TEST',snap), /current financial operation/);
  await q('select issue_booking_from_wallet($1,$2)',[booking,actor]);
  await q("select finish_financial_operation($1,$2,'completed')",[issue,actor]);
  assert.equal(await balance(),7203.95);
  let ledger = await q('select amount_cny,amount_mnt from wallet_transactions');
  assert.equal(ledger.length,1); assert.equal(Number(ledger[0].amount_cny),-2041.05); assert.equal(Number(ledger[0].amount_mnt),-1103800);
  await assert.rejects(begin('issue','TEST',2041,snap), /already been submitted/);
  assert.equal(await balance(),7203.95);

  const change = retailAmount(100.01,540.8);
  await q("update bookings set itinerary=jsonb_build_object('changeQuotes',jsonb_build_object('12',jsonb_build_object('appId',12,'securityVersion',1,'quotedAt',now(),'amountsCny',jsonb_build_object('additionalPayment',100.01)))) where id=$1",[booking]);
  await store('change','12',change);
  const changeOp=(await begin('change','12',100.01,change))[0].id;
  await q('select record_change_payment($1,$2,$3,$4,false)',['TEST','12',100.01,actor]);
  const afterChange=await balance();
  assert.equal(afterChange,Number((7203.95-change.walletCny).toFixed(2)));
  await q('select record_change_payment($1,$2,$3,$4,false)',['TEST','12',100.01,actor]);
  assert.equal(await balance(),afterChange);
  await q("select finish_financial_operation($1,$2,'completed')",[changeOp,actor]);

  const refund=retailAmount(1040.25,540.8,'refund');
  await store('refund','123',refund);
  const refundOp=(await begin('refund','123',0,refund))[0].id;
  const settle=(who,received=1040.25)=>q('select settle_retail_refund($1,$2,$3,$4,$5)',[booking,'123',who,received,'SPRING-SETTLEMENT-TEST']);
  await assert.rejects(settle(admin),/has not completed/);
  await q("select finish_financial_operation($1,$2,'completed')",[refundOp,actor]);
  assert.equal(await balance(),afterChange,'Submission must not credit the wallet');
  await assert.rejects(settle(actor),/Administrator/);
  await assert.rejects(settle(admin,100),/amount differs/);
  await settle(admin);
  const afterRefund=Number((afterChange+refund.walletCny).toFixed(2));
  assert.equal(await balance(),afterRefund);
  await settle(admin); assert.equal(await balance(),afterRefund);
  ledger=await q('select * from wallet_transactions'); assert.equal(ledger.length,3);
  const zero=retailAmount(0.01,540.8,'refund');
  await store('refund','456',zero);
  const zeroOp=(await begin('refund','456',0,zero))[0].id;
  await q("select finish_financial_operation($1,$2,'completed')",[zeroOp,actor]);
  await q('select settle_retail_refund($1,$2,$3,$4,$5)',[booking,'456',admin,0.01,'ZERO-REFUND-TEST']);
  assert.equal(await balance(),afterRefund);assert.equal((await q('select * from wallet_transactions')).length,3);
  const permissions=await q("select has_table_privilege('authenticated','public.retail_pricing','select') as margin,has_table_privilege('authenticated','public.bookings','select') as raw_booking,has_function_privilege('authenticated','public.settle_retail_refund(uuid,text,uuid,numeric,text)','execute') as refund");
  assert.deepEqual(permissions[0],{margin:false,raw_booking:false,refund:false});
  const oldBooking=(await q("insert into bookings(pnr,agency_id,created_by,status,total_cny,itinerary,passengers) values ('LEGACY',$1,$2,'Reserved',11.11,'{}','{}') returning id",[agency,actor]))[0].id;
  const oldOp=(await q("select begin_financial_operation($1,'LEGACY','issue','LEGACY',11.11) as id",[actor]))[0].id;
  await q('select issue_booking_from_wallet($1,$2)',[oldBooking,actor]);
  await q("select finish_financial_operation($1,$2,'completed')",[oldOp,actor]);
  assert.equal(await balance(),Number((afterRefund-11.11).toFixed(2)));
  const oldLedger=(await q("select amount_cny,amount_mnt from wallet_transactions where reason='Ticket issue: LEGACY'"))[0];
  assert.equal(Number(oldLedger.amount_cny),-11.11);assert.equal(oldLedger.amount_mnt,null);
  console.log('PASS: full migration + repeat, confirmed price, atomic debit, duplicate issue/change/refund, pending refund, admin permission and hidden accounting.');
} catch (error) {
  console.error('FAIL:', error.message, error.where || '', error.position ? `SQL position ${error.position}` : '');
  process.exitCode = 1;
} finally { await db.close(); }
