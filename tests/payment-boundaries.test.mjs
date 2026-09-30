import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { requireChangeQuote } from '../backend/payment-security.mjs';
import { retailAmount, publicRetail } from '../backend/retail-pricing.mjs';
const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('change quote uses supplier flight metadata and rejects foreign order heads', async () => {
  let supplierCalls = 0;
  const context = {
    roundingEnabled: () => false,
    ticketedSpringBooking: async () => ({}), resolveSpringOrderHeadIds: async () => [10],
    getLiveChangeOptions: async () => ({ orderHeadIds: ['10'], flights: [{ segmentHeadId: 20, flightNo: 'REAL9C', departure: { code: 'ULN' }, arrival: { code: 'PVG' } }] }),
    createSpringClient: () => ({ getAccessToken: async () => ({ accessToken: 'fake' }), getChangeAvailability: async () => { supplierCalls++; return { ifSuccess: 'Y', flightBgAppInfo: { flightBgAppDO: { id: 12, bgFy: 600 } } }; } }),
    springSucceeded: r => r.ifSuccess === 'Y', getCnyMntRate: async () => ({}), quoteCnyToMnt: v => v,
    process: { env: {} }
  };
  vm.createContext(context);
  vm.runInContext(extract('async function calculateLiveSpringChange', 'async function submitLiveSpringChange'), context);
  const changes = [{ key: 'outbound', newFlight: { segmentHeadId: 20, flightNo: 'FORGED', travelDate: '2026-09-20' } }];
  const quote = await context.calculateLiveSpringChange({}, 'PNR', [{ flightsOrderHeadId: 10, segHeadId: 20 }], changes);
  assert.equal(quote.changes[0].newFlight.flightNo, 'REAL9C');
  assert.equal(quote.amountsCny.additionalPayment, 600);
  assert.equal(quote.securityVersion, 1);
  await assert.rejects(context.calculateLiveSpringChange({}, 'PNR', [{ flightsOrderHeadId: 99, segHeadId: 20 }], changes), /Passenger order/);
  assert.equal(supplierCalls, 1);
});

test('change payment rejects amount tampering and ignores browser flight metadata', async () => {
  const quote = { appId: 12, quotedAt: new Date().toISOString(), securityVersion: 1, amountsCny: { additionalPayment: 600 }, pairs: [{ segHeadId: 20 }], changes: [{ key: 'outbound', newFlight: { segmentHeadId: 20, flightNo: 'REAL9C' } }] };
  const calls = []; const context = {
    roundingEnabled: () => false,
    springChangePaymentInFlight: new Set(), requireChangeQuote,
    ticketedSpringBooking: async () => ({ agency_id: 'agency', itinerary: { changeQuotes: { 12: quote } } }),
    getSpringSoapStatus: () => ({ creditPaymentReady: true }), assertWalletFunds: async () => {},
    recordChangePayment: async args => { calls.push(['wallet', args]); return { recorded: false }; },
    protectPayment: async (_p, _pnr, action, reference, amount, fn) => { calls.push(['guard', action, reference, amount]); return fn(); },
    submitLiveSpringChange: async () => ({ ifSuccess: 'Y' }),
    createSpringSoapClient: () => ({ payInCredit4OTA: async args => { calls.push(['supplier', args]); return { ifSuccess: 'Y' }; } }),
    recordPortalBookingChange: async (_p, _pnr, args) => { calls.push(['save', args]); return args; },
    console: { info() {}, error() {} }, process: { env: {} }
  };
  vm.createContext(context);
  vm.runInContext(extract('async function paySubmittedSpringChange', 'async function submitLiveSpringRefund'), context);
  for (const amountCny of [0, 300]) await assert.rejects(context.paySubmittedSpringChange({ id: 'agent' }, 'PNR', { appId: 12, amountCny }), /differs/);
  await assert.rejects(context.paySubmittedSpringChange({ id: 'agent' }, 'PNR', { appId: 99, amountCny: 600 }), /server-verified/);
  assert.equal(calls.length, 0);
  await context.paySubmittedSpringChange({ id: 'agent' }, 'PNR', { appId: 12, amountCny: 600, changes: [{ newFlight: { flightNo: 'FORGED' } }] });
  assert.equal(calls.find(c => c[0] === 'supplier')[1].orderMoney, 600);
  assert.equal(calls.find(c => c[0] === 'save')[1].changes[0].newFlight.flightNo, 'REAL9C');
  assert.ok(calls.findIndex(c => c[0] === 'guard') < calls.findIndex(c => c[0] === 'supplier'));
});

test('refund and ticket issue enter persistent guard before supplier mutation', () => {
  const issue = extract('async function issueSpringCreditTicket', 'const findRefundCalculation');
  assert.ok(issue.indexOf('protectPayment(') < issue.indexOf('.payInCredit4OTA('));
  const refund = extract('async function submitLiveSpringRefund', 'createServer({');
  assert.ok(refund.indexOf('protectPayment(') < refund.indexOf('.refundTicket('));
});

test('retail issue charges the reviewed wallet amount but pays only supplier cost', async () => {
  const snapshot = retailAmount(2041,540.8);
  const booking = { id:'booking',pnr:'PNR',agency_id:'agency',status:'Reserved',retail_price:publicRetail(snapshot) };
  const calls=[];
  const context={
    springIssueInFlight:new Set(),roundingEnabled:()=>true,expireTicketingDeadlineBookings:async()=>{},
    listPortalBookings:async()=>[booking],getSpringSoapStatus:()=>({creditPaymentReady:true}),
    createSpringSoapClient:()=>({getOrderDetailInfoC2:async()=>({orderMoneyCny:2041}),payInCredit4OTA:async args=>{calls.push(['supplier',args.orderMoney]);return {ifSuccess:'Y'};}}),
    getPrivateRetailPrice:async()=>({state:'prepared',snapshot}),
    setPortalBookingSpringAmount:async()=>booking,assertWalletFunds:async args=>calls.push(['wallet',args.amountCny]),
    protectPayment:async(_p,_pnr,_action,_ref,amount,execute,retail)=>{calls.push(['guard',amount,retail.walletCny]);return execute();},
    updatePortalBooking:async()=>({...booking,status:'Ticketed'}),process:{env:{}},console:{info(){},error(){}}
  };
  vm.createContext(context);vm.runInContext(extract('async function issueSpringCreditTicket','const findRefundCalculation'),context);
  await assert.rejects(context.issueSpringCreditTicket({id:'actor'},'PNR'),/Review/);
  await assert.rejects(context.issueSpringCreditTicket({id:'actor'},'PNR',{...publicRetail(snapshot),amountMnt:1}),/Review/);
  assert.equal(calls.length,0);
  await context.issueSpringCreditTicket({id:'actor'},'PNR',publicRetail(snapshot));
  assert.deepEqual(calls,[['wallet',2041.05],['guard',2041,2041.05],['supplier',2041]]);
  calls.length=0;
  context.protectPayment=async()=>{throw new Error('database guard unavailable');};
  await assert.rejects(context.issueSpringCreditTicket({id:'actor'},'PNR',publicRetail(snapshot)),/guard unavailable/);
  assert.equal(calls.some(c=>c[0]==='supplier'),false);
});
