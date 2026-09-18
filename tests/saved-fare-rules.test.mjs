import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const context = vm.createContext({ escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
vm.runInContext(source.slice(source.indexOf('const ruleBoundaryHours ='), source.indexOf('const fareDateForPhase =')), context);
vm.runInContext(source.slice(source.indexOf('const bookingSavedFareRules ='), source.indexOf('const openBookingDetail =')) + '\nglobalThis.render = bookingSavedFareRules;', context);

test('Reserved and Ticketed show stored per-leg rules without search state or network access', () => {
  for (const status of ['Reserved', 'Ticketed']) {
    const html = context.render({ status, itinerary: { flights: [{ travelDate: '2026-10-01', departure: { id: 'UBN' }, arrival: { id: 'PVG' }, fare: { fareType: 'S', rules: [{ type: 1, entries: [{ value: 0.2, valueType: 2, start: '0H', end: null }] }, { type: 2, entries: [{ value: 100, valueType: 1 }] }], baggage: { cabinKg: 7, checkedKg: 0 } } } ] } });
    for (const text of ['Fare rules & baggage', '20% of applicable fare', '100.00 CNY', 'After departure / no-show', 'Checked: 0 kg', '2026-10-01', 'UBN']) {
      assert.ok(html.includes(text), text);
    }
  }
});
test('missing conditions never imply free changes or included baggage; supplier strings escaped', () => {
  const html = context.render({ itinerary: { flights: [{ departure: { id: '<script>' }, fare: { rules: [{ type: 2, entries: [{ value: null, valueType: 1 }] }] } }] } });
  assert.match(html, /Confirm with Spring before issuing/);
  assert.match(html, /Checked: Not provided/);
  assert.doesNotMatch(html, /0\.00 CNY|<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(context.render({}), /Not provided for this saved fare/);
});
