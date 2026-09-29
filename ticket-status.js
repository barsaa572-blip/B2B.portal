// Shared by the browser and the server. Never infer usage from elapsed time.
(function (root) {
  const text = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const date = value => String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
  const labels = { 2: 'Booked', 3: 'Ticketed', 5: 'Ticketed', 7: 'Refunded', 8: 'Expired', 9: 'Cancelled', 10: 'Cancelled', 11: 'Refund requested', 12: 'Refund accepted', 13: 'Changed', 20: 'Ticket lost', 30: 'Changed', 40: 'Flown', 41: 'Checked-in' };
  function flightKey(flight, fallbackDate = '') {
    const fields = [text(flight?.departure?.id), text(flight?.arrival?.id), text(flight?.number || flight?.flightNumber), date(flight?.travelDate || flight?.departure?.date || flight?.departure?.dateTime || fallbackDate)];
    return fields.every(Boolean) ? fields.join('|') : '';
  }
  function passengerKey(person) { return text(person?.documentNumber); }
  function flightStatuses(booking, index) {
    const itinerary = booking.itinerary || {};
    const key = flightKey(itinerary.flights?.[index], index ? itinerary.returnDate : itinerary.departureDate);
    const travellers = booking.documents || booking.passengers?.travellers || [];
    const records = booking.supplierStatus?.records || booking.supplier_status?.records || [];
    const uniqueFlight = key && (itinerary.flights || []).filter((flight, i) => flightKey(flight, i ? itinerary.returnDate : itinerary.departureDate) === key).length === 1;
    return travellers.map((person, passengerIndex) => {
      const identity = passengerKey(person);
      const uniquePassenger = identity && travellers.filter(item => passengerKey(item) === identity).length === 1;
      const matches = records.filter(record => uniqueFlight && uniquePassenger && record.flightKey === key && record.passengerKey === identity);
      const record = matches.length === 1 ? matches[0] : null;
      return { passengerIndex, flag: record?.flag ?? null, label: labels[record?.flag] || 'Unconfirmed' };
    });
  }
  function summary(booking, index) {
    const rows = flightStatuses(booking, index);
    if (!rows.some(row => row.flag !== null)) return null;
    const counts = new Map();
    rows.forEach(row => counts.set(row.label, (counts.get(row.label) || 0) + 1));
    return { label: counts.size === 1 ? rows[0].label : [...counts].map(([label, count]) => `${label} × ${count}`).join(' · '),
      state: rows.every(row => row.flag === 40) ? 'flown' : rows.every(row => row.flag === 41) ? 'checked-in' : 'ticketed' };
  }
  const api = { labels, flightKey, passengerKey, flightStatuses, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpringTicketStatus = api;
})(globalThis);
