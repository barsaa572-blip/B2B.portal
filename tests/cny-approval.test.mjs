import test from 'node:test';
import assert from 'node:assert/strict';
import money from '../money-display.js';
import {verifiedReceipt, approvalDatabaseError} from '../backend/cny-approval.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('CNY input groups thousands, preserves decimals and caret during edits', () => {
  for (const [raw, expected] of [['10000','10,000'],['100000','100,000'],['100000.50','100,000.50'],['10000.','10,000.'],['10000.50','10,000.50'],['10,0000','100,000'],['0.05','0.05']]) {
    assert.equal(money.formatCnyInput(raw).value, expected);
  }
  assert.deepEqual(money.formatCnyInput('10,9000',4),{value:'109,000',caret:3});
  for (const raw of ['1e4','-10','100.123','10<script>','1.2.3']) assert.equal(money.formatCnyInput(raw).value,raw);
  assert.equal(money.normalizeCnyInput(' 10,359.30 '),'10359.30');
  for (const raw of ['10,35.30','1e4','100.','-1',false,null,'1 000','1,00,000']) assert.throws(()=>money.normalizeCnyInput(raw));
});

test('receipt validation accepts grouped exact CNY without weakening confirmation', () => {
  const r={confirmed:true,bankReference:' BANK-TEST ',receivedCny:'10,359.30'};
  assert.deepEqual(verifiedReceipt(r),{reference:'BANK-TEST',amount:10359.3});
  assert.equal(r.receivedCny,'10,359.30');
  for (const change of [{confirmed:false},{bankReference:'123'},{bankReference:'<script>'},{receivedCny:'10359.301'},{receivedCny:'0'},{receivedCny:'3000000.01'},{receivedCny:NaN}]) {
    assert.throws(()=>verifiedReceipt({...r,...change}),e=>e.status===400 && e.code.startsWith('TOPUP_'));
  }
});

test('only known approval business failures expose safe coded messages', () => {
  const known=approvalDatabaseError({code:'P0001',message:'Receipt differs from the invoice; reconcile before credit',details:'PRIVATE TOKEN'});
  assert.equal(known.status,409);assert.equal(known.code,'TOPUP_AMOUNT_MISMATCH');assert.doesNotMatch(known.message,/PRIVATE/);
  assert.equal(approvalDatabaseError({code:'23505',message:'secret database details'}).code,'TOPUP_RECEIPT_DUPLICATE');
  assert.equal(approvalDatabaseError({code:'PGRST202',message:'private schema'}).code,'TOPUP_SCHEMA_UNAVAILABLE');
  for(const data of [null,{}, {code:'P0001',message:'PRIVATE TOKEN'}, {code:'unexpected',message:'Receipt differs from the invoice; reconcile before credit'}]) {
    const error=approvalDatabaseError(data);assert.equal(error.status,503);assert.equal(error.code,'TOPUP_SERVICE_UNAVAILABLE');assert.doesNotMatch(error.message,/PRIVATE|schema|Receipt differs/);
  }
});

