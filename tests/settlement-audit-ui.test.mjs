import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const admin=read('admin.js');
const functionSource=admin.slice(admin.indexOf('  const settlementAuditMarkup ='),admin.indexOf('  let loading ='));
const formatter=vm.runInNewContext(`${admin.match(/  const escape =[^\n]+/)[0]}\n${admin.match(/  const cny =[^\n]+/)[0]}\n${admin.match(/  const mnt =[^\n]+/)[0]}\n${functionSource}\nsettlementAuditMarkup`,{agency:()=>({name:'AIR SALES <img src=x onerror=bad>'})});
const snapshot={walletCny:750,supplierCny:750,amountMnt:402210,marginCny:0};
const entry=(action,state,pnr)=>({booking_id:pnr,action,state,reference:'REFERENCE',bookings:{pnr,agency_id:'agency'},snapshot:{...snapshot}});

test('refund audit defaults to eligible refunds, preserving original entry indices',()=>{
  const records=[entry('issue','settled','ISSUE'),entry('change','prepared','CHANGE'),entry('refund','settled','DONE'),entry('refund','awaiting_settlement','PENDING')];
  const html=formatter(records);
  assert.equal((html.match(/class="settlement-record"/g)||[]).length,1);
  assert.match(html,/PENDING/);assert.doesNotMatch(html,/>DONE<|>ISSUE<|>CHANGE</);
  assert.match(html,/data-settle-refund="3"/);assert.match(html,/Агентын wallet-д буцаах дүн/);
  assert.match(html,/¥ 750\.00 CNY/);assert.match(html,/Бодит орлогыг гүйлгээний баримттай тулгана/);
  assert.equal(records[3].state,'awaiting_settlement','Rendering cannot settle or mutate a refund');
});

test('all-records view distinguishes quotes, paid operations and already credited refunds',()=>{
  const html=formatter([entry('issue','settled','ISSUE'),entry('change','prepared','CHANGE'),entry('refund','settled','DONE'),entry('refund','awaiting_settlement','PENDING')],false);
  assert.equal((html.match(/class="settlement-record"/g)||[]).length,4);
  assert.equal((html.match(/data-settle-refund=/g)||[]).length,1);
  for(const text of ['Үнийн тооцоо','Төлбөр бүртгэгдсэн','Wallet-д буцаасан','Орлого тулгах хүлээлттэй','Энэ нь зөвхөн тооцоо'])assert.ok(html.includes(text));
});

test('audit escapes reference, agency, PNR and unknown labels; empty state explains next step',()=>{
  const malicious=entry('<script>','<img src=x>','<img src=x onerror=bad>');malicious.reference='<script>alert(1)</script>';
  const html=formatter([malicious],false);
  assert.doesNotMatch(html,/<script>|<img /);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/data-settle-refund=/);
  assert.match(formatter([]),/Батлах буцаалт одоогоор алга/);
  assert.match(formatter([],false),/Төлбөрийн бүртгэл одоогоор алга/);
});

test('audit uses wide responsive cards rather than a clipped financial table',()=>{
  const css=read('admin.css');
  assert.match(css,/#admin-modal:has\(\.settlement-audit\)\{width:min\(980px,calc\(100vw - 32px\)\)/);
  assert.match(css,/#admin-modal \.settlement-record\{[^}]*font-size:14px/);
  assert.match(css,/#admin-modal \.settlement-amounts dd\{[^}]*font-size:18px;font-weight:600/);
  assert.match(css,/@media\(max-width:650px\)[^\n]*\.settlement-amounts\{grid-template-columns:1fr/);
  assert.doesNotMatch(functionSource,/<table|<th>/);
});

test('audit still requires manual receipt confirmation and an eligible original refund',()=>{
  const handler=admin.slice(admin.indexOf("accounting.addEventListener('click'"),admin.indexOf("byId('#agency-list')?.addEventListener"));
  assert.match(handler,/entry\.action !== 'refund' \|\| entry\.state !== 'awaiting_settlement'/);
  assert.match(handler,/amount === null \|\| !amount\.trim\(\)/);
  assert.match(handler,/if \(!reference\) return/);assert.match(handler,/if \(!window\.confirm\(/);
  assert.match(handler,/reference: entry\.reference/);assert.match(handler,/bookingId: entry\.booking_id/);
  assert.match(handler,/supplierReceived: Number\(amount\), settlementReference: reference, confirmed: true/);
  assert.match(handler,/entry\.state = 'settled';\s*renderAudit\(selectedPendingOnly\)/);
  const backend=read('backend/supabase-client.mjs');
  const audit=backend.slice(backend.indexOf('export async function retailPricingAudit'),backend.indexOf('export async function settleRetailRefund'));
  assert.match(audit,/profile\.role !== 'platform_admin'/);assert.match(audit,/bookings\(pnr,agency_id\)/);
});
