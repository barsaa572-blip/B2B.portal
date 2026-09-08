const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../backend/supabase-client.mjs'), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end)).replaceAll('export ', '');
test('platform statistics separate ticket sales, change payments, and funding', async () => {
  const ctx = {secretRequest:async url => url.includes('/wallet_transactions?') ? [
    {amount_cny:-200,reason:'Ticket issue: TEST'},
    {amount_cny:-30,reason:'Change fee payment: TEST | Spring application 1'},
    {amount_cny:500,reason:'Top-up approved: INV1'},
    {amount_cny:100,reason:'Opening balance'},
    {amount_cny:70,reason:'Manual correction'}
  ] : []};
  vm.createContext(ctx);
  vm.runInContext(extract('export async function getAdminOverview','export async function createAgency'),ctx);
  const {statistics} = await ctx.getAdminOverview();
  assert.equal(statistics.ticketSalesCny,200);
  assert.equal(statistics.topupsCny,600);
  assert.equal(statistics.changePaymentsCny,30);
});
test('change keeps supplier quote, preserves previous history, and deduplicates application', async () => {
  let row = {id:'b',pnr:'TEST',status:'Ticketed',created_by:'u',agency_id:'a',itinerary:{flights:[{number:'9C1',travelDate:'2026-09-08'}],changeQuotes:{'12':{amountsCny:{changeFee:300,fareDifference:40,additionalPayment:340},amountsMnt:{additionalPayment:180200}}}}};
  let writes = 0;
  const ctx = { secretRequest: async (url, options) => {if(options){ writes++;row={...row,...options.body};}return [row];} };
  vm.createContext(ctx);
  vm.runInContext(extract('export async function recordPortalBookingChange', 'export async function saveBookingFinancialData'), ctx);
  const args = {appId:12,changes:[{key:'outbound',newFlight:{flightNo:'9C2',travelDate:'2026-09-10'}}]};
  await ctx.recordPortalBookingChange({id:'u',role:'agent'},'TEST',args);
  assert.equal(row.itinerary.changeHistory[0].payment.amountsCny.changeFee,300);
  assert.equal(row.itinerary.changeHistory[0].payment.amountsMnt.additionalPayment,180200);
  await ctx.recordPortalBookingChange({id:'u',role:'agent'},'TEST',args);
  assert.equal(writes,1);
});
test('refund stores quote as pending settlement and preserves itinerary', async () => {
  let saved;
  const ctx = {listPortalBookings:async()=>[{id:'b',pnr:'TEST',itinerary:{changeHistory:[{appId:12}]}}],secretRequest:async(url,options)=>{saved=options.body;return [saved];}};
  vm.createContext(ctx);
  vm.runInContext(extract('export async function saveBookingFinancialData','export async function recordPortalBookingNoShow'),ctx);
  await ctx.saveBookingFinancialData({},'TEST','refund',{quote:{amountsMnt:{refund:120000}}});
  assert.equal(saved.status,'Cancelled');
  assert.equal(saved.itinerary.refundHistory[0].settlementStatus,'pending');
  assert.equal(saved.itinerary.refundHistory[0].quote.amountsMnt.refund,120000);
  assert.equal(saved.itinerary.changeHistory.length,1);
  await assert.rejects(ctx.saveBookingFinancialData({},'OTHER','refund',{}),/access denied/);
});
