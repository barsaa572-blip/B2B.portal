import ticketStatus from '../ticket-status.js';

// Require both a unique document and an exact current flight/date match.
// Never associate passengers/segments by array position or by name alone.
export function mapTicketStatuses(booking, orderHeads, checkedAt = new Date().toISOString()) {
  const itinerary = booking.itinerary || {};
  const passengers = booking.passengers?.travellers || [];
  const flights = itinerary.flights || [];
  const expected = [];
  flights.forEach((flight, index) => {
    const flightKey = ticketStatus.flightKey(flight, index ? itinerary.returnDate : itinerary.departureDate);
    passengers.forEach(person => {
      const passengerKey = ticketStatus.passengerKey(person);
      if (flightKey && passengerKey) expected.push({ flightKey, passengerKey });
    });
  });
  const candidates = (orderHeads || []).map(head => ({
    flightKey: ticketStatus.flightKey({ number: head.flightNo, travelDate: head.departureTime, departure: { id: head.departureCode }, arrival: { id: head.arrivalCode } }),
    passengerKey: ticketStatus.passengerKey({ documentNumber: head.passengerDocument }),
    flag: head.tktFlag,
    orderHeadId: head.orderHeadId
  }));
  const records = [];
  for (const item of expected) {
    const same = other => other.flightKey === item.flightKey && other.passengerKey === item.passengerKey;
    const matches = candidates.filter(same);
    if (expected.filter(same).length !== 1 || matches.length !== 1) continue;
    const match = matches[0];
    if (!Number.isInteger(match.flag) || !Object.hasOwn(ticketStatus.labels, match.flag)) continue;
    records.push({ ...match, checkedAt });
  }
  // A partial/unknown response must not erase previously verified statuses.
  const old = (booking.supplier_status?.records || []).filter(record =>
    expected.filter(item => item.flightKey === record.flightKey && item.passengerKey === record.passengerKey).length === 1);
  const merged = old.filter(record => !records.some(item => item.flightKey === record.flightKey && item.passengerKey === record.passengerKey)).concat(records);
  const count = flights.length * passengers.length;
  return { records: merged, lastAttemptAt: checkedAt,
    lastSuccessfulAt: records.length ? checkedAt : booking.supplier_status?.lastSuccessfulAt || null,
    result: count > 0 && records.length === count ? 'ok' : 'unmatched',
    matched: records.length, expected: count };
}

export function createStatusSyncWorker({ claim, readOrder, finish, enabled = () => true, log = console.warn }) {
  let running = false;
  return async function tick() {
    if (running || !enabled()) return;
    running = true;
    try {
      // The database lease also prevents duplicate work across server processes.
      const rows = await claim();
      for (const row of rows) {
        try {
          const detail = await readOrder(row.pnr);
          const mapped = mapTicketStatuses(row, detail.orderHeads);
          await finish(row, mapped);
        } catch {
          // No raw supplier response, credential or passenger data in logs.
          await finish(row, null).catch(() => {});
          log('Spring status check failed; previous status retained.');
        }
      }
    } catch {
      log('Spring status worker unavailable; check configuration and database migration.');
    } finally { running = false; }
  };
}
