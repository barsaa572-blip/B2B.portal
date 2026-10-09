import test from 'node:test';
import assert from 'node:assert/strict';
import money from '../money-display.js';
import {verifiedReceipt, approvalDatabaseError} from '../backend/cny-approval.mjs';

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
