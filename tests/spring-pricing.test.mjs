import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { priceSelection, priceRequest, verifiedPrice, createPriceQuotes, flightList } from '../backend/spring-pricing.mjs';

const flight = { spring: { segHeadId: 123, combId: 1, combType: 1, combPrice: 100, adultCabin: 'S', cabinType: 3, moneyClassId: 0 } };
const counts = { adults: 2, children: 1, infants: 1 };
const row = (fare, fuel = 10, port = 5) => ({ cabinPrice: fare, fuelFee: fuel, portPay: port, otherFeeSum: 0 });
const response = () => ({ ifSuccess: 'Y', adultTravPriceForSeg: [row(100)], childTravPriceForSeg: [row(60, 5, 0)], infantTravPriceForSeg: [row(10, 0, 0)] });

test('pricing request uses cabinType, not combination type; counts multiply verified per-person fares', () => {
  const selection = priceSelection([flight], counts);
  assert.deepEqual(priceRequest(selection), { lang: 'zh_cn', moneyClassId: 0, segType: 'N', segHeadIds: [123], cabinNames: ['S'], cabinTypes: [3] });
  const price = verifiedPrice(response(), selection);
  assert.equal(price.total, 305);
  assert.equal(price.fare, 270);
  assert.equal(price.taxes, 35);
  assert.deepEqual(price.breakdown.map(r => [r.type, r.count, r.total]), [['adults', 2, 230], ['children', 1, 65], ['infants', 1, 10]]);
});

test('round-trip sums each segment once, including true zero-price infants', () => {
  const selection = priceSelection([flight, { spring: { ...flight.spring, segHeadId: 124 } }], counts);
  const data = response();
  data.adultTravPriceForSeg.push(row('100.01'));
  data.childTravPriceForSeg.push(row(50));
  data.infantTravPriceForSeg = [row(0, 0, 0), row(0, 0, 0)];
  assert.equal(priceRequest(selection).segType, 'Y');
  assert.equal(verifiedPrice(data, selection).total, 590.02);
});

test('missing/invalid amounts and incomplete passenger lists never become zero prices', () => {
  const selection = priceSelection([flight], counts);
  for (const value of [null, undefined, '', true, -1, 'bad', Infinity]) {
    const data = response(); data.childTravPriceForSeg[0].cabinPrice = value;
    assert.throws(() => verifiedPrice(data, selection), /invalid or missing/);
  }
  const data = response(); delete data.infantTravPriceForSeg;
  assert.throws(() => verifiedPrice(data, selection), /infants/);
  assert.throws(() => verifiedPrice({ ifSuccess: 'Y', content: response() }, selection), /adults/);
  assert.throws(() => verifiedPrice({ ...response(), ifSuccess: 'N' }, selection), /did not confirm/);
  assert.throws(() => verifiedPrice(response(), priceSelection([flight, flight], counts)), /complete/);
});

test('invalid counts, non-CNY fares and missing cabin metadata are rejected', () => {
  for (const bad of [{ ...counts, adults: 0 }, { ...counts, children: -1 }, { ...counts, infants: 3 }, { ...counts, children: 1.5 }, { ...counts, adults: 10 }]) assert.throws(() => priceSelection([flight], bad));
  for (const patch of [{ moneyClassId: 1 }, { cabinType: null }, { segHeadId: '9007199254740993' }, { combPrice: null }]) assert.throws(() => priceSelection([{ spring: { ...flight.spring, ...patch } }], counts));
});

test('quotes bind actor, combination and passenger counts, expire and are one-use', () => {
  let now = 100;
  const store = createPriceQuotes({ now: () => now, ttl: 100, limit: 2 });
  const selection = priceSelection([flight], counts);
  const price = verifiedPrice(response(), selection);
  const quote = store.save('agent', selection, price);
  assert.equal(store.require(quote.quoteId, 'agent', selection).total, 305);
  quote.total = 1;
  assert.equal(store.require(quote.quoteId, 'agent', selection).total, 305);
  assert.throws(() => store.require(quote.quoteId, 'other', selection));
  assert.throws(() => store.require(quote.quoteId, 'agent', priceSelection([flight], { ...counts, children: 0 })));
  assert.throws(() => store.require(quote.quoteId, 'agent', priceSelection([{ spring: { ...flight.spring, combPrice: 1 } }], counts)));
  now = 200; assert.throws(() => store.require(quote.quoteId, 'agent', selection));
  const next = store.save('agent', selection, price);
  store.consume(next.quoteId); assert.throws(() => store.require(next.quoteId, 'agent', selection));
});

