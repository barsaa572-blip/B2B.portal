import test from 'node:test';
import assert from 'node:assert/strict';
import money from '../money-display.js';
import {fundingQuote,invoiceNumber} from '../backend/cny-funding.mjs';
import {retailTicket,retailAmount,retailComponents,agencyPrice} from '../backend/retail-pricing.mjs';
import {invoiceModel,invoiceHtml,invoicePdf} from '../backend/topup-invoice.mjs';
import {PDFDocument} from 'pdf-lib';
const rate={nonCashSellMnt:538,fundingRateDate:'2026-10-08'};
test('funding preserves fractional sell FX in new quote without modifying saved quotes',()=>{
  const saved=fundingQuote('10000',rate);
  const fresh=fundingQuote('10000',{...rate,nonCashSellMnt:538.3});
  assert.equal(fresh.rateMnt,538.3);assert.equal(fresh.rows[0].amountMnt,5383000);
  assert.equal(fresh.totalCny,10359.29);
  assert.equal(saved.rateMnt,538);assert.equal(saved.totalCny,10359.3);
});
export const savedInvoice = quote => ({invoice_number:'INV-CNY-TEST',created_at:'2026-10-08T01:00:00Z',agencyName:'ТЕСТ БАЙГУУЛЛАГА',agencyRegistrationNumber:'1234567',
  pricing_model:quote.model,funding_quote:quote,amount_cny:quote.principalCny,amount_mnt:quote.rows[0].amountMnt,
  service_fee_mnt:quote.rows[1].amountMnt,correspondent_fee_mnt:quote.rows[2].amountMnt,bank_transfer_fee_mnt:quote.rows[3].amountMnt,total_mnt:quote.totalMnt,status:'pending'});
test('charge/refund MNT rounding is exact to ten, CNY stays untouched',()=>{
  assert.equal(money.roundMnt('2000','536.29'),1072580);
  assert.equal(money.roundMnt('2041','540.8'),1103780);
  assert.equal(money.roundMnt('1040.25','540.8','refund'),562560);
  assert.equal(money.roundMnt('10','10'),100);
  assert.equal(money.roundMnt('0.01','536.29'),10);
  assert.equal(money.roundMnt('0.01','536.29','refund'),0);
  for(const invalid of [NaN,Infinity,-1,{},'1e3','2.001','10<script>']) assert.throws(()=>money.roundMnt(invalid,538));
  assert.throws(()=>money.roundMnt('900719925474099','1000000'));
});
test('CNY principal plus upfront fees uses Golomt sell, not official or buy',()=>{
  const q=fundingQuote('10000',{...rate,effectiveRateMnt:536.29,nonCashBuyMnt:533.9});
  assert.equal(q.principalCny,10000);assert.equal(q.serviceFeeCny,300);
  assert.equal(q.correspondentFeeCny,50);assert.equal(q.bankFeeCny,9.3);assert.equal(q.totalCny,10359.3);
  assert.equal(q.rateMnt,538);assert.equal(q.totalMnt,q.rows.reduce((s,r)=>s+r.amountMnt,0));
  assert.ok(q.rows.every(r=>r.amountMnt%10===0));assert.equal(q.account.iban,'MN940015001605336659');
  assert.equal(rate.nonCashSellMnt,538);assert.equal(fundingQuote('0.50',rate).serviceFeeCny,.02);
  assert.equal(fundingQuote('50000',rate).bankTariffMnt,5000);assert.equal(fundingQuote('50000.01',rate).bankTariffMnt,10000);
  assert.equal(fundingQuote('100000',rate).correspondentFeeCny,50);assert.equal(fundingQuote('100000.01',rate).correspondentFeeCny,150);
  for(const v of ['0','-1','2000000.01','1.001','',null,{}])assert.throws(()=>fundingQuote(v,rate));
  assert.throws(()=>fundingQuote(10,{...rate,nonCashSellMnt:0}));assert.throws(()=>fundingQuote(10,{...rate,fundingRateDate:''}));
  const numbers=new Set(Array.from({length:100},invoiceNumber));assert.equal(numbers.size,100);assert.ok([...numbers].every(n=>/^INV-\d{8}-[0-9A-F]{10}$/.test(n)));
});
test('new model adds no ticket/change fee, refund excludes non-refundable funding fee',()=>{
  const previous=process.env.PRICING_MODEL;process.env.PRICING_MODEL='cny-funding-v1';
  try {
    const p={total:2000,fare:1400,taxes:600,breakdown:[{type:'adults',count:1,fare:1400,taxes:600,total:2000}]};
    const q=retailTicket(p,536.29);assert.equal(q.version,3);assert.equal(q.walletCny,2000);assert.equal(q.marginCny,0);
    assert.equal(agencyPrice(p,q).total,2000);assert.equal(q.lines[0].fareCny,1400);
    const c=retailComponents({fareDifference:100.01,changeFee:20,paymentFee:3},536.29);
    assert.equal(c.walletCny,123.01);assert.equal(c.marginCny,0);
    const r=retailAmount(1800,536.29,'refund');assert.equal(r.walletCny,1800);assert.equal(r.amountMnt,965320);assert.equal(r.marginCny,0);
  } finally {if(previous==null)delete process.env.PRICING_MODEL;else process.env.PRICING_MODEL=previous;}
});
test('saved CNY invoice uses MNT primary, frozen sell FX and CNY bank account; legacy unchanged',async()=>{
  const invoice=savedInvoice(fundingQuote(10000,rate));const model=invoiceModel(invoice);
  assert.equal(model.totalCny,10359.3);assert.equal(model.rate,538);assert.equal(model.account.iban,'MN940015001605336659');
  const html=await invoiceHtml(invoice,{stampPath:'',signaturePath:''});
  assert.match(html,/Валютын дүн \(CNY\)/);assert.match(html,/10,359.30 CNY/);assert.match(html,/2026-10-08/);
  assert.doesNotMatch(html,/MN240015001605336658/);
  const pdf=await PDFDocument.load(await invoicePdf(invoice,{stampPath:'',signaturePath:''}));assert.equal(pdf.getPageCount(),1);
  assert.throws(()=>invoiceModel({...invoice,funding_quote:null}));
  assert.throws(()=>invoiceModel({...invoice,funding_quote:{...invoice.funding_quote,totalCny:undefined}}));
  assert.throws(()=>invoiceModel({...invoice,total_mnt:1}));
  assert.throws(()=>invoiceModel({...invoice,amount_cny:1}));
});