// Exercise the actual dialog handler, with controls/API mocked and no financial writes.
function approvalHarness(model='cny-funding-v1') {
  const admin=readFileSync(new URL('../admin.js',import.meta.url),'utf8');
  const source=admin.slice(admin.indexOf('  const openTopupApproval ='),admin.indexOf('  const openAgency ='));
  assert.doesNotMatch(source,/\b(?:prompt|confirm)\(/);
  const reference={value:'',disabled:false},amount={value:'',disabled:false,addEventListener(){},setSelectionRange(){}},submit={disabled:false},cancel={disabled:false},close={disabled:false},error={hidden:true,textContent:''};
  const form={querySelector:selector=>selector==='.admin-form-error'?error:selector==='[name="receivedCny"]'?amount:null,querySelectorAll:()=>[reference,amount,submit,cancel,close]};
  const element={open:false,innerHTML:'',setAttribute(){},querySelector:selector=>selector==='form'?form:selector==='.close'?close:cancel,showModal(){this.open=true;},close(){this.open=false;}};
  const calls=[],notifications=[];
  const current={profile:{id:'admin',role:'platform_admin'}};
  let request=async()=>({});
  const invoice={id:'invoice',invoice_number:'INV-TEST',amount_cny:10000,pricing_model:model,funding_quote:{totalCny:10359.29}};
  const context={byId:()=>element,session:()=>current,modal:()=>element,agency:()=>({name:'Mock Agency'}),safeHtml:value=>value,escape:value=>String(value),cny:value=>`¥ ${Number(value).toFixed(2)}`,PortalMoney:money,isPlatformAdmin:()=>current.profile?.role==='platform_admin',notify:value=>notifications.push(value),load:async()=>{},api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return request();},FormData:class {get(key){return key==='bankReference'?reference.value:amount.value;}}};
  vm.runInNewContext(source+'\nglobalThis.openApproval=openTopupApproval;',context);
  const open=()=>context.openApproval(invoice),send=()=>form.onsubmit({preventDefault(){}});
  return {open,send,element,form,reference,amount,submit,cancel,close,error,calls,current,invoice,notifications,setRequest:fn=>request=fn};
}

test('one approval dialog starts with no attestation; cancellation makes no request',()=>{
  const h=approvalHarness();h.open();
  assert.equal(h.element.open,true);assert.equal(h.amount.value,'');assert.equal(h.calls.length,0);
  assert.match(h.element.innerHTML,/Confirm approval/);assert.match(h.element.innerHTML,/name="bankReference"/);
  h.cancel.onclick();assert.equal(h.element.open,false);assert.equal(h.calls.length,0);
});

test('dialog keeps invalid reference and mismatched principal inline, without a POST',async()=>{
  const h=approvalHarness();h.open();h.reference.value='<script>';h.amount.value='10,359.29';
  await h.send();assert.equal(h.error.hidden,false);assert.equal(h.calls.length,0);
  h.reference.value='BANK-TEST';h.amount.value='10,000';await h.send();
  assert.match(h.error.textContent,/таарахгүй/);assert.equal(h.element.open,true);assert.equal(h.calls.length,0);
});

test('single final submit sends exact confirmed receipt and blocks duplicate/cancel while pending',async()=>{
  const h=approvalHarness();h.open();h.reference.value=' BANK-TEST ';h.amount.value='10,359.29';
  let finish;h.setRequest(()=>new Promise(resolve=>finish=resolve));
  const pending=h.send();assert.equal(h.submit.disabled,true);await h.send();h.cancel.onclick();
  let prevented=false;h.element.oncancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.element.open,true);
  assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body,{confirmed:true,bankReference:'BANK-TEST',receivedCny:'10359.29'});
  finish({});await pending;assert.equal(h.element.open,false);
});

test('safe backend failure stays in the same dialog and clears the submit lock',async()=>{
  const h=approvalHarness();h.open();h.reference.value='BANK-TEST';h.amount.value='10,359.29';
  h.setRequest(async()=>{throw Object.assign(new Error('Mismatch'),{code:'TOPUP_AMOUNT_MISMATCH'});});
  await h.send();assert.equal(h.element.open,true);assert.equal(h.submit.disabled,false);assert.match(h.error.textContent,/TOPUP_AMOUNT_MISMATCH/);
});

test('approval refuses a switched account or missing saved total; legacy remains explicit',async()=>{
  const h=approvalHarness();h.open();h.reference.value='BANK-TEST';h.amount.value='10,359.29';h.current.profile.id='other';
  await h.send();assert.equal(h.calls.length,0);
  const missing=approvalHarness();missing.invoice.funding_quote=null;missing.open();assert.equal(missing.element.open,false);assert.equal(missing.calls.length,0);
  const legacy=approvalHarness('legacy');legacy.open();await legacy.send();assert.deepEqual(legacy.calls[0].body,{});
});
