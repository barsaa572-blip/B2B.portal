import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const canonicalFareData ='), source.indexOf('// Body-level tooltip'));
const makeContext = extras => {
  const context = vm.createContext({ activePassengerCounts: { adults: 1, children: 1, infants: 1 }, portalSession: () => ({ profile: { id: 'agent' } }), escapeHtml: String, quoteMnt: value => `MNT:${value}`, ...extras });
  vm.runInContext(helpers + '\nglobalThis.api = { cheapestDistinctChoices, fareConditionKey, priceFareChoices, resetFarePricing, passengerPriceMarkup };', context);
  return context;
};
const fare = (id, patch = {}) => ({ id, baseFare: 100, baggage: { cabinKg: 7, checkedKg: 20 }, rules: [1, 2].map(type => ({ type, entries: [{ value: 100, valueType: 1, start: '-24H', end: '0H' }, { value: 200, valueType: 1, start: '0H', end: null }] })), spring: { segHeadId: 10, combId: 1, combType: 1, combPrice: 100, adultCabin: id, cabinType: 3, moneyClassId: 0 }, ...patch });
const choice = (id, total, patch) => ({ fares: [fare(id, patch)], flights: [{ spring: {} }], price: total == null ? null : { total } });

test('same full conditions keep cheapest verified passenger total, sorted ascending', () => {
  const { api } = makeContext();
  const choices = [choice('R1', 715200), choice('R2', 600000), choice('E', 590000, { baggage: { cabinKg: 7, checkedKg: 0 } })];
  const grouped = api.cheapestDistinctChoices(choices);
  assert.deepEqual(Array.from(grouped, c => c.price.total), [590000, 600000]);
  assert.equal(grouped[1].fares[0].id, 'R2');
  // Order the overall passenger price, not the adult-only base fare.
  choices[0].fares[0].baseFare = 1; choices[1].fares[0].baseFare = 999;
  assert.equal(api.cheapestDistinctChoices(choices)[1].fares[0].id, 'R2');
});

test('different no-show windows, calculation rules, dimensions and benefits stay separate', () => {
  const { api } = makeContext();
  for (const change of [
    f => { f.rules[0].entries[1].value = 300; },
    f => { f.rules[0].entries[0].start = '-48H'; },
    f => { f.rules[1].entries[0].calculationSource = 2; },
    f => { f.baggage.cabinSize = '40x30x20'; },
    f => { f.benefits = ['meal']; },
    f => { f.productGrade = 'Business-package'; },
    f => { f.conditionData = { note: 'non-refundable after departure' }; }
  ]) {
    const a = choice('R1', 100), b = choice('R2', 200); change(b.fares[0]);
    assert.equal(api.cheapestDistinctChoices([a, b]).length, 2);
  }
});

test('unknown/missing conditions and unverified fares are not merged or guessed', () => {
  const { api } = makeContext();
  assert.equal(api.cheapestDistinctChoices([choice('R1', 100, { rules: [] }), choice('R2', 200, { rules: [] })]).length, 2);
  const choices = [choice('R1', null), choice('R2', 50)];
  assert.equal(api.cheapestDistinctChoices(choices)[0].price.total, 50);
  assert.match(api.passengerPriceMarkup(null), /unavailable/);
  const a = choice('R1', 100), b = choice('R2', 200);
  a.fares[0].rules[0].entries[0].valueType = b.fares[0].rules[0].entries[0].valueType = 2;
  b.fares[0].baseFare = 200;
  assert.equal(api.cheapestDistinctChoices([a, b]).length, 2);
});

test('round trip compares each direction independently, not only fee sum', () => {
  const { api } = makeContext();
  const a = { ...choice('R1', 200), fares: [fare('R1'), fare('R1')] };
  const b = { ...choice('R2', 300), fares: [fare('R2'), fare('R2')] };
  assert.equal(api.cheapestDistinctChoices([b, a]).length, 1);
  b.fares[1].baggage.checkedKg = 30;
  assert.equal(api.cheapestDistinctChoices([a, b]).length, 2);
});

test('batch totals include adult, child and infant, cache is reset by each new search', async () => {
  let calls = 0;
  const price = { currency: 'CNY', total: 1736877, breakdown: [{ type: 'adults', count: 1, total: 930239, fare: 601888, taxes: 328351 }, { type: 'children', count: 1, total: 779768, fare: 451417, taxes: 328351 }, { type: 'infants', count: 1, total: 26870, fare: 26870, taxes: 0 }] };
  const { api } = makeContext({ secureFetch: async (_url, options) => {
    calls++; const request = JSON.parse(options.body);
    assert.deepEqual(request.passengers, { adults: 1, children: 1, infants: 1 });
    assert.equal(request.selections[0][0].spring.adultCabin, 'R1');
    return { ok: true, json: async () => ({ results: request.selections.map(() => ({ price })) }) };
  } });
  const choices = [choice('R1', null)];
  const priced = await api.priceFareChoices(choices);
  const markup = api.passengerPriceMarkup(priced[0].price);
  for (const text of ['MNT:1736877', 'Adult × 1', 'Child × 1', 'Infant × 1', 'role="tooltip"', 'tabindex="0"']) assert.ok(markup.includes(text), text);
  await api.priceFareChoices(choices); assert.equal(calls, 1);
  api.resetFarePricing(); await api.priceFareChoices(choices); assert.equal(calls, 2);
});

test('old async responses cannot populate the next search cache', async () => {
  let resolve;
  const { api } = makeContext({ secureFetch: () => new Promise(done => { resolve = done; }) });
  const pending = api.priceFareChoices([choice('R1', null)]);
  await Promise.resolve(); api.resetFarePricing();
  resolve({ ok: true, json: async () => ({ results: [{ price: { currency: 'CNY', total: 1, breakdown: [] } }] }) });
  assert.equal((await pending).length, 0);
});
