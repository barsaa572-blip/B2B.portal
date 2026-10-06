import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { cleanPassengerCounts } from '../backend/input-validation.mjs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const counterCode = app.slice(app.indexOf('const validPassengerCounts ='), app.indexOf('const outboundDateInput ='));
const fields = ['adults', 'children', 'infants'];
function counters(values) {
  const nodes = Object.fromEntries(fields.flatMap(field => [[`#${field}`, { value: String(values[field]) }], [`#${field}-output`, { value: String(values[field]) }]]));
  const buttons = fields.flatMap(field => [-1, 1].map(step => ({
    dataset: { change: field, step: String(step) }, disabled: false, attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(_type, fn) { this.click = fn; }
  })));
  const context = { document: { querySelector: selector => nodes[selector], querySelectorAll: () => buttons },
    resultArea: { classList: { contains: () => true } }, passengerSearchStale: false, toast() {} };
  vm.runInNewContext(counterCode, context);
  return { nodes, context, button: (field, step) => buttons.find(button => button.dataset.change === field && Number(button.dataset.step) === step),
    values: () => Object.fromEntries(fields.map(field => [field, Number(nodes[`#${field}`].value)])) };
}

for (const counts of [{ adults: 6, children: 3, infants: 0 }, { adults: 9, children: 0, infants: 0 }, { adults: 1, children: 8, infants: 0 }]) {
  test(`counter seat boundary ${counts.adults} adults + ${counts.children} children disables both plus buttons`, () => {
    const ui = counters(counts);
    for (const field of ['adults', 'children']) {
      assert.equal(ui.button(field, 1).disabled, true);
      assert.equal(ui.button(field, 1).attrs['aria-disabled'], 'true');
      ui.button(field, 1).click();
    }
    assert.deepEqual(ui.values(), counts);
    assert.equal(ui.button('infants', 1).disabled, false);
    ui.button('infants', 1).click();
    assert.deepEqual(ui.values(), { ...counts, infants: 1 });
    assert.equal(ui.context.passengerSearchStale, true);
  });
}

test('removing a child frees a seat and increasing an adult consumes it', () => {
  const ui = counters({ adults: 6, children: 3, infants: 0 });
  ui.button('children', -1).click();
  assert.equal(ui.button('adults', 1).disabled, false);
  assert.equal(ui.button('children', 1).disabled, false);
  ui.button('adults', 1).click();
  assert.deepEqual(ui.values(), { adults: 7, children: 2, infants: 0 });
  assert.equal(ui.button('adults', 1).disabled, true);
  assert.equal(ui.button('children', 1).disabled, true);
});

test('9 adults can select 9 infants but not a tenth; adults cannot drop below infants', () => {
  const ui = counters({ adults: 9, children: 0, infants: 0 });
  for (let index = 0; index < 9; index++) {
    assert.equal(ui.button('infants', 1).disabled, false); ui.button('infants', 1).click();
  }
  assert.deepEqual(ui.values(), { adults: 9, children: 0, infants: 9 });
  assert.equal(ui.button('infants', 1).disabled, true);
  assert.equal(ui.button('adults', -1).disabled, true);
  ui.button('infants', 1).click(); ui.button('adults', -1).click();
  assert.deepEqual(ui.values(), { adults: 9, children: 0, infants: 9 });
  ui.button('infants', -1).click(); ui.button('adults', -1).click();
  assert.deepEqual(ui.values(), { adults: 8, children: 0, infants: 8 });
  assert.equal(ui.button('children', 1).disabled, false);
});

test('initial minus buttons cannot remove the mandatory adult or make negative counts', () => {
  const ui = counters({ adults: 1, children: 0, infants: 0 });
  for (const field of fields) { assert.equal(ui.button(field, -1).disabled, true); ui.button(field, -1).click(); }
  assert.deepEqual(ui.values(), { adults: 1, children: 0, infants: 0 });
});

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const searchCode = server.slice(server.indexOf('async function searchFlights('), server.indexOf('async function autocompleteLocations('));
test('invalid search counts return 400 before calling any supplier, including return searches', async () => {
  let supplierCalls = 0;
  const context = { cleanPassengerCounts, send: (_res, status, data) => ({ status, data }),
    getSpringStatus() { supplierCalls++; throw new Error('Supplier must not be accessed'); } };
  vm.createContext(context); vm.runInContext(searchCode, context);
  for (const party of [{ adults: '9', children: '8', infants: '0' }, { adults: '6', children: '4', infants: '0' }, { adults: '6', children: '3', infants: '7' }, { adults: '0', children: '0', infants: '0' }, { adults: '', children: '0', infants: '0' }, { adults: '1', children: '0', infants: '0.5' }]) {
    for (const departureToken of ['', 'mock-return']) {
      const response = await context.searchFlights(new URL('http://localhost/api/flights?' + new URLSearchParams({ ...party, departureToken })), {});
      assert.equal(response.status, 400);
    }
  }
  assert.equal(supplierCalls, 0);
});

test('valid 9 adults plus 9 infants are forwarded unchanged by search', async () => {
  const parties = [];
  const context = { cleanPassengerCounts, send: (_res, status, data) => ({ status, data }),
    getSpringStatus: () => ({ httpJsonReady: true }), validateFlightSearch() {},
    searchSpringFlights: async options => { parties.push(options.passengers); return { passengers: options.passengers }; } };
  vm.createContext(context); vm.runInContext(searchCode, context);
  for (const party of [{ adults: 9, children: 0, infants: 9 }, { adults: 6, children: 3, infants: 6 }]) {
    const response = await context.searchFlights(new URL('http://localhost/api/flights?' + new URLSearchParams(party)), {});
    assert.equal(response.status, 200); assert.deepEqual(response.data.passengers, party);
  }
  assert.equal(parties.length, 2);
});