test('supplier empty availability differs from malformed or failed availability', () => {
  assert.deepEqual(flightList({ ifSuccess: 'Y', flightsList: [] }), []);
  for (const data of [{}, { ifSuccess: 'N', flightsList: [] }, { ifSuccess: 'Y', flightsList: null }]) assert.throws(() => flightList(data), /unrecognised/);
});

test('actual booking handler rejects unverified/changed fares and uses server totals before supplier mutation', async () => {
  const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function createLiveSpringBooking'), source.indexOf('// Payment is deliberately performed'));
  const selection = priceSelection([flight], counts);
  const store = createPriceQuotes();
  let calls = 0;
  let data = response();
  const context = {
    process: { env: { SPRING_BOOKING_ENABLED: 'true' } }, console,
    cleanBookingItinerary: value => value,
    getSpringStatus: () => ({ httpJsonReady: true }),
    createSpringBookingPayload: () => ({ adultNum: 2, childNum: 1, infantNum: 1 }),
    priceSelection, priceRequest, verifiedPrice, priceQuotes: store,
    createSpringClient: () => ({ getAccessToken: async () => ({ accessToken: 'fake' }), getSpecificPrice: async () => data,
      bookOrder: async () => { calls++; return { pnr: 'LOCAL-TEST' }; } }),
    springOrderReference: value => value.pnr,
    createPortalBooking: async (_profile, body) => body
  };
  vm.createContext(context); vm.runInContext(code, context);
  const body = { itinerary: { flights: [flight] }, totalCny: 0.01 };
  await assert.rejects(context.createLiveSpringBooking({ id: 'agent' }, body), /quote/);
  const quote = store.save('agent', selection, verifiedPrice(data, selection));
  body.quoteId = quote.quoteId;
  data = response(); data.childTravPriceForSeg[0].cabinPrice = 70;
  await assert.rejects(context.createLiveSpringBooking({ id: 'agent' }, body), /price changed/);
  assert.equal(calls, 0);
  data = response();
  const result = await context.createLiveSpringBooking({ id: 'agent' }, body);
  assert.equal(result.totalCny, 305);
  assert.equal(result.itinerary.verifiedPrice.breakdown.length, 3);
  assert.equal(calls, 1);
  await assert.rejects(context.createLiveSpringBooking({ id: 'agent' }, body), /quote/);
  assert.equal(calls, 1);
  body.quoteId = store.save('agent', selection, verifiedPrice(data, selection)).quoteId;
  const parallel = await Promise.allSettled([context.createLiveSpringBooking({ id: 'agent' }, body), context.createLiveSpringBooking({ id: 'agent' }, body)]);
  assert.equal(parallel.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(calls, 2);
});

test('checkout verification disables booking; stale responses cannot replace the selected fare', async () => {
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('const checkoutPricePanel ='), source.indexOf('const verifyFarePreview ='));
  const requests = [];
  const panel = { outerHTML: '' };
  const button = { disabled: false };
  const form = {};
  const context = {
    selectedOutbound: structuredClone(flight), selectedReturn: null, activePassengerCounts: counts,
    portalSession: () => ({ profile: { id: 'agent' } }),
    quoteMnt: value => `MNT(${value})`, escapeHtml: value => String(value), baggageSummary: () => '',
    document: { addEventListener() {}, querySelector: selector => ({ '.booking-price-panel': panel, '.issue-ticket': button, '#passenger-form': form })[selector] || null },
    secureFetch: () => new Promise(resolve => requests.push(resolve))
  };
  vm.createContext(context); vm.runInContext(code, context);
  const first = vm.runInContext('verifyBookingPrice()', context);
  assert.equal(button.disabled, true);
  context.selectedOutbound.spring.combId = 2;
  const second = vm.runInContext('verifyBookingPrice()', context);
  const price = { ...verifiedPrice(response(), priceSelection([flight], counts)), quoteId: 'second', expiresAt: Date.now() + 60000 };
  requests[1]({ ok: true, json: async () => price }); await second;
  assert.equal(button.disabled, false);
  assert.match(panel.outerHTML, /Child × 1/); assert.match(panel.outerHTML, /Infant × 1/); assert.match(panel.outerHTML, /MNT\(305\)/);
  requests[0]({ ok: true, json: async () => ({ ...price, quoteId: 'stale', total: 1 }) }); await first;
  assert.equal(vm.runInContext('currentBookingQuote().quoteId', context), 'second');
  const failed = vm.runInContext('verifyBookingPrice()', context);
  requests[2]({ ok: false, json: async () => ({ error: 'Missing child price' }) }); await failed;
  assert.equal(button.disabled, true); assert.match(panel.outerHTML, /Missing child price/);
});
