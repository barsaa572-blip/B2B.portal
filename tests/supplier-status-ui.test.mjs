import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import status from '../ticket-status.js';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('const supplierStatusView ='), source.indexOf('const openBookingDetail ='));
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.open = false; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.tag === selector || child.className === selector.slice(1)) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  set innerHTML(_value) { assert.fail('Supplier text must use textContent, never HTML'); }
}
function fixture() {
  const context = { SpringTicketStatus: status, document: { createElement: tag => new Element(tag) },
    secureFetch: () => assert.fail('Status presentation must not request providers'), fetch: () => assert.fail('No provider call') };
  vm.createContext(context); vm.runInContext(code + ';globalThis.view=supplierStatusView;globalThis.render=renderSupplierStatus', context);
  return context;
}
const booking = () => ({ status: 'Ticketed', passengers: ['TEST ONE', 'TEST TWO'],
  documents: [{ documentNumber: 'FIXTURE1' }, { documentNumber: 'FIXTURE2' }],
  itinerary: { flights: [{ number: '9C1', travelDate: '2027-03-22', departure: { id: 'AAA' }, arrival: { id: 'BBB' } }], departureDate: '2027-03-22' } });
function record(booking, passengerIndex, flag) {
  return { flightKey: status.flightKey(booking.itinerary.flights[0]), passengerKey: booking.documents[passengerIndex].documentNumber, flag };
}
const text = element => [element.textContent, ...element.children.map(text)].join(' ');

test('unverified supplier state is concise, collapsed and never confused with local ticket issuance', () => {
  const context = fixture(), panel = new Element('section'), b = booking();
  const before = structuredClone(b);
  context.render(panel, b);
  assert.equal(panel.querySelector('details').open, false);
  assert.equal(panel.querySelector('summary').children[0].textContent, 'Ticket status');
  assert.equal(panel.querySelector('summary').children[1].textContent, 'Not verified');
  assert.doesNotMatch(text(panel), /Awaiting automatic|Spring status pending|Last verified|Ticketed/);
  assert.equal(context.view(b).checked, null);
  assert.deepEqual(b, before);
});

test('confirmed and partially confirmed passengers stay independent, with checked time only as tooltip', () => {
  const context = fixture(), panel = new Element('section'), b = booking();
  b.supplierStatus = { lastSuccessfulAt: '2026-10-09T01:00:00Z', records: [record(b, 0, 40)] };
  context.render(panel, b);
  assert.equal(context.view(b).label, 'Partially verified');
  assert.deepEqual(Array.from(context.view(b).rows, row => row.label), ['Flown', 'Not verified']);
  assert.match(panel.querySelector('summary').title, /^Last verified:/);
  b.supplierStatus.records.push(record(b, 1, 41));
  context.render(panel, b);
  assert.equal(context.view(b).label, 'Verified');
  assert.deepEqual(Array.from(context.view(b).rows, row => row.label), ['Flown', 'Checked-in']);
});

test('error/unmatched retains old confirmed data without suggesting a fresh successful check', () => {
  const context = fixture(), b = booking();
  b.supplierStatus = { result: 'error', records: [record(b, 0, 3), record(b, 1, 3)] };
  assert.equal(context.view(b).label, 'Check unavailable');
  assert.equal(context.view(b).note, 'Previous status retained.');
  b.supplierStatus.result = 'unmatched';
  assert.equal(context.view(b).label, 'Partially verified');
  b.supplierStatus = { lastSuccessfulAt: 'not-a-date', records: [record(b, 0, 999)] };
  assert.equal(context.view(b).label, 'Not verified');
  assert.equal(context.view(b).checked, null);
  b.supplierStatus.result = 'unmatched';
  assert.equal(context.view(b).label, 'Not verified', 'Zero matches must not imply any passenger is verified');
});

test('background renderer preserves disclosure open state and uses literal text for all supplier/passenger fields', () => {
  const context = fixture(), b = booking(), panel = new Element('section');
  b.passengers[0] = '<img src=x onerror=alert(1)>';
  context.render(panel, b); panel.querySelector('details').open = true;
  b.supplierStatus = { records: [record(b, 0, 3)] };
  context.render(panel, b);
  assert.equal(panel.querySelector('details').open, true);
  assert.equal(panel.querySelector('.supplier-status-name').textContent, b.passengers[0]);
  assert.match(text(panel), /Ticketed/);
});

test('initial open and existing polling share the compact renderer; removed sentence cannot return on refresh', () => {
  assert.match(source, /renderSupplierStatus\(statusPanel, booking\)/);
  assert.match(source, /renderSupplierStatus\(panel, current\)/);
  assert.doesNotMatch(source, /Awaiting automatic Spring verification|Spring status pending|Passenger flight status/);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /supplier-status-panel\{padding:12px 14px;font-size:13px\}/);
  assert.match(css, /supplier-status-name\{overflow-wrap:anywhere\}/);
  assert.match(css, /max-width:480px.*supplier-status-row/);
});
