import './support/html-vm.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseOrderTicketStatuses } from '../backend/spring-soap-client.mjs';
import { mapTicketStatuses, createStatusSyncWorker } from '../backend/spring-status-sync.mjs';
import status from '../ticket-status.js';

const booking = () => ({ id: '1', pnr: 'TEST', status: 'Ticketed', passengers: { travellers: [{ documentNumber: 'P1' }, { documentNumber: 'P2' }] }, itinerary: {
  changeHistory: [{ appId: 9 }],
  flights: [
    { number: '9C7058', travelDate: '2026-09-01', departure: { id: 'UBN' }, arrival: { id: 'PVG' } },
    { number: '9C7057', travelDate: '2026-10-01', departure: { id: 'PVG' }, arrival: { id: 'UBN' } }
  ]
} });
const head = (person, leg, flag) => ({ orderHeadId: leg * 10 + person, passengerDocument: `P${person}`, tktFlag: flag,
  flightNo: leg === 0 ? '9C7058' : '9C7057', departureCode: leg === 0 ? 'UBN' : 'PVG', arrivalCode: leg === 0 ? 'PVG' : 'UBN', departureTime: leg === 0 ? '2026-09-01 13:00:00' : '2026-10-01 08:10:00' });

test('SOAP tktFlag and identity are parsed within each ticket, missing is not zero', () => {
  const rows = parseOrderTicketStatuses(`<return><ticketList><orderHeadId>10</orderHeadId><tktFlag>40</tktFlag><passengerInfo><cardNo>P1</cardNo></passengerInfo><flightBasicInfo><flightNo>9C7058</flightNo><oriEndPoint><airportCityInfo><airportCode>UBN</airportCode></airportCityInfo><oriTimeInfo><timeBJ>2026-09-01 13:00:00</timeBJ></oriTimeInfo></oriEndPoint><destEndPoint><airportCityInfo><airportCode>PVG</airportCode></airportCityInfo></destEndPoint></flightBasicInfo></ticketList><ticketList><orderHeadId>11</orderHeadId><cardNo>P2</cardNo></ticketList></return>`);
  assert.equal(rows[0].tktFlag, 40);
  assert.equal(rows[0].passengerDocument, 'P1');
  assert.equal(rows[0].departureCode, 'UBN');
  assert.equal(rows[1].tktFlag, null);
  assert.equal(rows[1].passengerDocument, 'P2');
});

test('reordered passengers and segments are independent; check-in is not flown', () => {
  const b = booking(); const original = structuredClone(b);
  b.supplier_status = mapTicketStatuses(b, [head(2, 1, 5), head(1, 0, 40), head(1, 1, 5), head(2, 0, 41)]);
  assert.deepEqual(status.flightStatuses(b, 0).map(row => row.label), ['Flown', 'Checked-in']);
  assert.equal(status.summary(b, 1).label, 'Ticketed');
  assert.equal(status.summary(b, 0).state, 'ticketed');
  assert.deepEqual(b.itinerary, original.itinerary);
  assert.equal(b.status, 'Ticketed');
});

test('all passengers flown outbound does not mark return flown', () => {
  const b = booking();
  b.supplier_status = mapTicketStatuses(b, [head(1, 0, 40), head(2, 0, 40), head(1, 1, 5), head(2, 1, 5)]);
  assert.equal(status.summary(b, 0).state, 'flown');
  assert.equal(status.summary(b, 1).label, 'Ticketed');
});

test('unknown, absent, duplicate identity and old flights cannot set a status', () => {
  for (const heads of [[{ ...head(1, 0, 40), passengerDocument: null }], [head(1, 0, 999)], [head(1, 0, 40), head(1, 0, 41)], [{ ...head(1, 0, 40), departureTime: '2026-08-01' }]]) {
    assert.deepEqual(mapTicketStatuses(booking(), heads).records, []);
  }
  const duplicate = booking(); duplicate.passengers.travellers[1].documentNumber = 'P1';
  assert.deepEqual(mapTicketStatuses(duplicate, [head(1, 0, 40)]).records, []);
});

