import test from 'node:test';
import assert from 'node:assert/strict';
import { roundMntCny, settleMnt, retailTicket, retailAmount, retailComponents, publicRetail, agencyPrice, agencyResponse } from '../backend/retail-pricing.mjs';
import { createRefundQuotes } from '../backend/refund-quotes.mjs';

test('agreed 2041 CNY example rounds total once and settles nearest CNY cent', () => {
  const quote = retailAmount(2041, 540.8);
  assert.equal(quote.amountMnt, 1103800);
  assert.equal(quote.walletCny, 2041.05);
  assert.equal(quote.marginCny, 0.05);
  assert.equal(quote.adjustmentMnt, 27.2);
  assert.equal(quote.conversionResidualMnt, -0.16);
  assert.equal(Number((9245 - quote.walletCny).toFixed(2)), 7203.95);
});

test('fare and taxes round per person then sum; infants can be truly zero', () => {
  const quote = retailTicket({ total: 2196524, breakdown: [{ type: 'adults', count: 2, fare: 1538966, taxes: 657558 }, { type: 'infants', count: 1, fare: 0, taxes: 0 }] }, 1);
  assert.equal(quote.lines[0].unitFareMnt, 769500);
  assert.equal(quote.lines[0].unitTaxesMnt, 328800);
  assert.equal(quote.amountMnt, 2196600);
  assert.equal(quote.lines[1].totalMnt, 0);
});

test('refund floors payout, exact hundred and zero remain unchanged', () => {
  assert.equal(retailAmount(562365, 1, 'refund').amountMnt, 562300);
  for (const value of [0, 100, 500000]) {
    assert.equal(roundMntCny(value, 1, 'charge'), value);
    assert.equal(roundMntCny(value, 1, 'refund'), value);
  }
  assert.equal(roundMntCny(100.01, 1), 200);
  assert.equal(roundMntCny(99.99, 1, 'refund'), 0);
  assert.equal(settleMnt(1103800, 540.8), 2041.05);
});

test('invalid financial inputs fail closed and agency snapshot excludes margins', () => {
  for (const value of [NaN, Infinity, -1, null, '']) assert.throws(() => retailAmount(value, 540.8));
  assert.throws(() => retailAmount(100, 0));
  assert.throws(() => retailTicket({ total: 100, breakdown: [{ count: 1, fare: 90, taxes: 20 }] }, 540.8));
  const publicQuote = publicRetail(retailAmount(2041, 540.8));
  for (const field of ['supplierCny', 'marginCny', 'adjustmentMnt', 'conversionResidualMnt']) assert.ok(!Object.hasOwn(publicQuote, field));
});

test('change components sum once and old history retains its original values',()=>{
  const snapshot=retailComponents({fareDifference:2041,changeFee:0,paymentFee:0},540.8);
  assert.equal(snapshot.amountMnt,1103800);assert.equal(snapshot.walletCny,2041.05);
  const old={pnr:'OLD',total_cny:2041,itinerary:{changeHistory:[{amountsCny:{additionalPayment:12.34}}]},passengers:{}};
  assert.deepEqual(agencyResponse(old),old);
  const quote={appId:12,amountsCny:{additionalPayment:2041},retail:publicRetail(snapshot)};
  assert.equal(agencyResponse(quote).amountsCny.additionalPayment,2041.05);
});

test('agency output never contains rounding margin or original ticket cost in rounded booking',()=>{
  const verified={total:2041,breakdown:[{type:'adults',count:1,fare:2041,taxes:0}]};
  const snapshot=retailTicket(verified,540.8);
  const price=agencyPrice(verified,snapshot);
  assert.equal(price.total,2041.05);assert.equal(price.retail.amountMnt,1103800);
  const original={pnr:'TEST',total_cny:2041,retail_price:publicRetail(snapshot),itinerary:{verifiedPrice:verified,flights:[{price:2041,spring:{combPrice:2041},fare:{baseFare:2041,taxes:0}}]},passengers:{}};
  const output=agencyResponse(original);
  assert.equal(output.total_cny,2041.05);assert.equal(output.total_mnt,1103800);
  assert.equal(output.itinerary.verifiedPrice,undefined);assert.equal(output.itinerary.flights[0].spring.combPrice,undefined);
  assert.equal(original.total_cny,2041,'Serialization must not mutate backend cost');
  for(const field of ['supplierCny','marginCny','adjustmentMnt','conversionResidualMnt']) assert.equal(JSON.stringify(output).includes(field),false);
});

test('refund confirmation is bound to actor and PNR, expires and cannot replay',()=>{
  const store=createRefundQuotes();const quote={amountsCny:{refund:10}};
  const id=store.save('a','PNR',quote,1000);
  assert.throws(()=>store.take(id,'other','PNR',1001));
  assert.throws(()=>store.take(id,'a','other',1001));
  assert.deepEqual(store.take(id,'a','PNR',1001),quote);
  assert.throws(()=>store.take(id,'a','PNR',1002));
  const expired=store.save('a','PNR',quote,1000);
  assert.throws(()=>store.take(expired,'a','PNR',601000));
});