test('partial response preserves verified records; changed flight ignores old usage', () => {
  const b = booking();
  b.supplier_status = mapTicketStatuses(b, [head(1, 0, 40)]);
  const prior = b.supplier_status.records[0];
  b.supplier_status = mapTicketStatuses(b, []);
  assert.deepEqual(b.supplier_status.records[0], prior);
  b.itinerary.flights[0].travelDate = '2026-09-20';
  assert.equal(status.summary(b, 0), null);
  assert.deepEqual(mapTicketStatuses(b, [head(1, 0, 40)]).records, []);
});

test('elapsed departure never creates no-show; only confirmed status codes apply', () => {
  const b = booking(); b.supplier_status = mapTicketStatuses(b, [head(1, 0, 5)], '2030-01-01T00:00:00Z');
  assert.equal(status.flightStatuses(b, 0)[0].label, 'Ticketed');
  assert.doesNotMatch(JSON.stringify(b.supplier_status), /no.show/i);
});

test('worker is sequential, non-overlapping, and retains statuses on supplier error', async () => {
  const calls = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tick = createStatusSyncWorker({
    claim: async () => { calls.push('claim'); return [booking(), { ...booking(), pnr: 'FAIL' }]; },
    readOrder: async pnr => { calls.push(pnr); await gate; if (pnr === 'FAIL') throw Error('PRIVATE'); return { orderHeads: [head(1, 0, 40)] }; },
    finish: async (row, value) => { calls.push(value?.result || 'retained'); }, log: value => calls.push(value)
  });
  const first = tick(); await new Promise(resolve => setImmediate(resolve));
  await tick(); assert.equal(calls.filter(v => v === 'claim').length, 1);
  release(); await first;
  assert.ok(calls.includes('retained')); assert.ok(!calls.join(' ').includes('PRIVATE'));
  await createStatusSyncWorker({ enabled: () => false, claim: () => assert.fail(), log: () => {} })();
});

test('migration leases work and guards changed bookings; only service role executes', () => {
  const sql = readFileSync(new URL('../supabase/spring-status-sync.sql', import.meta.url), 'utf8');
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /supplier_status_lease_id is distinct from p_lease_id/);
  assert.match(sql, /current_revision is distinct from p_revision/);
  assert.match(sql, /interval '15 minutes'/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.doesNotMatch(sql, /set\s+(itinerary|status|total_cny)\s*=/i);
});

test('cached status cannot apply to ambiguous documents or duplicate flights', () => {
  const b = booking(); b.supplier_status = mapTicketStatuses(b, [head(1, 0, 40)]);
  b.passengers.travellers[1].documentNumber = 'P1';
  assert.equal(status.summary(b, 0), null);
  assert.equal(mapTicketStatuses(b, []).records.length, 0);
  const c = booking(); c.supplier_status = mapTicketStatuses(c, [head(1, 0, 40)]);
  c.itinerary.flights.push(c.itinerary.flights[0]);
  assert.equal(status.summary(c, 0), null);
});

test('booking cards show per-leg SOAP state while preserving change history', () => {
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const context = vm.createContext({ SpringTicketStatus: status, displayFlightDate: value => value,
    reviewAirportName: value => value?.id || '', formatMinutes: () => '4h', airlineLogo: () => '' });
  vm.runInContext(source.slice(source.indexOf('const bookingFlightDetailsClean ='), source.indexOf('const bookingFareBreakdown =')) + '\nglobalThis.render = bookingFlightDetailsClean;', context);
  const b = booking(); b.supplier_status = mapTicketStatuses(b, [head(1, 0, 40), head(2, 0, 40), head(1, 1, 5), head(2, 1, 5)]);
  b.itinerary.changeHistory = [{ appId: 9, legs: [{ key: 'outbound', oldFlight: { ...b.itinerary.flights[0], travelDate: '2026-08-30' } }] }];
  const html = context.render(b);
  assert.match(html, /REPLACED FLIGHT/);
  assert.match(html, /segment-status flown\">Flown/);
  assert.match(html, /segment-status ticketed\">Ticketed/);
  assert.doesNotMatch(html, /Active after change/);
});
