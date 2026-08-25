let pricingRate = null;
const mnt = value => `₮ ${Math.round(Number(value || 0)).toLocaleString('en-US')}`;
const cnyAmount = value => Number(String(value ?? '').replace(/[^\d.]/g, ''));
const quoteMnt = value => pricingRate ? mnt(cnyAmount(value) * pricingRate.effectiveRateMnt) : 'Rate unavailable';

// Bookings and the wallet ledger are populated only from live backend data.
// Demo orders must never appear in an agency-facing portal.
const bookings = [];
const ledger = [];
const bookingRows = (rows, withAction = false) => rows.map(b => `<tr><td><strong>${b.ref}</strong></td><td>${b.route}</td><td>${b.passenger}</td><td>${b.issued}</td><td><strong>${quoteMnt(b.total)}</strong></td><td><span class="tag ${b.status.toLowerCase()}">${b.status}</span></td>${withAction ? `<td><button class="text-btn view-booking" data-booking-ref="${b.ref}">View</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${withAction ? 7 : 6}" class="no-bookings">No matching bookings found.</td></tr>`;
const ownBookings = () => bookings;
let bookingScope = 'agent';
const renderBookings = (query = '') => {
  const normalized = query.trim().toLowerCase();
  const displayed = normalized ? bookings.filter(booking => `${booking.ref} ${booking.passenger}`.toLowerCase().includes(normalized)) : (bookingScope === 'agent' ? ownBookings() : bookings);
  document.querySelector('#recent-bookings').innerHTML = bookingRows(bookingScope === 'agent' ? ownBookings() : bookings);
  document.querySelector('#all-bookings').innerHTML = bookingRows(displayed, true);
};
window.applyBookingScope = role => {
  bookingScope = role === 'office' ? 'office' : 'agent';
  const input = document.querySelector('#bookings .filters input');
  if (input) {
    input.value = '';
    input.placeholder = bookingScope === 'agent' ? 'Search your office by PNR or passenger' : 'Search PNR, passenger or ticket number';
  }
  const description = document.querySelector('#bookings .section-heading > div > p:not(.eyebrow)');
  if (description) description.textContent = bookingScope === 'agent' ? 'Your bookings. Search your office by PNR or passenger.' : 'All bookings created by your agency.';
  renderBookings();
};
renderBookings();
document.querySelector('#bookings .filters input').addEventListener('input', event => renderBookings(event.target.value));
const bookingDetailModal = () => {
  let modal = document.querySelector('#booking-detail-modal');
  if (modal) return modal;
  modal = document.createElement('dialog');
  modal.id = 'booking-detail-modal';
  document.body.append(modal);
  return modal;
};
let bookingDeadlineTimer = null;
const formatCountdown = milliseconds => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const bookingTicketingDeadline = booking => {
  if (booking.status !== 'Reserved' || !booking.createdAt) return '';
  const deadline = new Date(booking.createdAt).getTime() + 30 * 60 * 1000;
  if (!Number.isFinite(deadline)) return '';
  const expired = Date.now() >= deadline;
  return `<section class="ticketing-deadline ${expired ? 'expired' : ''}" data-ticketing-deadline="${deadline}"><div><span>Ticketing deadline</span><strong>${expired ? 'Expired' : formatCountdown(deadline - Date.now())}</strong></div><small>${expired ? 'The 30-minute ticketing window has ended. Confirm the PNR status in Spring before taking any action.' : 'Complete payment and ticket issuance before the countdown ends.'}</small></section>`;
};
const startBookingDeadlineTimer = modal => {
  clearInterval(bookingDeadlineTimer);
  const timer = modal.querySelector('[data-ticketing-deadline]');
  if (!timer) return;
  const deadline = Number(timer.dataset.ticketingDeadline);
  const refresh = () => {
    const remaining = deadline - Date.now();
    const target = timer.querySelector('strong');
    if (remaining <= 0) {
      target.textContent = 'Expired'; timer.classList.add('expired');
      const note = timer.querySelector('small');
      if (note) note.textContent = 'The 30-minute ticketing window has ended. Confirm the PNR status in Spring before taking any action.';
      const issue = modal.querySelector('.issue-portal-booking');
      const cancel = modal.querySelector('.cancel-portal-booking');
      if (issue) { issue.disabled = true; issue.title = 'Ticketing deadline expired'; }
      if (cancel) { cancel.disabled = true; cancel.title = 'Ticketing deadline expired'; }
      clearInterval(bookingDeadlineTimer); return;
    }
    target.textContent = formatCountdown(remaining);
  };
  refresh(); bookingDeadlineTimer = setInterval(refresh, 1000);
};
const bookingFlightDetails = booking => {
  const [from, to] = booking.route.split('â†’').map(value => value.trim());
  return `<div class="booking-flight-detail"><div><span>OUTBOUND</span><strong>${from || 'ULN'} â†’ ${to || 'PVG'}</strong><small>Spring Airlines Â· 9C 7058 Â· Economy</small></div><b>13:00 â†’ 17:00</b></div><div class="booking-flight-detail"><div><span>RETURN</span><strong>${to || 'PVG'} â†’ ${from || 'ULN'}</strong><small>Spring Airlines Â· 9C 7057 Â· Economy</small></div><b>08:10 â†’ 12:00</b></div>`;
};
const displayFlightDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};
const bookingFlightDetailsClean = booking => {
  const storedFlights = booking.itinerary?.flights;
  if (Array.isArray(storedFlights) && storedFlights.length) return storedFlights.map((flight, index) => {
    const legKey = index ? 'return' : 'outbound';
    const noShowCount = (booking.itinerary?.noShow?.[legKey] || []).length;
    const state = booking.status === 'Cancelled' ? 'cancelled' : noShowCount ? 'no-show' : booking.status === 'Ticketed' ? 'ticketed' : 'reserved';
    const label = storedFlights.length === 1 ? 'ONE WAY' : index ? 'RETURN' : 'OUTBOUND';
    const departureCode = flight.departure?.id || '';
    const arrivalCode = flight.arrival?.id || '';
    const departureTime = (flight.departure?.time || '').slice(-5) || '—';
    const arrivalTime = (flight.arrival?.time || '').slice(-5) || '—';
    const travelDate = displayFlightDate(flight.travelDate || (index ? booking.itinerary?.returnDate : booking.itinerary?.departureDate));
    const departureName = reviewAirportName(flight.departure);
    const arrivalName = reviewAirportName(flight.arrival);
    const durationMinutes = Number(flight.duration);
    const duration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? formatMinutes(durationMinutes) : 'Nonstop';
    const terminal = endpoint => endpoint?.terminal ? ` · ${endpoint.terminal}` : '';
    const previous = [...(booking.itinerary?.changeHistory || [])].reverse().map(entry => ({ ...(entry.legs || []).find(item => item.key === legKey), changedAt: entry.changedAt })).find(item => item?.oldFlight);
    const oldFlight = previous?.oldFlight;
    const changedAt = previous?.changedAt ? new Date(previous.changedAt).toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const history = oldFlight ? `<article class="booking-flight-history"><small>REPLACED FLIGHT · ${changedAt}</small><strong>${oldFlight.departure?.id || ''} ${oldFlight.departure?.time || ''} → ${oldFlight.arrival?.id || ''} ${oldFlight.arrival?.time || ''}</strong><em>Flight ${oldFlight.number || '—'} · inactive after change</em></article>` : '';
    const stateText = oldFlight ? 'Active after change' : state === 'ticketed' ? 'Ticketed' : state === 'cancelled' ? 'Cancelled' : state === 'no-show' ? `${noShowCount} no-show` : 'Reserved';
    return `${history}<article class="booking-flight-detail booking-itinerary-leg"><header><span>${label}</span><strong>${travelDate || 'Travel date pending'}</strong></header><div class="booking-leg-timeline"><div class="booking-leg-airport departure"><small><b>${departureCode}</b> ${departureName}${terminal(flight.departure)}</small></div><b class="booking-leg-time departure">${departureTime}</b><div class="booking-leg-line"><span>${duration}</span><i></i><small>${flight.stops ? `${flight.stops} stop${flight.stops > 1 ? 's' : ''}` : 'Nonstop'}</small></div><b class="booking-leg-time arrival">${arrivalTime}</b><div class="booking-leg-airport arrival"><small><b>${arrivalCode}</b> ${arrivalName}${terminal(flight.arrival)}</small></div></div><footer><i class="booking-itinerary-logo">${airlineLogo(flight.airline, flight.airlineLogo, `${flight.airline || 'Airline'} logo`)}</i><b>${flight.airline || 'Spring Airlines'}</b><span>Flight ${flight.number || '—'}</span><span>${flight.fare?.cabin || 'Economy'}</span><em class="segment-status ${state}">${stateText}</em></footer></article>`;
  }).join('');
  const [from = 'ULN', to = 'PVG'] = booking.route.match(/[A-Z]{3}/g) || [];
  const states = booking.legStates || { outbound: 'active', return: 'active' };
  const flightRow = (label, route, number, times, date, state) => `<div class="booking-flight-detail ${state === 'flown' ? 'flown-flight' : ''}"><div><span>${label}</span><strong>${route}</strong><small>${date} &middot; Spring Airlines &middot; ${number} &middot; Economy</small></div><div class="flight-detail-right"><b>${times}</b><em class="segment-status ${state === 'flown' ? 'flown' : 'ticketed'}">${state === 'flown' ? 'Flown' : 'Ticketed'}</em></div></div>`;
  const outbound = flightRow(booking.oneWay ? 'ONE WAY' : 'OUTBOUND', `${from} &rarr; ${to}`, '9C 7058', '13:00 &rarr; 17:00', states.outbound === 'flown' ? 'Thu, 30 Jul 2026' : 'Thu, 20 Aug 2026', states.outbound);
  const returnFlight = booking.oneWay ? '' : flightRow('RETURN', `${to} &rarr; ${from}`, '9C 7057', '08:10 &rarr; 12:00', states.return === 'flown' ? 'Thu, 06 Aug 2026' : 'Thu, 27 Aug 2026', states.return);
  return `${outbound}${returnFlight}`;
};
const bookingFareBreakdown = booking => {
  const flights = Array.isArray(booking.itinerary?.flights) ? booking.itinerary.flights : [];
  const total = cnyAmount(booking.total);
  const base = flights.reduce((sum, flight) => sum + cnyAmount(flight?.fare?.baseFare), 0);
  const taxes = flights.reduce((sum, flight) => sum + cnyAmount(flight?.fare?.taxes), 0);
  const known = base + taxes;
  // A booking total can include a live passenger mix. Preserve the exact
  // booked total, allocating the display breakdown in Spring's fare/tax ratio.
  const fareAmount = known > 0 ? total * (base / known) : total;
  const taxAmount = Math.max(0, total - fareAmount);
  const types = (booking.documents || []).map(item => item.type || 'ADT');
  const typeSummary = ['ADT', 'CHD', 'INF'].map(type => {
    const count = types.filter(item => item === type).length;
    return count ? `${count} ${type}` : '';
  }).filter(Boolean).join(' · ');
  return `<section class="booking-fare-breakdown"><h3>Price breakdown</h3><div><span>Fare</span><b>${quoteMnt(fareAmount)}</b></div><div><span>Taxes &amp; fees</span><b>${quoteMnt(taxAmount)}</b></div><div class="booking-fare-total"><span>Total fare${typeSummary ? ` · ${typeSummary}` : ''}</span><strong>${quoteMnt(total)}</strong></div></section>`;
};
const downloadBookingDocument = async (pnr, type) => {
  const response = await secureFetch(`/api/bookings/${encodeURIComponent(pnr)}/${type}.pdf`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Unable to generate ${type}.`);
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href; link.download = `${pnr}-${type}.pdf`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1_000);
};
const openBookingDetail = ref => {
  const booking = bookings.find(item => item.ref === ref);
  if (!booking) return;
  const modal = bookingDetailModal();
  const passengers = booking.passengers || [booking.passenger];
  const activeLegs = bookingLegs(booking).filter(leg => !leg.flown && !leg.allNoShow);
  const allFlightsUsed = !activeLegs.length;
  const passengerDescription = `${booking.passengerCount || passengers.length} Adult${(booking.passengerCount || passengers.length) > 1 ? 's' : ''} &middot; Passport details verified before ticketing`;
  const passengerList = passengers.map((name, index) => {
    const document = booking.documents?.[index] || {};
    const type = document.type || booking.passengerTypes?.[index] || 'ADT';
    const noShow = passengerHasNoShow(booking, index);
    return `<div class="passenger-entry"><div class="passenger-name-row"><strong>${index + 1}. ${name}</strong><b class="passenger-type">${type}</b></div><span>${noShow ? 'No-show recorded' : 'Passenger details'}</span><div class="passenger-document"><span>Passport number</span><b>${document.documentNumber || '—'}</b><span>Date of birth</span><b>${document.dateOfBirth || '—'}</b><span>Gender</span><b>${document.gender || '—'}</b><span>Nationality</span><b>${document.nationality || '—'}</b><span>Passport expiry</span><b>${document.documentExpiry || '—'}</b></div></div>`;
  }).join('');
  const ticketingExpired = booking.createdAt && Date.now() >= new Date(booking.createdAt).getTime() + 30 * 60 * 1000;
  const reservedActions = `<button type="button" class="secondary cancel-portal-booking" ${allFlightsUsed || booking.status === 'Cancelled' || ticketingExpired ? 'disabled' : ''} ${ticketingExpired ? 'title="Ticketing deadline expired"' : ''}>Cancel booking</button><button type="button" class="primary issue-portal-booking" ${allFlightsUsed || booking.status === 'Cancelled' || ticketingExpired ? 'disabled' : ''} ${ticketingExpired ? 'title="Ticketing deadline expired"' : ''}>Issue ticket</button>`;
  const ticketedActions = `<button type="button" class="secondary cancel-ticket-flow" ${allFlightsUsed ? 'disabled' : ''}>Cancel ticket</button><button type="button" class="primary change-ticket-flow" ${allFlightsUsed ? 'disabled' : ''}>Change booking</button>`;
  const documentActions = booking.status === 'Ticketed' ? `<div class="booking-document-actions"><button type="button" class="secondary download-ticket">Print ticket (PDF)</button><button type="button" class="secondary download-receipt">Receipt (PDF)</button></div>` : '';
  const springConfirmed = booking.itinerary?.springOrder?.lastSyncedAt ? '<span class="tag ticketed">Spring confirmed</span>' : '';
  modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button" aria-label="Close">&times;</button><p class="eyebrow">BOOKING DETAILS</p><h2>${booking.ref}</h2><div class="detail-status"><span class="tag ${booking.status.toLowerCase()}">${booking.status}</span>${springConfirmed}<span>Created ${booking.issued}</span></div>${bookingTicketingDeadline(booking)}<section class="booking-detail-card"><h3>Itinerary</h3>${bookingFlightDetailsClean(booking)}</section><section class="booking-detail-card booking-passenger"><h3>Passengers</h3>${passengerList}<span class="passenger-summary">${passengerDescription}</span>${booking.status === 'Reserved' ? '<small class="passenger-lock-note">Passenger details are locked after the Spring PNR is created. Editing can be enabled only after Spring supplies its supported passenger/order modification API.</small>' : ''}</section><section class="booking-detail-card contact-detail"><h3>Contact person</h3><strong>${booking.contact?.name || '—'}</strong><span>${booking.contact?.phone || ''} ${booking.contact?.phone && booking.contact?.email ? '&middot;' : ''} ${booking.contact?.email || ''}</span></section>${bookingFareBreakdown(booking)}${documentActions}<div class="booking-detail-actions">${booking.status === 'Reserved' ? reservedActions : booking.status === 'Ticketed' ? ticketedActions : ''}</div>${booking.status === 'Reserved' ? '<p class="booking-disclaimer">Issue ticket charges the agency wallet through Spring credit payment. When Spring confirms payment, the ticket is issued automatically.</p>' : booking.status === 'Ticketed' ? '<p class="booking-disclaimer">Cancellation quotes are calculated by Spring Airlines. Change and final refund submission will be connected after Spring order-detail IDs are synchronised.</p>' : ''}</section>`;
  modal.querySelector('.booking-close').addEventListener('click', () => { clearInterval(bookingDeadlineTimer); modal.close(); });
  modal.querySelector('.cancel-portal-booking')?.addEventListener('click', async () => { if (!confirm(`Cancel booking ${booking.ref}?`)) return; try { await updatePortalBookingStatus(booking.ref, 'cancel'); modal.close(); toast(`Booking ${booking.ref} cancelled.`); } catch (error) { toast(error.message); } });
  modal.querySelector('.issue-portal-booking')?.addEventListener('click', async event => { const button = event.currentTarget; if (!confirm(`Issue ticket for ${booking.ref}? This will charge the agency wallet.`)) return; button.disabled = true; button.textContent = 'Issuing ticket…'; try { await updatePortalBookingStatus(booking.ref, 'issue'); openBookingDetail(booking.ref); toast(`Spring payment succeeded. Ticket ${booking.ref} is issued.`); } catch (error) { button.disabled = false; button.textContent = 'Issue ticket'; toast(error.message); } });
  modal.querySelector('.cancel-ticket-flow')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Checking Spring status…';
    try {
      const response = await secureFetch(`/api/bookings/${encodeURIComponent(booking.ref)}/sync`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Spring status could not be checked.');
      // The sync endpoint returns the database row; turn it back into the UI
      // booking shape before rendering passenger/segment selections.
      showCancelFlow(modal, payload.booking ? portalBookingFromRow(payload.booking) : booking);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Cancel ticket';
      toast(error.message || 'Spring status could not be checked.');
    }
  });
  modal.querySelector('.change-ticket-flow')?.addEventListener('click', () => showChangeFlow(modal, booking));
  modal.querySelector('.download-ticket')?.addEventListener('click', async event => { event.currentTarget.disabled = true; try { await downloadBookingDocument(booking.ref, 'ticket'); } catch (error) { toast(error.message); } finally { event.currentTarget.disabled = false; } });
  modal.querySelector('.download-receipt')?.addEventListener('click', async event => { event.currentTarget.disabled = true; try { await downloadBookingDocument(booking.ref, 'receipt'); } catch (error) { toast(error.message); } finally { event.currentTarget.disabled = false; } });
  modal.showModal();
  startBookingDeadlineTimer(modal);
};
const showCancelEstimate = (modal, booking) => {
  modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button" aria-label="Close">Ã—</button><p class="eyebrow">CANCEL TICKET</p><h2>Cancellation estimate</h2><p class="modal-copy">Review the estimated refund before submitting this ticket cancellation request.</p><section class="fee-summary"><div><span>Original ticket amount</span><b>${booking.total}</b></div><div><span>Airline cancellation fee</span><b>âˆ’ Â¥ 320.00</b></div><div><span>Service fee</span><b>âˆ’ Â¥ 60.00</b></div><div class="fee-total"><span>Estimated refund</span><strong>Â¥ 900.00</strong></div></section><p class="booking-warning">After confirmation, the cancellation is sent to the airline. Final refund is subject to fare rules and airline approval.</p><div class="booking-detail-actions"><button type="button" class="secondary back-booking">Back</button><button type="button" class="primary confirm-cancel">Confirm cancellation</button></div></section>`;
  modal.querySelector('.booking-close').addEventListener('click', () => modal.close());
  modal.querySelector('.back-booking').addEventListener('click', () => openBookingDetail(booking.ref));
  modal.querySelector('.confirm-cancel').addEventListener('click', () => { modal.close(); toast(`Cancellation request for ${booking.ref} created. Estimated refund: Â¥ 900.00.`); });
};
const showChangeEstimate = (modal, booking) => {
  modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button" aria-label="Close">Ã—</button><p class="eyebrow">CHANGE BOOKING</p><h2>Change itinerary</h2><p class="modal-copy">Choose which flight to change, then select the requested new travel date.</p><section class="change-options"><label><input type="radio" name="change-scope" value="both" checked /> Change both flights</label><label><input type="radio" name="change-scope" value="outbound" /> Departure flight only</label><label><input type="radio" name="change-scope" value="return" /> Return flight only</label></section><label class="change-date">New travel date<input type="date" min="2026-08-08" value="2026-08-25" /></label><section class="fee-summary change-estimate" hidden><div><span>Airline change fee</span><b>Â¥ 150.00</b></div><div><span>Estimated fare difference</span><b>Â¥ 180.00</b></div><div class="fee-total"><span>Estimated additional payment</span><strong>Â¥ 330.00</strong></div></section><div class="booking-detail-actions"><button type="button" class="secondary back-booking">Back</button><button type="button" class="primary calculate-change">Calculate change</button><button type="button" class="primary confirm-change" hidden>Confirm change request</button></div></section>`;
  modal.querySelector('.booking-close').addEventListener('click', () => modal.close());
  modal.querySelector('.back-booking').addEventListener('click', () => openBookingDetail(booking.ref));
  modal.querySelector('.calculate-change').addEventListener('click', event => { modal.querySelector('.change-estimate').hidden = false; modal.querySelector('.confirm-change').hidden = false; event.currentTarget.textContent = 'Recalculate'; });
  modal.querySelector('.confirm-change').addEventListener('click', () => { modal.close(); toast(`Change request for ${booking.ref} created. Estimated additional payment: Â¥ 330.00.`); });
};
const bookingLegs = booking => {
  const storedFlights = booking.itinerary?.flights;
  const noShow = booking.itinerary?.noShow || {};
  if (Array.isArray(storedFlights) && storedFlights.length) return storedFlights.map((flight, index) => {
    const key = index ? 'return' : 'outbound'; const passengers = booking.passengers || [booking.passenger];
    const springState = String(flight.status || '').toLowerCase();
    const springNoShow = springState === 'no-show' || springState === 'noshow';
    const noShowPassengers = springNoShow ? passengers.map((_, passengerIndex) => passengerIndex) : (noShow[key] || []).map(Number).filter(Number.isInteger);
    const travelDate = flight.travelDate || (index ? booking.itinerary?.returnDate : booking.itinerary?.departureDate) || '';
    return { key, route: `${flight.departure?.id || ''} &rarr; ${flight.arrival?.id || ''}`, flight: `${flight.airline || 'Spring Airlines'} &middot; ${flight.number || 'Flight'}`, time: `${(flight.departure?.time || '').slice(-5)} &rarr; ${(flight.arrival?.time || '').slice(-5)}`, date: displayFlightDate(travelDate), travelDate, flown: springState === 'flown' || springState === 'used', cancelled: springState === 'cancelled', noShowPassengers, allNoShow: passengers.length > 0 && noShowPassengers.length >= passengers.length, orderItemId: booking.itinerary?.springOrder?.orderItemIds?.[index] || null };
  });
  const [from = 'ULN', to = 'PVG'] = booking.route.match(/[A-Z]{3}/g) || [];
  const states = booking.legStates || { outbound: booking.ref === 'L3Y7CX' ? 'flown' : 'active', return: 'active' };
  const legs = [{ key: 'outbound', route: `${from} &rarr; ${to}`, flight: 'Spring Airlines &middot; 9C 7058', time: '13:00 &rarr; 17:00', flown: states.outbound === 'flown', noShowPassengers: [], allNoShow: false }];
  if (!booking.oneWay) legs.push({ key: 'return', route: `${to} &rarr; ${from}`, flight: 'Spring Airlines &middot; 9C 7057', time: '08:10 &rarr; 12:00', flown: states.return === 'flown', noShowPassengers: [], allNoShow: false });
  return legs;
};
const passengerHasNoShow = (booking, index) => Object.values(booking.itinerary?.noShow || {}).some(list => (list || []).map(Number).includes(index));
const flightChoice = (leg, mode, checked = false) => { const locked = leg.flown || leg.allNoShow || leg.cancelled; return `<label class="flight-choice ${locked ? 'flown' : ''}"><input type="checkbox" name="${mode}-leg" value="${leg.key}" ${checked && !locked ? 'checked' : ''} ${locked ? 'disabled' : ''}/><span class="flight-choice-copy"><small>${leg.flown ? 'FLOWN' : leg.allNoShow ? 'NO-SHOW' : leg.cancelled ? 'CANCELLED' : 'ACTIVE FLIGHT'}</small><strong>${leg.route}</strong><em>${leg.date ? `${leg.date} &middot; ` : ''}${leg.flight}</em></span><b>${leg.time}</b><i>${leg.flown ? 'Used' : leg.allNoShow ? 'No-show' : leg.cancelled ? 'Cancelled' : 'Select'}</i></label>`; };
const passengerChoices = (booking, mode, { checked = true, disableNoShow = true } = {}) => (booking.passengers || [booking.passenger]).map((passenger, index) => { const noShow = passengerHasNoShow(booking, index); const locked = disableNoShow && noShow; return `<label class="passenger-choice ${locked ? 'flown' : ''}"><input type="checkbox" name="${mode}-passenger" value="${index}" ${checked && !locked ? 'checked' : ''} ${locked ? 'disabled' : ''}/><span><strong>${index + 1}. ${passenger}</strong><small>${locked ? 'No-show recorded' : 'Adult passenger'}</small></span></label>`; }).join('');
const yen = value => quoteMnt(value);
const showCancelSelection = (modal, booking) => {
  const legs = bookingLegs(booking);
  modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button" aria-label="Close">&times;</button><p class="eyebrow">CANCEL TICKET</p><h2>Select flights and passengers</h2><p class="modal-copy">Choose the flight and passenger(s) to cancel. A flown segment cannot be cancelled.</p><section class="selection-group"><h3>Flights</h3><section class="flight-choice-list">${legs.map(leg => flightChoice(leg, 'cancel', !leg.flown)).join('')}</section></section><section class="selection-group"><h3>Passengers</h3><section class="passenger-choice-list">${passengerChoices(booking, 'cancel')}</section></section><section class="fee-summary cancel-estimate" hidden></section><p class="booking-warning" hidden>After confirmation, the cancellation is sent to the airline. The final refund is subject to airline fare rules and approval.</p><div class="booking-detail-actions"><button type="button" class="secondary back-booking">Back</button><button type="button" class="primary calculate-cancel">Calculate refund</button><button type="button" class="primary confirm-cancel" hidden>Confirm cancellation</button></div></section>`;
  modal.querySelector('.booking-close').addEventListener('click', () => modal.close());
  modal.querySelector('.back-booking').addEventListener('click', () => openBookingDetail(booking.ref));
  modal.querySelector('.calculate-cancel').addEventListener('click', event => {
    const selected = [...modal.querySelectorAll('[name="cancel-leg"]:checked')];
    const selectedPassengers = modal.querySelectorAll('[name="cancel-passenger"]:checked').length;
    if (!selected.length || !selectedPassengers) { modal.querySelector('.cancel-estimate').hidden = true; modal.querySelector('.booking-warning').hidden = true; modal.querySelector('.confirm-cancel').hidden = true; return; }
    const ticketAmount = Number(String(booking.total).replace(/[^\d.]/g, '')) * (selected.length / legs.length) * (selectedPassengers / (booking.passengerCount || 1));
    const airlineFee = ticketAmount * .25;
    const serviceFee = 30 * selected.length * selectedPassengers;
    const estimate = { amount: yen(ticketAmount), airline: `− ${yen(airlineFee)}`, service: `− ${yen(serviceFee)}`, refund: yen(Math.max(0, ticketAmount - airlineFee - serviceFee)) };
    modal.querySelector('.cancel-estimate').innerHTML = `<div><span>Selected ticket amount</span><b>${estimate.amount}</b></div><div><span>Airline cancellation fee</span><b>${estimate.airline}</b></div><div><span>Service fee</span><b>${estimate.service}</b></div><div class="fee-total"><span>Refund</span><strong>${estimate.refund}</strong></div>`;
    modal.querySelector('.cancel-estimate').hidden = false;
    modal.querySelector('.booking-warning').hidden = false;
    modal.querySelector('.confirm-cancel').hidden = false;
    event.currentTarget.textContent = 'Recalculate refund';
  });
  const cancelCalculator = modal.querySelector('.calculate-cancel');
  modal.querySelectorAll('[name="cancel-leg"], [name="cancel-passenger"]').forEach(input => input.addEventListener('change', () => cancelCalculator.click()));
  cancelCalculator.click();
  modal.querySelector('.confirm-cancel').addEventListener('click', () => { modal.close(); toast(`Cancellation request for ${booking.ref} created.`); });
};
const showChangeSelection = (modal, booking) => {
  const legs = bookingLegs(booking);
  const renderDates = () => [...modal.querySelectorAll('[name="change-leg"]:checked')].map(input => `<label class="change-date"><span>New date for ${input.value === 'outbound' ? 'departure flight' : 'return flight'}</span><input type="date" min="2026-08-08" value="2026-08-25" /></label>`).join('') || '<p class="selection-hint">Select an active flight to choose a new date.</p>';
  modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button" aria-label="Close">&times;</button><p class="eyebrow">CHANGE BOOKING</p><h2>Select flights and passengers</h2><p class="modal-copy">Choose the flight and passenger(s) to change. Used segments are shown as Flown and cannot be changed.</p><section class="selection-group"><h3>Flights</h3><section class="flight-choice-list">${legs.map(leg => flightChoice(leg, 'change', !leg.flown)).join('')}</section></section><section class="selection-group"><h3>Passengers</h3><section class="passenger-choice-list">${passengerChoices(booking, 'change')}</section></section><section class="change-date-list"></section><section class="fee-summary change-estimate" hidden></section><div class="booking-detail-actions"><button type="button" class="secondary back-booking">Back</button><button type="button" class="primary calculate-change">Calculate change</button><button type="button" class="primary confirm-change" hidden>Confirm change request</button></div></section>`;
  const dateList = modal.querySelector('.change-date-list');
  const refreshDates = () => { dateList.innerHTML = renderDates(); };
  refreshDates();
  modal.querySelectorAll('[name="change-leg"]').forEach(input => input.addEventListener('change', refreshDates));
  modal.querySelector('.booking-close').addEventListener('click', () => modal.close());
  modal.querySelector('.back-booking').addEventListener('click', () => openBookingDetail(booking.ref));
  modal.querySelector('.calculate-change').addEventListener('click', event => {
    const selected = modal.querySelectorAll('[name="change-leg"]:checked').length;
    const selectedPassengers = modal.querySelectorAll('[name="change-passenger"]:checked').length;
    if (!selected || !selectedPassengers) { modal.querySelector('.change-estimate').hidden = true; modal.querySelector('.confirm-change').hidden = true; return; }
    const changeFee = 150 * selected * selectedPassengers;
    const fareDifference = 180 * selected * selectedPassengers;
    const total = changeFee + fareDifference;
    modal.querySelector('.change-estimate').innerHTML = `<div><span>Airline change fee</span><b>${yen(changeFee)}</b></div><div><span>Fare difference</span><b>${yen(fareDifference)}</b></div><div class="fee-total"><span>Additional payment</span><strong>${yen(total)}</strong></div>`;
    modal.querySelector('.change-estimate').hidden = false;
    modal.querySelector('.confirm-change').hidden = false;
    event.currentTarget.textContent = 'Recalculate change';
  });
  const changeCalculator = modal.querySelector('.calculate-change');
  modal.querySelectorAll('[name="change-leg"], [name="change-passenger"]').forEach(input => input.addEventListener('change', () => changeCalculator.click()));
  changeCalculator.click();
  modal.querySelector('.confirm-change').addEventListener('click', () => { modal.close(); toast(`Change request for ${booking.ref} created.`); });
};
const selectedPassengerNames = (modal, mode, booking) => [...modal.querySelectorAll(`[name="${mode}-passenger"]:checked`)].map(input => (booking.passengers || [booking.passenger])[Number(input.value)]);
const showCancelFlow = (modal, booking) => {
  const legs = bookingLegs(booking);
  const activeLegs = legs.filter(leg => !leg.flown && !leg.allNoShow && !leg.cancelled);
  modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button">&times;</button><p class="eyebrow">CANCEL TICKET</p><h2>Select flights and passengers</h2><p class="modal-copy">Spring calculates the actual refund and applies any no-show condition automatically. Flown flights cannot be cancelled.</p><section class="selection-group"><h3>Itinerary</h3><section class="flight-choice-list">${legs.map(leg => flightChoice(leg, 'cancel-flow', !leg.flown)).join('')}</section></section><section class="selection-group"><h3>Passengers</h3><section class="passenger-choice-list">${passengerChoices(booking, 'cancel-flow')}</section></section><p class="selection-hint">For now Spring calculates the whole PNR. Partial passenger or segment refunds will be enabled after order-detail IDs are synchronised.</p><div class="booking-detail-actions"><button type="button" class="secondary back-booking">Back</button><button type="button" class="primary calculate-cancel-flow">Calculate refund</button></div></section>`;
  modal.querySelector('.booking-close').addEventListener('click', () => modal.close());
  modal.querySelector('.back-booking').addEventListener('click', () => openBookingDetail(booking.ref));
  modal.querySelector('.calculate-cancel-flow').addEventListener('click', async event => {
    const selectedLegs = legs.filter(leg => modal.querySelector(`[name="cancel-flow-leg"][value="${leg.key}"]`)?.checked);
    const passengers = selectedPassengerNames(modal, 'cancel-flow', booking);
    if (!selectedLegs.length || !passengers.length) return toast('Select at least one active flight and one passenger.');
    const allPassengers = booking.passengers || [booking.passenger];
    if (selectedLegs.length !== activeLegs.length || passengers.length !== allPassengers.length) return toast('Spring whole-PNR calculation currently requires all active flights and passengers to be selected.');
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Calculating…';
    try {
      const response = await secureFetch(`/api/bookings/${encodeURIComponent(booking.ref)}/refund-quote`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Spring refund calculation failed.');
      const quote = data.quote?.amountsCny || {};
      const quoteMnt = data.quote?.amountsMnt || {};
      const amount = key => Number.isFinite(Number(quoteMnt[key])) ? mnt(quoteMnt[key]) : Number.isFinite(Number(quote[key])) ? yen(quote[key]) : '—';
      const refundRate = data.quote?.refundRate;
      modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button">&times;</button><p class="eyebrow">CANCEL TICKET</p><h2>Spring refund calculation</h2><p class="modal-copy">Calculated directly by Spring Airlines for PNR ${booking.ref}. Any no-show condition is included in this calculation.</p><section class="summary-selection"><h3>Flights to cancel</h3>${selectedLegs.map(leg => `<div><strong>${leg.route}</strong><span>${leg.flight} &middot; ${leg.time}</span></div>`).join('')}<h3>Passengers</h3><p>${passengers.join(' &middot; ')}</p></section><section class="fee-summary"><div><span>Refundable ticket amount</span><b>${amount('ticketAmount')}</b></div><div><span>Refundable fare</span><b>${amount('refundableFare')}</b></div><div><span>Refundable taxes</span><b>${amount('refundableTaxes')}</b></div><div><span>Airline cancellation / no-show fee</span><b>− ${amount('cancellationFee')}</b></div><div><span>Non-refundable amount</span><b>− ${amount('nonRefundable')}</b></div><div class="fee-total"><span>Refund</span><strong>${amount('refund')}</strong></div></section><p class="booking-warning">This uses Spring Airlines’ live calculation. Confirming submits the full-PNR refund to Spring; the agency wallet is not credited until the airline settlement is confirmed.</p><div class="booking-detail-actions"><button type="button" class="secondary back-booking">Back</button><button type="button" class="primary confirm-cancel">Confirm refund</button></div></section>`;
    } catch (error) {
      toast(error.message || 'Spring refund calculation failed.');
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = 'Calculate refund';
      return;
    }
    modal.querySelector('.booking-close').addEventListener('click', () => modal.close());
    modal.querySelector('.back-booking').addEventListener('click', () => showCancelFlow(modal, booking));
    modal.querySelector('.confirm-cancel').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Submitting refund…';
      try {
        const response = await secureFetch(`/api/bookings/${encodeURIComponent(booking.ref)}/refund-submit`, { method: 'POST' });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Spring refund submission failed.');
        modal.close(); toast(`Refund submitted to Spring for ${booking.ref}.`); showView('bookings');
      } catch (error) { button.disabled = false; button.textContent = 'Confirm refund'; toast(error.message || 'Spring refund submission failed.'); }
    });
  });
};
const showChangeFlow = (modal, booking) => {
  const legs = bookingLegs(booking);
  const replacements = leg => {
    const orderItem = leg.orderItemId ? `data-order-item-id="${leg.orderItemId}"` : '';
    const unavailable = leg.orderItemId ? '' : '<p class="selection-hint">Spring order item is unavailable. Sync this ticket before changing it.</p>';
    return `<section class="replacement-flight" data-for="${leg.key}" data-travel-date="${leg.travelDate || ''}" ${orderItem}><div class="replacement-title"><span>New date for ${leg.key === 'outbound' ? 'departure flight' : 'return flight'}</span><strong>${leg.flight}</strong><small>${leg.route} &middot; ${leg.time}</small></div><button type="button" class="availability-date" data-for="${leg.key}" data-flight="" data-time="" data-date="" ${leg.orderItemId ? '' : 'disabled'}>Choose a new date</button><div class="availability-calendar" hidden><div class="availability-head"><button type="button" class="availability-prev" aria-label="Previous month">‹</button><strong>Loading…</strong><button type="button" class="availability-next" aria-label="Next month">›</button></div><div class="availability-week"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="availability-days"></div><p>Available dates only. Select a date to view matching flights and their fare difference.</p></div><div class="daily-flight-options">${unavailable}</div></section>`;
  };
  const bindAvailabilityCalendars = () => modal.querySelectorAll('.replacement-flight[data-order-item-id]').forEach(section => {
    const trigger = section.querySelector('.availability-date'); const calendar = section.querySelector('.availability-calendar'); const choices = section.querySelector('.daily-flight-options');
    const today = new Date(); today.setHours(0, 0, 0, 0); const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1); const travelDate = section.dataset.travelDate || ''; const flightMonth = /^\d{4}-\d{2}-\d{2}$/.test(travelDate) ? new Date(`${travelDate}T12:00:00`) : null; let shownDate = flightMonth && flightMonth >= currentMonth ? new Date(flightMonth.getFullYear(), flightMonth.getMonth(), 1) : new Date(currentMonth);
    let loadingMonth = ''; let loadedMonth = '';
    const monthKey = () => `${shownDate.getFullYear()}-${String(shownDate.getMonth() + 1).padStart(2, '0')}`;
    const renderDailyFlights = (date, flights) => {
      const option = (flight, checked) => { const timing = `${flight.departure.time} ${flight.departure.code} → ${flight.arrival.time} ${flight.arrival.code}`; const difference = Number(flight.fareDifferenceCny || 0); const price = difference > 0 ? `+ ${quoteMnt(difference)}` : 'No fare difference'; return `<label class="daily-flight-choice"><input type="radio" name="daily-${trigger.dataset.for}" value="${flight.flightNo}|${timing}" data-segment-head-id="${flight.segmentHeadId || ''}" data-date="${date}" data-flight-no="${flight.flightNo || ''}" data-booking-class="${flight.bookingClass || ''}" data-departure-code="${flight.departure?.code || ''}" data-departure-name="${flight.departure?.name || ''}" data-departure-time="${flight.departure?.time || ''}" data-arrival-code="${flight.arrival?.code || ''}" data-arrival-name="${flight.arrival?.name || ''}" data-arrival-time="${flight.arrival?.time || ''}" ${checked ? 'checked' : ''}/><span><strong>Spring Airlines · ${flight.flightNo}</strong><small>${timing}${flight.bookingClass ? ` · ${flight.bookingClass}` : ''}</small></span><b>${price}</b></label>`; };
      choices.innerHTML = `<h3>Available flights on ${date}</h3>${flights.map((flight, index) => option(flight, index === 0)).join('')}`;
      const setChoice = input => { const [flight, timing] = input.value.split('|'); trigger.dataset.flight = flight; trigger.dataset.time = timing; trigger.dataset.date = input.dataset.date || date; };
      choices.querySelectorAll('input').forEach(input => input.addEventListener('change', () => setChoice(input)));
      setChoice(choices.querySelector('input:checked'));
    };
    const renderMonth = async () => {
      const requestedMonth = monthKey();
      // The calendar is prefetched while hidden. Do not start the same 28–31
      // Spring requests again when the user opens it during that prefetch.
      if (loadingMonth === requestedMonth || loadedMonth === requestedMonth) return;
      loadingMonth = requestedMonth;
      const first = new Date(shownDate.getFullYear(), shownDate.getMonth(), 1); const start = (first.getDay() + 6) % 7; const totalDays = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      calendar.querySelector('.availability-head strong').textContent = first.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      // Spring calculates availability one date at a time. Show the full
      // calendar immediately so the user never sees an empty panel while the
      // live requests are still running.
      const initialBlanks = '<span class="availability-blank"></span>'.repeat(start);
      const initialDays = Array.from({ length: totalDays }, (_, index) => {
        const day = index + 1;
        return `<button type="button" class="availability-day loading" disabled><strong>${day}</strong><span>Loading…</span></button>`;
      }).join('');
      calendar.querySelector('.availability-days').innerHTML = `${initialBlanks}${initialDays}`;
      try {
        const response = await secureFetch(`/api/bookings/${encodeURIComponent(booking.ref)}/change-calendar?orderItemId=${encodeURIComponent(section.dataset.orderItemId)}&month=${monthKey()}`);
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load Spring availability.');
        if (requestedMonth !== monthKey()) return;
        const byDate = new Map((data.items || []).map(item => [item.date, item]));
        const blanks = '<span class="availability-blank"></span>'.repeat(start);
        const buttons = Array.from({ length: totalDays }, (_, index) => { const day = index + 1; const date = `${monthKey()}-${String(day).padStart(2, '0')}`; const item = byDate.get(date); const available = Boolean(item?.available); return `<button type="button" class="availability-day ${available ? 'available' : 'unavailable'}${date === new Date().toISOString().slice(0, 10) ? ' today' : ''}" data-date="${date}" ${available ? '' : 'disabled'}><strong>${day}</strong><span>${available ? '●' : '–'}</span></button>`; }).join('');
        calendar.querySelector('.availability-days').innerHTML = `${blanks}${buttons}`;
        loadedMonth = requestedMonth;
        calendar.querySelectorAll('.availability-day:not(:disabled)').forEach(button => button.addEventListener('click', () => { const item = byDate.get(button.dataset.date); section.querySelectorAll('.availability-day').forEach(node => node.classList.remove('selected')); button.classList.add('selected'); trigger.textContent = `${button.dataset.date} · available`; calendar.hidden = true; renderDailyFlights(button.dataset.date, item.flights || []); }));
      } catch (error) {
        // Keep the month grid visible even if Spring is temporarily slow or
        // unavailable; replace each loading cell with the real explanation.
        calendar.querySelector('.availability-days').innerHTML = `${initialBlanks}${Array.from({ length: totalDays }, (_, index) => `<button type="button" class="availability-day unavailable" disabled><strong>${index + 1}</strong><span>–</span></button>`).join('')}`;
        choices.innerHTML = `<p class="selection-hint">${error.message}</p>`;
      } finally { if (loadingMonth === requestedMonth) loadingMonth = ''; }
    };
    trigger.addEventListener('click', async () => { calendar.hidden = !calendar.hidden; if (!calendar.hidden) await renderMonth(); });
    calendar.querySelector('.availability-prev').addEventListener('click', async () => { if (shownDate > currentMonth) { shownDate = new Date(shownDate.getFullYear(), shownDate.getMonth() - 1, 1); await renderMonth(); } });
    calendar.querySelector('.availability-next').addEventListener('click', async () => { shownDate = new Date(shownDate.getFullYear(), shownDate.getMonth() + 1, 1); await renderMonth(); });
  });
  const renderReplacements = () => { const selected = legs.filter(leg => modal.querySelector(`[name="change-flow-leg"][value="${leg.key}"]`)?.checked); modal.querySelector('.replacement-list').innerHTML = selected.map(replacements).join('') || '<p class="selection-hint">Select an active flight first.</p>'; bindAvailabilityCalendars(); };
  modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button">&times;</button><p class="eyebrow">CHANGE BOOKING</p><h2>Select flights and passengers</h2><p class="modal-copy">Choose the itinerary and passenger(s), then select a new date and flight.</p><section class="selection-group"><h3>Itinerary</h3><section class="flight-choice-list">${legs.map(leg => flightChoice(leg, 'change-flow', !leg.flown)).join('')}</section></section><section class="selection-group"><h3>Passengers</h3><section class="passenger-choice-list">${passengerChoices(booking, 'change-flow')}</section></section><section class="replacement-list"></section><div class="booking-detail-actions"><button type="button" class="secondary back-booking">Back</button><button type="button" class="primary calculate-change-flow">Calculate change</button></div></section>`;
  renderReplacements();
  modal.querySelectorAll('[name="change-flow-leg"]').forEach(input => input.addEventListener('change', renderReplacements));
  modal.querySelector('.booking-close').addEventListener('click', () => modal.close());
  modal.querySelector('.back-booking').addEventListener('click', () => openBookingDetail(booking.ref));
  modal.querySelector('.calculate-change-flow').addEventListener('click', async event => {
    const selectedLegs = legs.filter(leg => modal.querySelector(`[name="change-flow-leg"][value="${leg.key}"]`)?.checked);
    const passengers = selectedPassengerNames(modal, 'change-flow', booking);
    const selectedNewFlights = selectedLegs.map(leg => modal.querySelector(`[name="daily-${leg.key}"]:checked`));
    if (!selectedLegs.length || !passengers.length || selectedNewFlights.some(flight => !flight)) return toast('Select flights, passengers, and replacement flights.');
    const pairs = selectedLegs.map((leg, index) => ({
      flightsOrderHeadId: Number(leg.orderItemId),
      segHeadId: Number(selectedNewFlights[index].dataset.segmentHeadId)
    }));
    if (pairs.some(pair => !Number.isFinite(pair.flightsOrderHeadId) || !Number.isFinite(pair.segHeadId))) return toast('The selected flight is missing its Spring order information. Please sync the booking first.');
    const changes = selectedLegs.map((leg, index) => {
      const input = selectedNewFlights[index];
      return {
        key: leg.key,
        newFlight: {
          segmentHeadId: Number(input.dataset.segmentHeadId),
          flightNo: input.dataset.flightNo || input.value.split('|')[0],
          bookingClass: input.dataset.bookingClass || '',
          airline: 'Spring Airlines',
          travelDate: input.dataset.date || '',
          departure: { code: input.dataset.departureCode || '', name: input.dataset.departureName || '', time: input.dataset.departureTime || '', date: input.dataset.date || '' },
          arrival: { code: input.dataset.arrivalCode || '', name: input.dataset.arrivalName || '', time: input.dataset.arrivalTime || '', date: input.dataset.date || '' }
        }
      };
    });
    const calculate = event.currentTarget;
    calculate.disabled = true;
    calculate.textContent = 'Calculating…';
    try {
      const response = await secureFetch(`/api/bookings/${encodeURIComponent(booking.ref)}/change-quote`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bgPairList: pairs })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Spring change calculation failed.');
      const quote = data.quote;
      const cny = quote.amountsCny || {};
      const mnt = quote.amountsMnt || {};
      const display = (key) => Number.isFinite(Number(mnt[key])) ? `₮ ${Number(mnt[key]).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : yen(cny[key] || 0);
      const comparisons = selectedLegs.map((leg, index) => { const input = selectedNewFlights[index]; const number = input.dataset.flightNo || input.value.split('|')[0]; const newDate = displayFlightDate(input.dataset.date || ''); const newTimes = `${input.dataset.departureTime || '—'} → ${input.dataset.arrivalTime || '—'}`; return `<div class="flight-comparison"><div><small>OLD FLIGHT</small><strong>${leg.route}</strong><span>${leg.date ? `${displayFlightDate(leg.date)} · ` : ''}${leg.flight} · ${leg.time}</span></div><i>→</i><div><small>NEW FLIGHT</small><strong>${input.dataset.departureCode || leg.route.split(' ')[0]} → ${input.dataset.arrivalCode || leg.route.split(' ').at(-1)}</strong><span>${newDate ? `${newDate} · ` : ''}Spring Airlines · ${number} · ${newTimes}</span></div></div>`; }).join('');
      const gateway = Number(cny.paymentFee || 0) > 0 ? `<div><span>Payment gateway fee</span><b>${display('paymentFee')}</b></div>` : '';
      modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button">&times;</button><p class="eyebrow">CHANGE BOOKING</p><h2>Spring change calculation</h2><p class="modal-copy">Calculated directly by Spring Airlines. Confirmation submits and pays the change request from the agency wallet.</p><section class="summary-selection"><h3>Selected passengers</h3><p>${passengers.join(' &middot; ')}</p></section><section class="comparison-list">${comparisons}</section><section class="fee-summary"><div><span>Airline change fee</span><b>${display('changeFee')}</b></div><div><span>Fare difference</span><b>${display('fareDifference')}</b></div>${gateway}<div class="fee-total"><span>Additional payment</span><strong>${display('additionalPayment')}</strong></div></section><div class="booking-detail-actions"><button type="button" class="secondary back-booking">Back</button><button type="button" class="primary confirm-change">Confirm &amp; pay change fee</button></div></section>`;
      modal.querySelector('.booking-close').addEventListener('click', () => modal.close());
      modal.querySelector('.back-booking').addEventListener('click', () => showChangeFlow(modal, booking));
      modal.querySelector('.confirm-change').addEventListener('click', async confirmEvent => {
        const button = confirmEvent.currentTarget;
        button.disabled = true;
        button.textContent = 'Confirming payment…';
        try {
          const submitResponse = await secureFetch(`/api/bookings/${encodeURIComponent(booking.ref)}/change-pay`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appId: quote.appId, amountCny: Number(cny.additionalPayment || 0), changes })
          });
          const submitData = await submitResponse.json();
          if (!submitResponse.ok) throw new Error(submitData.error || 'Spring change payment failed.');
          const updated = submitData.booking ? portalBookingFromRow(submitData.booking) : null;
          if (updated) {
            const currentIndex = bookings.findIndex(item => item.ref === updated.ref);
            if (currentIndex >= 0) bookings.splice(currentIndex, 1, updated); else bookings.unshift(updated);
            renderBookings();
          }
          modal.close();
          toast(submitData.paymentRequired === false ? `Spring change request submitted for ${booking.ref}.` : `Spring change payment completed for ${booking.ref}.`);
          if (updated) openBookingDetail(updated.ref); else showView('bookings');
        } catch (error) {
          button.disabled = false;
          button.textContent = 'Confirm & pay change fee';
          toast(error.message || 'Spring change payment failed.');
        }
      });
    } catch (error) {
      calculate.disabled = false;
      calculate.textContent = 'Calculate change';
      toast(error.message || 'Spring change calculation failed.');
    }
  });
};
const showNoShowFlow = (modal, booking) => {
  const legs = bookingLegs(booking).filter(leg => !leg.flown && !leg.allNoShow);
  if (!legs.length) return toast('There are no active flights available for no-show recording.');
  modal.innerHTML = `<section class="booking-detail"><button class="close booking-close" type="button" aria-label="Close">&times;</button><p class="eyebrow">RECORD NO-SHOW</p><h2>Select flights and passengers</h2><p class="modal-copy">Record a no-show only after confirming the passenger did not board. This is an internal portal status until Spring no-show synchronisation is enabled.</p><section class="selection-group"><h3>Flights</h3><section class="flight-choice-list">${legs.map(leg => flightChoice(leg, 'no-show', false)).join('')}</section></section><section class="selection-group"><h3>Passengers</h3><section class="passenger-choice-list">${passengerChoices(booking, 'no-show', { checked: false, disableNoShow: false })}</section></section><p class="booking-warning">A recorded no-show cannot be changed or cancelled from this portal until it is reviewed by an office manager.</p><div class="booking-detail-actions"><button type="button" class="secondary back-booking">Back</button><button type="button" class="primary confirm-no-show">Record no-show</button></div></section>`;
  modal.querySelector('.booking-close').addEventListener('click', () => modal.close());
  modal.querySelector('.back-booking').addEventListener('click', () => openBookingDetail(booking.ref));
  modal.querySelector('.confirm-no-show').addEventListener('click', async event => {
    const selectedLegs = [...modal.querySelectorAll('[name="no-show-leg"]:checked')].map(input => input.value);
    const passengerIndexes = [...modal.querySelectorAll('[name="no-show-passenger"]:checked')].map(input => Number(input.value));
    if (!selectedLegs.length || !passengerIndexes.length) return toast('Select at least one flight and one passenger.');
    event.currentTarget.disabled = true;
    try {
      await updatePortalBookingStatus(booking.ref, 'no-show', { legs: selectedLegs, passengerIndexes });
      openBookingDetail(booking.ref);
      toast(`No-show recorded for ${booking.ref}.`);
    } catch (error) { event.currentTarget.disabled = false; toast(error.message); }
  });
};
document.addEventListener('click', event => { const button = event.target.closest('.view-booking'); if (button) openBookingDetail(button.dataset.bookingRef); });
document.querySelector('#ledger').innerHTML = '<tr><td colspan="6" class="no-bookings">No wallet transactions yet.</td></tr>';
const showView = id => { resetFlightSearchFlow(); document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id)); document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===id)); document.querySelector('main > header').hidden = id === 'bookings'; document.querySelector('#page-title').textContent = id==='dashboard' ? 'Good morning, Bayar' : id==='search' ? 'Flight search' : id[0].toUpperCase()+id.slice(1); window.scrollTo({top:0,behavior:'smooth'}); };
document.querySelectorAll('[data-view], [data-view-target]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view || btn.dataset.viewTarget)));
const formatMinutes = minutes => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const resultArea = document.querySelector('#flight-results');
let tripType = 'round'; let visibleFlights = []; let searchPhase = 'outbound'; let selectedOutbound = null; let selectedReturn = null; let roundReturnFlights = [];
let activePassengerCounts = { adults: 1, children: 0, infants: 0 };
let passengerSearchStale = false;
const resetFlightSearchFlow = () => {
  document.body.classList.remove('booking-mode');
  resultArea.classList.add('hidden');
  resultArea.innerHTML = '';
  visibleFlights = [];
  searchPhase = 'outbound';
  selectedOutbound = null;
  selectedReturn = null;
  roundReturnFlights = [];
  passengerSearchStale = false;
  document.querySelectorAll('.header-booking-route').forEach(route => route.remove());
  const title = document.querySelector('#page-title');
  if (title) title.hidden = false;
};
const passengerCounts = () => ({
  adults: Math.max(1, Number(document.querySelector('#adults')?.value) || 1),
  children: Math.max(0, Number(document.querySelector('#children')?.value) || 0),
  infants: Math.max(0, Number(document.querySelector('#infants')?.value) || 0)
});
const hasUnpricedPassengers = counts => counts.children > 0 || counts.infants > 0;
const priceText = price => price ? quoteMnt(price) : 'Price unavailable';
const SPRING_AIRLINES_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Spring_Airlines_Logo.png';
const airlineLogoUrl = (airline, suppliedLogo) => suppliedLogo || (/spring/i.test(String(airline || '')) ? SPRING_AIRLINES_LOGO : null);
const airlineLogo = (airline, suppliedLogo, alt = '') => { const logo = airlineLogoUrl(airline, suppliedLogo); return logo ? `<img src="${logo}" alt="${alt}" onerror="this.remove()" />` : '✈'; };
const timeText = flight => `${(flight.departure.time || '').slice(-5)} ${flight.departure.id || ''} → ${(flight.arrival.time || '').slice(-5)} ${flight.arrival.id || ''}`;
const flightCard = (flight, label, { showPrice = true, phase = null } = {}) => {
  const date = phase ? fareSelectionDate(phase) : '';
  const flightNumber = flight.number || '—';
  const route = `${flight.departure?.id || ''} → ${flight.arrival?.id || ''}`;
  const times = `Departure ${(flight.departure?.time || '').slice(-5)} · Arrival ${(flight.arrival?.time || '').slice(-5)}`;
  const duration = formatMinutes(flight.duration || 0);
  const stops = flight.stops ? `${flight.stops} stop${flight.stops > 1 ? 's' : ''}` : 'Nonstop';
  return `<article class="selection-card"><div class="selection-label">${label}</div><div class="selection-main ${showPrice ? '' : 'without-price'}"><div class="selection-carrier"><i class="selection-airline-logo">${airlineLogo(flight.airline, flight.logo, `${flight.airline || 'Airline'} logo`)}</i><div><strong>${flight.airline}</strong><span>Flight <b>${flightNumber}</b></span></div></div><div class="selection-schedule"><strong>${route}</strong>${date ? `<span class="selection-date">${date}</span>` : ''}<span class="selection-times">${times}</span></div><div class="selection-duration"><b>${duration}</b><span>${stops}</span></div>${showPrice ? `<b>${priceText(flight.price)}</b>` : ''}</div></article>`;
};
const fareSelectionDate = phase => {
  const value = fareDateForPhase(phase);
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};
const fareSelectionFlight = (flight, label, phase) => flightCard(flight, label, { showPrice: false, phase });
const selectedOutboundPanel = () => selectedOutbound ? `<section class="selected-itinerary"><div class="selected-title"><span>✓</span><div><h2>Outbound flight selected</h2><p>Select your return flight below.</p></div></div>${flightCard(selectedOutbound, 'OUTBOUND', { showPrice: false, phase: 'outbound' })}</section>` : '';
const totalPrice = () => {
  const numbers = [selectedOutbound, selectedReturn].map(f => cnyAmount(f?.price)).filter(Number.isFinite);
  if (!numbers.length) return 'Price unavailable';
  const adultTotal = numbers.reduce((sum, value) => sum + value, 0) * activePassengerCounts.adults;
  return quoteMnt(adultTotal);
};
const airportNames = { ULN: 'Chinggis Khaan International Airport', PVG: 'Shanghai Pudong International Airport', SHA: 'Shanghai Hongqiao International Airport', PEK: 'Beijing Capital International Airport', PKX: 'Beijing Daxing International Airport', HKG: 'Hong Kong International Airport', NRT: 'Tokyo Narita International Airport', ICN: 'Seoul Incheon International Airport' };
const mockFlight = (departure, arrival, number, departureTime, arrivalTime, price, airline = 'Spring') => ({ airline, number, duration: 250, stops: 0, price: String(price), departure: { id: departure, time: departureTime, name: airportNames[departure] || `${departure} Airport` }, arrival: { id: arrival, time: arrivalTime, name: airportNames[arrival] || `${arrival} Airport` }, segments: [{ airline, number, duration: 250, departure: { id: departure, time: departureTime, name: airportNames[departure] || `${departure} Airport` }, arrival: { id: arrival, time: arrivalTime, name: airportNames[arrival] || `${arrival} Airport` }, airplane: 'Airbus A320', travelClass: 'Economy' }] });
const mockSearchResults = (departure, arrival) => [mockFlight(departure, arrival, '9C 7058', '13:00', '17:00', 2095), mockFlight(departure, arrival, '9C 7012', '08:10', '12:05', 2360), mockFlight(departure, arrival, '9C 7026', '18:30', '22:30', 2580)];
const showMockSearch = (departure, arrival) => { const outbound = mockSearchResults(departure, arrival); if (tripType === 'round') { const returns = [mockFlight(arrival, departure, '9C 7057', '08:10', '12:00', 1960), mockFlight(arrival, departure, '9C 7011', '14:15', '18:05', 2150), mockFlight(arrival, departure, '9C 7025', '19:20', '23:15', 2290)]; renderRoundPairs(outbound.map((flight, index) => ({ outbound: flight, returnFlight: returns[index], sameAirline: true }))); } else renderFlights(outbound, 'outbound'); };
const showItinerary = () => { resultArea.classList.remove('hidden'); resultArea.innerHTML = `<section class="final-itinerary"><div class="selected-title"><span>✓</span><div><p class="eyebrow">ROUND TRIP SELECTED</p><h2>Your selected itinerary</h2></div></div>${flightCard(selectedOutbound, 'OUTBOUND')} ${flightCard(selectedReturn, 'RETURN')}<div class="fare-total"><span>${passengerFareCaption()} · selected flights</span><strong>${totalPrice()}</strong></div><button class="primary continue-ticket">Continue to passenger details</button></section>`; document.querySelector('.continue-ticket').addEventListener('click', () => { document.querySelector('#ticket-modal-total').textContent = totalPrice(); document.querySelector('#ticket-modal').showModal(); }); };
const checkoutFlight = (flight, label) => flight ? `<article class="checkout-flight"><div><span class="journey-tag ${label.toLowerCase()}">${label}</span><b>${flight.airline || 'Airline'} ${flight.number || ''}</b></div><div class="checkout-times"><strong>${(flight.departure?.time || '').slice(-5)}</strong><i></i><strong>${(flight.arrival?.time || '').slice(-5)}</strong></div><div class="checkout-airports"><span>${flight.departure?.name || flight.departure?.id || ''} (${flight.departure?.id || ''})</span><span>${flight.arrival?.name || flight.arrival?.id || ''} (${flight.arrival?.id || ''})</span></div></article>` : '';
const monthOptions = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthNumber = value => {
  const raw = String(value || '').trim().toLowerCase();
  if (/^\d{1,2}$/.test(raw)) return Number(raw) >= 1 && Number(raw) <= 12 ? Number(raw) : 0;
  return monthOptions.findIndex(month => month.toLowerCase() === raw.slice(0, 3)) + 1;
};
const splitDateField = (label, name) => `<label class="split-date-field">${label}<span class="split-date-control"><input type="text" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="DD" aria-label="Day" data-date-part="day" /><input type="text" list="month-options" autocomplete="off" placeholder="Mon" aria-label="Month" data-date-part="month" /><input type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="YYYY" aria-label="Year" data-date-part="year" /><input type="hidden" name="${name}" required /></span></label>`;
const passengerForm = (type, index) => `<section class="passenger-card" data-passenger-type="${type}"><div class="passenger-card-title"><h2>${index + 1} ${type}</h2></div><div class="passenger-fields"><label>Last name (surname)<input name="last-name" required placeholder="As shown on document" /></label><label>First name (given names)<input name="first-name" required placeholder="First and middle names" /></label>${splitDateField('Date of birth', 'date-of-birth')}<label>Document type<select name="document-type"><option>Passport</option><option>National ID</option></select></label><label>Document number<input name="document-number" required /></label><label>Issuing country / region<input name="issuing-country" required placeholder="e.g. Mongolia" /></label>${splitDateField('Document expiry', 'document-expiry')}<label>Nationality / region<input name="nationality" required placeholder="e.g. Mongolia" /></label><label>Gender<select name="gender" required><option value="">Select</option><option>Male</option><option>Female</option></select></label></div></section>`;
const selectedReviewFares = () => {
  const flights = [selectedOutbound, selectedReturn].filter(Boolean);
  const adults = activePassengerCounts.adults;
  const fare = flights.reduce((sum, flight) => sum + cnyAmount(flight?.fare?.baseFare ?? flight?.price), 0) * adults;
  const taxes = flights.reduce((sum, flight) => sum + cnyAmount(flight?.fare?.taxes ?? 0), 0) * adults;
  const total = flights.reduce((sum, flight) => sum + cnyAmount(flight?.fare?.total ?? flight?.price), 0) * adults;
  return { fare, taxes, total };
};
const reviewAirportName = airport => airport?.name || airportNames[airport?.id] || `${airport?.id || ''} Airport`;
const reviewFlight = (flight, date) => {
  if (!flight) return '';
  const first = flight.segments?.[0] || flight;
  const last = flight.segments?.at(-1) || flight;
  const aircraft = [first.airplane, first.travelClass].filter(Boolean).join(' · ');
  return `<article class="review-flight"><div class="review-airline-logo">${airlineLogo(flight.airline, flight.airlineLogo, `${flight.airline || 'Airline'} logo`)}</div><div class="review-flight-copy"><div class="review-flight-route"><span>${flight.departure?.id || ''} → ${flight.arrival?.id || ''}</span><span class="route-separator"></span><small>${date || ''}</small><small>${(flight.departure?.time || '').slice(-5)} – ${(flight.arrival?.time || '').slice(-5)}</small><small>${flight.stops ? `${flight.stops} stop${flight.stops > 1 ? 's' : ''}` : 'Nonstop'}</small></div><div class="review-flight-detail"><div class="review-times"><span>${(first.departure?.time || '').slice(-5)}</span><span>${(last.arrival?.time || '').slice(-5)}</span></div><div class="review-airport-line"><b>${first.departure?.id || ''} ${reviewAirportName(first.departure)}</b><span>${first.airline || flight.airline || 'Airline'} ${first.number || flight.number || 'Flight'} · ${aircraft || 'Economy'}</span><b>${last.arrival?.id || ''} ${reviewAirportName(last.arrival)}</b></div></div><div class="review-meta"><span>${flight.airline || 'Airline'}</span><span>${flight.number || 'Flight'}</span><span>${formatMinutes(flight.duration || first.duration || 0)}</span></div></div></article>`;
};
const baggageSummary = () => {
  const outbound = selectedOutbound?.fare?.baggage || (selectedOutbound?.segments?.[0] || selectedOutbound)?.baggage || {};
  const inbound = selectedReturn?.fare?.baggage || (selectedReturn?.segments?.[0] || selectedReturn)?.baggage || null;
  const hasValue = value => value !== null && value !== undefined && value !== '';
  const regularRows = baggage => {
    const rows = [];
    if (hasValue(baggage.personalItem)) rows.push(['Personal item', baggage.personalItem === true ? 'Included' : String(baggage.personalItem)]);
    if (hasValue(baggage.cabinKg)) rows.push(['Carry-on baggage', `1 × ${baggage.cabinKg} kg`]);
    if (hasValue(baggage.checkedKg)) rows.push(['Checked baggage', `1 × ${baggage.checkedKg} kg included`]);
    return rows;
  };
  let rows = regularRows(outbound);
  if (inbound) {
    const rowsForAllowance = (label, field, missing) => {
      const same = outbound[field] === inbound[field];
      if (same) return hasValue(outbound[field]) ? [[label, `1 × ${outbound[field]} kg${field === 'checkedKg' ? ' included' : ''}`]] : [];
      const display = (name, baggage) => [`${name} · ${label}`, hasValue(baggage[field]) ? `1 × ${baggage[field]} kg${field === 'checkedKg' ? ' included' : ''}` : missing];
      return [display('Departure', outbound), display('Return', inbound)];
    };
    rows = [
      ...(hasValue(outbound.personalItem) ? [['Personal item', outbound.personalItem === true ? 'Included' : String(outbound.personalItem)]] : []),
      ...rowsForAllowance('Carry-on baggage', 'cabinKg', 'Not provided'),
      ...rowsForAllowance('Checked baggage', 'checkedKg', 'Not included')
    ];
  }
  if (!rows.length) return '';
  return `<section class="price-section"><div class="price-section-heading"><span>Baggage</span></div><div class="baggage-list">${rows.map(([name, value]) => `<button type="button" class="selected-fare-details"><span>${name}</span><span>${value}</span></button>`).join('')}</div></section>`;
};
const checkoutPricePanel = () => {
  const fares = selectedReviewFares();
  const people = passengerTotal();
  const childNote = hasUnpricedPassengers(activePassengerCounts) ? '<div class="price-line"><span>Children / infants</span><b>Verified before issue</b></div>' : '';
  return `<aside class="order-summary booking-price-panel"><h2>Price details</h2><section class="price-section"><div class="price-section-heading"><span>Tickets (${people} passenger${people === 1 ? '' : 's'})</span><strong>${totalPrice()}</strong></div><p class="price-passenger-note">${activePassengerCounts.adults} adult${activePassengerCounts.adults === 1 ? '' : 's'} · ${selectedReturn ? 'round trip' : 'one way'}</p><div class="price-line"><span>Fare</span><b>${Number.isFinite(fares.fare) ? quoteMnt(fares.fare) : 'To be confirmed'}</b></div><div class="price-line"><span>Taxes & fees</span><b>${Number.isFinite(fares.taxes) ? quoteMnt(fares.taxes) : 'To be confirmed'}</b></div>${childNote}</section>${baggageSummary()}<div class="price-total"><span>Total</span><strong>${totalPrice()}</strong></div><p class="price-panel-note">Final fare, taxes and baggage allowance are confirmed before ticket issuance.</p></aside>`;
};
const showCheckout = () => { const counts = [['Adult', Number(document.querySelector('#adults').value)], ['Child', Number(document.querySelector('#children').value)], ['Infant', Number(document.querySelector('#infants').value)]]; const passengers = counts.flatMap(([type, count]) => Array.from({ length: count }, (_, index) => passengerForm(type, index))); const outboundDate = document.querySelector('#outbound-date')?.value || ''; const returnDate = document.querySelector('#return-date')?.value || ''; const destination = selectedOutbound?.arrival?.id || 'your destination'; resultArea.classList.remove('hidden'); resultArea.innerHTML = `<section class="booking-review"><div class="checkout-main"><div class="review-heading"><div><p class="eyebrow">SELECTED ITINERARY</p><h1>Trip to ${destination}</h1></div><button type="button" class="review-change-flight">Change flight</button></div><section class="review-itinerary">${reviewFlight(selectedOutbound, outboundDate)}${reviewFlight(selectedReturn, returnDate)}</section><div class="checkout-heading"><p class="eyebrow">WHO'S TRAVELING?</p><h2>Passenger details</h2><p>Names must match the travel document exactly.</p></div><form id="passenger-form" novalidate>${passengers.join('')}<datalist id="month-options">${monthOptions.map(month => `<option value="${month}"></option>`).join('')}</datalist><section class="contact-card"><h2>Contact person</h2><div class="passenger-fields"><label>Full name<input name="contact-name" required /></label><label>Contact number<span class="phone-input"><input name="contact-country-code" list="phone-country-codes" value="+976" inputmode="tel" required aria-label="Country calling code" /><input name="contact-phone" type="tel" inputmode="tel" required placeholder="Phone number" aria-label="Phone number" /></span></label><label>Email address<input name="contact-email" type="email" required /></label></div><datalist id="phone-country-codes"><option value="+976" label="Mongolia"></option><option value="+86" label="China"></option><option value="+7" label="Russia / Kazakhstan"></option><option value="+82" label="South Korea"></option><option value="+81" label="Japan"></option><option value="+66" label="Thailand"></option><option value="+84" label="Vietnam"></option><option value="+65" label="Singapore"></option><option value="+60" label="Malaysia"></option><option value="+971" label="United Arab Emirates"></option><option value="+90" label="Turkey"></option><option value="+49" label="Germany"></option><option value="+44" label="United Kingdom"></option><option value="+1" label="United States / Canada"></option></datalist><p>Booking confirmation and schedule changes will be sent to this contact.</p></section><div class="booking-actions"><button type="button" class="back-to-search">← Back to search</button><button class="primary issue-ticket" type="submit">Book</button></div></form></div>${checkoutPricePanel()}</section>`; const checkoutForm = document.querySelector('#passenger-form'); checkoutForm.addEventListener('submit', createPortalBookingFromForm); checkoutForm.querySelector('.issue-ticket')?.addEventListener('click', event => { event.preventDefault(); createPortalBookingFromForm({ preventDefault() {}, currentTarget: checkoutForm }); }); document.querySelector('.review-change-flight')?.addEventListener('click', () => document.querySelector('.back-to-search')?.click()); document.querySelectorAll('.selected-fare-details').forEach(button => button.addEventListener('click', showSelectedFareDetails)); bindCountryFields(); enhanceCountryMenus(); resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
document.addEventListener('click', event => { if (event.target.closest('.select-round-pair')) showCheckout(); });
document.addEventListener('click', event => { if (!event.target.closest('.review-change-flight')) return; document.body.classList.remove('booking-mode'); resultArea.classList.add('hidden'); resultArea.innerHTML = ''; selectedOutbound = null; selectedReturn = null; document.querySelector('#search')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
const airportCode = value => value.match(/\(([A-Z]{3})\)/i)?.[1] || value.trim().toUpperCase();
const showToast = message => toast(message);
const collapseCountryFields = () => { document.querySelectorAll('.passenger-card').forEach(card => { const labels = [...card.querySelectorAll('label')]; const issuing = labels.find(label => label.textContent.includes('Issuing country')); const nationality = labels.find(label => label.textContent.includes('Nationality')); const visible = nationality?.querySelector('input:not([type="hidden"])'); if (!issuing || !nationality || !visible) return; let hidden = nationality.querySelector('input[type="hidden"][name="issuing-country"]'); if (!hidden) { hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = 'issuing-country'; nationality.append(hidden); visible.addEventListener('input', () => { hidden.value = visible.value; }); visible.addEventListener('change', () => { hidden.value = visible.value; }); } const textNode = [...nationality.childNodes].find(node => node.nodeType === Node.TEXT_NODE); if (textNode) textNode.textContent = 'Nationality (country/region)'; hidden.value = visible.value; issuing.remove(); }); };
new MutationObserver(collapseCountryFields).observe(resultArea, { childList: true, subtree: true });
const combineCountryNationality = () => { document.querySelectorAll('.passenger-card').forEach(card => { const labels = [...card.querySelectorAll('label')]; const issuing = labels.find(label => label.textContent.includes('Issuing country')); const nationality = labels.find(label => label.textContent.includes('Nationality')); if (!issuing || !nationality) return; issuing.hidden = true; const textNode = [...nationality.childNodes].find(node => node.nodeType === Node.TEXT_NODE); if (textNode) textNode.textContent = 'Nationality (country/region)'; }); };
document.addEventListener('click', event => { if (event.target.closest('.select-round-pair') || (event.target.closest('.book-flight') && tripType !== 'round')) setTimeout(combineCountryNationality, 0); });
const allCountryNames = () => { const codes = 'AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW XK'.split(' '); const names = new Intl.DisplayNames(['en'], { type: 'region' }); return [...new Set(codes.map(code => names.of(code)).filter(name => name && name.length > 2))].sort((a, b) => a.localeCompare(b)); };
const enhanceCountryMenus = () => { const countries = allCountryNames(); const render = (menu, query) => { const matches = countries.filter(country => country.toLowerCase().includes(query.toLowerCase())); let letter = ''; menu.innerHTML = matches.map(country => { const first = country[0].toUpperCase(); const heading = first === letter ? '' : `<div class="country-letter">${first}</div>`; letter = first; return `${heading}<button type="button" data-country="${country}">${country}</button>`; }).join('') || '<div class="country-letter">No matching country</div>'; }; document.querySelectorAll('.passenger-card').forEach(card => { const labels = [...card.querySelectorAll('label')]; ['Issuing country', 'Nationality'].forEach(text => { const label = labels.find(item => item.textContent.includes(text)); const input = label?.querySelector('input'); if (!label || !input || input.dataset.countryMenuBound) return; input.removeAttribute('list'); input.dataset.countryMenuBound = 'true'; const menu = document.createElement('div'); menu.className = 'country-menu'; menu.hidden = true; label.append(menu); const open = () => { render(menu, input.value); menu.hidden = false; }; input.addEventListener('focus', open); input.addEventListener('input', open); menu.addEventListener('click', event => { const option = event.target.closest('[data-country]'); if (!option) return; input.value = option.dataset.country; input.dispatchEvent(new Event('change')); menu.hidden = true; }); document.addEventListener('click', event => { if (!label.contains(event.target)) menu.hidden = true; }); }); }); };
const normalizeCountryEntry = value => {
  const query = String(value || '').trim().toLowerCase();
  if (!query) return '';
  const countries = allCountryNames();
  const exact = countries.find(country => country.toLowerCase() === query);
  if (exact) return exact;
  const matches = countries.filter(country => country.toLowerCase().startsWith(query));
  return matches.length === 1 ? matches[0] : String(value || '').trim();
};
document.addEventListener('focusout', event => {
  const input = event.target.matches('.passenger-card input[name="nationality"], .passenger-card input[name="issuing-country"]') ? event.target : null;
  if (!input) return;
  const normalized = normalizeCountryEntry(input.value);
  if (normalized && normalized !== input.value) {
    input.value = normalized;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
document.addEventListener('click', event => { if (event.target.closest('.select-round-pair') || (event.target.closest('.book-flight') && tripType !== 'round')) queueMicrotask(bindCountryFields); });
document.addEventListener('click', event => { if (event.target.closest('.select-round-pair') || (event.target.closest('.book-flight') && tripType !== 'round')) setTimeout(enhanceCountryMenus, 0); });
const countryNames = ['Mongolia','Russia','China','Japan','South Korea','North Korea','Kazakhstan','United States','United Kingdom','Germany','France','Turkey','Thailand','Singapore','Vietnam','India','Australia','Canada'];
const bindCountryFields = () => { let list = document.querySelector('#country-options'); if (!list) { list = document.createElement('datalist'); list.id = 'country-options'; list.innerHTML = countryNames.map(country => `<option value="${country}"></option>`).join(''); document.body.append(list); } const correctCountry = value => { const query = value.trim().toLowerCase(); return countryNames.find(country => country.toLowerCase().startsWith(query) || query.startsWith(country.toLowerCase())) || value.trim(); }; document.querySelectorAll('.passenger-card').forEach(card => { const labels = [...card.querySelectorAll('label')]; const issuing = labels.find(label => label.textContent.includes('Issuing country'))?.querySelector('input'); const nationality = labels.find(label => label.textContent.includes('Nationality'))?.querySelector('input'); if (!issuing || !nationality || issuing.dataset.countryBound) return; [issuing, nationality].forEach(input => { input.setAttribute('list', 'country-options'); input.setAttribute('autocomplete', 'off'); input.dataset.countryBound = 'true'; }); const mirror = (source, target) => { const country = correctCountry(source.value); if (country) { source.value = country; target.value = country; } }; issuing.addEventListener('change', () => mirror(issuing, nationality)); issuing.addEventListener('blur', () => mirror(issuing, nationality)); nationality.addEventListener('change', () => mirror(nationality, issuing)); nationality.addEventListener('blur', () => mirror(nationality, issuing)); }); };
const prepareBookingScreen = () => { showCheckout(); queueMicrotask(() => { openBookingScreen(); const route = document.querySelector('.booking-route'); const headerContent = document.querySelector('main > header > div'); const title = document.querySelector('#page-title'); if (!route) return; if (!route.querySelector('.back-to-search')) route.insertAdjacentHTML('beforeend', '<button type="button" class="back-to-search">← Back to search</button>'); if (headerContent) { title.hidden = true; route.classList.add('header-booking-route'); headerContent.append(route); } const back = route.querySelector('.back-to-search'); const payment = document.querySelector('.issue-ticket'); if (back && payment && !document.querySelector('.booking-actions')) { const actions = document.createElement('div'); actions.className = 'booking-actions'; payment.before(actions); actions.append(back, payment); } }); };
const ensureDocsModal = () => { let modal = document.querySelector('#docs-modal'); if (modal) return modal; modal = document.createElement('dialog'); modal.id = 'docs-modal'; modal.innerHTML = `<form method="dialog" id="docs-form"><button class="close" value="cancel" aria-label="Close">×</button><h2>DOCS import</h2><p class="modal-copy">Paste passenger lines from Amadeus, Galileo, or Sabre. Passenger names will be copied into the form for review.</p><textarea id="docs-input" placeholder="Example: NM1BATBOLD/BAYAR MR&#10;or N.BATBOLD/BAYAR"></textarea><div class="docs-actions"><button value="cancel" class="secondary">Cancel</button><button class="primary" value="import">Import passengers</button></div></form>`; document.body.append(modal); modal.querySelector('form').addEventListener('submit', event => { event.preventDefault(); if (event.submitter?.value === 'cancel') return modal.close(); const names = modal.querySelector('#docs-input').value.split(/\r?\n/).map(line => line.match(/(?:NM\d*|N\.|-\d*)?\s*([A-Z][A-Z' -]+)\/([A-Z][A-Z' -]+)/i)).filter(Boolean).map(match => ({ last: match[1].trim(), first: match[2].replace(/\b(MR|MRS|MS|MISS|CHD|INF)\b/ig, '').trim() })); document.querySelectorAll('.passenger-card').forEach((card, index) => { const name = names[index]; const fields = card.querySelectorAll('input'); if (name && fields.length > 1) { fields[0].value = name.last; fields[1].value = name.first; } }); modal.close(); showToast(names.length ? `${names.length} passenger name(s) imported. Please review all details.` : 'No passenger names found. Check the DOCS format.'); }); return modal; };
const openBookingScreen = () => { document.body.classList.add('booking-mode'); };
document.addEventListener('click', event => { if (event.target.closest('.select-round-pair')) openBookingScreen(); if (event.target.closest('.docs-import')) ensureDocsModal().showModal(); if (event.target.closest('[data-view="search"]')) document.body.classList.remove('booking-mode'); });
document.addEventListener('click', event => { if (event.target.closest('.select-round-pair')) queueMicrotask(() => { const route = document.querySelector('.booking-route'); if (route && !route.querySelector('.back-to-search')) route.insertAdjacentHTML('beforeend', '<button type="button" class="back-to-search">← Back to search</button>'); }); if (event.target.closest('.back-to-search')) { resetFlightSearchFlow(); document.querySelector('#search').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
document.addEventListener('click', event => { if (event.target.closest('.select-round-pair')) queueMicrotask(() => { const route = document.querySelector('.booking-route'); const headerContent = document.querySelector('main > header > div'); const title = document.querySelector('#page-title'); if (route && headerContent) { title.hidden = true; route.classList.add('header-booking-route'); headerContent.append(route); } }); if (event.target.closest('.back-to-search') || event.target.closest('[data-view="search"]')) document.querySelector('#page-title').hidden = false; });
document.addEventListener('click', event => { if (!event.target.closest('.select-round-pair')) return; queueMicrotask(() => { const back = document.querySelector('.back-to-search'); const payment = document.querySelector('.issue-ticket'); if (!back || !payment || document.querySelector('.booking-actions')) return; const actions = document.createElement('div'); actions.className = 'booking-actions'; payment.before(actions); actions.append(back, payment); }); });
document.addEventListener('click', event => { if (event.target.closest('.back-to-search') || event.target.closest('[data-view="search"]')) document.querySelectorAll('.header-booking-route').forEach(route => route.remove()); });
const returnSearchQuery = flight => new URLSearchParams({ departureToken: flight.departureToken, airline: flight.airlineCode || '', departure: airportCode(document.querySelector('#departure').value), arrival: airportCode(document.querySelector('#arrival').value), date: document.querySelector('#outbound-date').value, returnDate: document.querySelector('#return-date').value, adults: document.querySelector('#adults').value, children: document.querySelector('#children').value, infants: document.querySelector('#infants').value });
const getReturnFlights = async flight => { if (!flight.departureToken) return null; const response = await fetch(`/api/flights?${returnSearchQuery(flight)}`); const data = await response.json(); return response.ok && data.results?.length ? { flight: data.results[0], sameAirline: data.sameAirline } : null; };
const connectionDuration = (arrivalTime, departureTime) => { const toMinutes = value => { const matched = String(value || '').match(/(\d{1,2}):(\d{2})/); return matched ? Number(matched[1]) * 60 + Number(matched[2]) : null; }; const arrival = toMinutes(arrivalTime); const departure = toMinutes(departureTime); if (arrival === null || departure === null) return 'Connection'; const wait = (departure - arrival + 1440) % 1440; return wait ? `Connection · ${formatMinutes(wait)} layover` : 'Connection'; };
const terminalText = airport => { const terminal = String(airport?.terminal || airport?.airportTerminal || '').trim(); return terminal ? (/^terminal\b/i.test(terminal) ? terminal : `Terminal ${terminal}`) : ''; };
const airportText = airport => [airport?.name || '', terminalText(airport)].filter(Boolean).join(' · ');
const segmentDetail = (flight, detailId) => { const segments = flight.segments?.length ? flight.segments : [flight]; const first = segments[0]; const last = segments.at(-1); const baggageText = baggage => { const items = []; if (baggage?.checkedKg !== null && baggage?.checkedKg !== undefined) items.push(`Checked baggage: ${baggage.checkedKg} kg`); if (baggage?.cabinKg !== null && baggage?.cabinKg !== undefined) items.push(`Cabin baggage: ${baggage.cabinKg} kg${baggage.cabinSize ? ` · ${baggage.cabinSize} cm` : ''}`); return `<div class="segment-baggage"><strong>Baggage allowance</strong><span>${items.length ? items.join(' · ') : 'Not provided for this fare.'}</span></div>`; }; return `<div id="${detailId}" class="segment-details" hidden><div class="detail-route"><strong>${first.departure?.id || ''} <i>→</i> ${last.arrival?.id || ''}</strong><span>${segments.length > 1 ? `${segments.length - 1} connection${segments.length > 2 ? 's' : ''}` : 'Direct flight'}</span></div>${segments.map((segment, index) => `<div class="segment-detail"><div class="segment-carrier"><i>${airlineLogo(segment.airline || flight.airline, segment.airlineLogo || flight.airlineLogo)}</i><span>${segment.airline || flight.airline} · ${segment.number || 'Flight'}</span></div><div class="segment-point"><small>DEPARTURE</small><strong>${(segment.departure?.time || '').slice(-5)} <em>${segment.departure?.id || ''}</em></strong><span>${airportText(segment.departure)}</span></div><div class="segment-line"><b>${segment.duration ? formatMinutes(segment.duration) : 'Flight'}</b><i></i><span>Nonstop</span></div><div class="segment-point"><small>ARRIVAL</small><strong>${(segment.arrival?.time || '').slice(-5)} <em>${segment.arrival?.id || ''}</em></strong><span>${airportText(segment.arrival)}</span></div><div class="segment-meta">${[segment.airplane, segment.travelClass].filter(Boolean).join(' · ') || 'Flight information'}</div>${baggageText(segment.baggage)}${index < segments.length - 1 ? `<div class="connection-note">${connectionDuration(segment.arrival?.time, segments[index + 1].departure?.time)}</div>` : ''}</div>`).join('')}</div>`; };
const searchRow = (flight, label, detailId) => `<div class="round-leg"><span>${label}</span><div class="round-airline"><i>${airlineLogo(flight.airline, flight.airlineLogo, `${flight.airline} logo`)}</i><div><strong>${flight.airline}</strong><small>${flight.number || 'Flight'} · ${timeText(flight)}</small></div></div><button type="button" class="segment-toggle" data-detail-id="${detailId}" aria-expanded="false" aria-label="Show flight details">⌄</button></div>${segmentDetail(flight, detailId)}`;
const pairTotal = pair => { const raw = [pair.outbound.price, pair.returnFlight.price]; if (raw.some(value => !String(value ?? '').match(/\d/))) return 'Price unavailable'; const values = raw.map(cnyAmount); if (!values.every(Number.isFinite)) return 'Price unavailable'; const adultTotal = values.reduce((a, b) => a + b, 0) * activePassengerCounts.adults; return quoteMnt(adultTotal); };
const passengerTotal = () => activePassengerCounts.adults + activePassengerCounts.children + activePassengerCounts.infants;
const passengerFareCaption = () => `Total · ${passengerTotal()} passenger${passengerTotal() === 1 ? '' : 's'}`;
const resultFare = price => {
  const adultTotal = cnyAmount(price) * activePassengerCounts.adults;
  return `<small>${passengerFareCaption()}</small><strong>${Number.isFinite(adultTotal) ? quoteMnt(adultTotal) : 'Price unavailable'}</strong><span>Details per passenger</span>`;
};
const renderRoundPairs = pairs => { resultArea.classList.remove('hidden'); resultArea.innerHTML = `<div class="results-head"><h2>Round trip combinations</h2><span>Departure and arrival flights shown together</span></div>${pairs.length ? pairs.map((pair, index) => `<article class="round-pair">${searchRow(pair.outbound, 'DEPARTURE', `departure-detail-${index}`)}${searchRow(pair.returnFlight, 'ARRIVAL', `arrival-detail-${index}`)}<div class="pair-footer"><span>${pair.sameAirline ? 'Same airline return' : 'Alternative airline return'}</span><strong>${pairTotal(pair)}</strong><button class="primary select-round-pair" data-pair-index="${index}">Select itinerary</button></div></article>`).join('') : '<div class="no-results">No return combinations were found for the first outbound options.</div>'}`; document.querySelectorAll('.segment-toggle').forEach(button => button.addEventListener('click', () => { const detail = document.querySelector(`#${button.dataset.detailId}`); const open = detail.hidden; detail.hidden = !open; button.textContent = open ? '⌃' : '⌄'; button.setAttribute('aria-expanded', String(open)); })); document.querySelectorAll('.select-round-pair').forEach(button => button.addEventListener('click', () => { if (passengerSearchStale) return toast('Search again after changing passenger count before selecting an itinerary.'); const pair = pairs[Number(button.dataset.pairIndex)]; selectedOutbound = pair.outbound; selectedReturn = pair.returnFlight; showItinerary(); })); };
const loadRoundPairs = async outboundFlights => { resultArea.classList.remove('hidden'); resultArea.innerHTML = '<div class="no-results"><strong>Building round trip combinations...</strong><br>Searching return flights for the best outbound options.</div>'; const shortlisted = outboundFlights.filter(flight => flight.departureToken).slice(0, 3); const resolved = await Promise.all(shortlisted.map(async outbound => { try { const returned = await getReturnFlights(outbound); return returned ? { outbound, returnFlight: returned.flight, sameAirline: returned.sameAirline } : null; } catch { return null; } })); renderRoundPairs(resolved.filter(Boolean)); };
const bindFlightButtons = () => document.querySelectorAll('.book-flight').forEach(b => b.addEventListener('click', () => selectFlight(visibleFlights[Number(b.dataset.index)])));
const renderFlights = (results, phase = 'outbound', sameAirline = true) => {
  visibleFlights = results; searchPhase = phase;
  resultArea.classList.remove('hidden');
  const flights = results.map((f, i) => `<article class="flight"><div class="carrier"><span class="plane">${airlineLogo(f.airline, f.airlineLogo, `${f.airline} logo`)}</span><div><strong>${f.airline}</strong><small>${f.number || 'Flight'} · Economy</small></div></div><div class="flight-time"><strong>${(f.departure.time || '').slice(-5)}</strong><span>${f.departure.id || ''}</span></div><div class="duration">${formatMinutes(f.duration || 0)} <i></i><small>${f.stops ? `${f.stops} stop${f.stops > 1 ? 's' : ''}` : 'Nonstop'}</small></div><div class="flight-time"><strong>${(f.arrival.time || '').slice(-5)}</strong><span>${f.arrival.id || ''}</span></div><div class="fare">${resultFare(f.price)}</div><button class="primary book-flight" data-index="${i}">Select</button></article>`).join('');
  const heading = phase === 'return' ? 'Choose return flight' : 'Choose outbound flight'; const note = phase === 'return' ? (sameAirline ? 'Same airline options' : 'Same airline unavailable · alternative airlines shown') : 'Live search · Spring Airlines';
  resultArea.innerHTML = `${phase === 'return' ? selectedOutboundPanel() : ''}<div class="results-head"><h2>${heading}</h2><span>${note}</span></div>${flights || '<div class="no-results">No flights found for this route and date.</div>'}`;
  bindFlightButtons();
};
const applyFareOption = (flight, fare) => {
  flight.fare = fare; flight.price = fare.total;
  flight.spring = { ...(flight.spring || {}), ...(fare.spring || {}), seatName: fare.fareType, seatPrice: fare.baseFare, taxes: fare.taxes, baggage: fare.baggage, fare };
  flight.segments = (flight.segments || []).map(segment => ({ ...segment, travelClass: fare.cabin || segment.travelClass, baggage: fare.baggage || segment.baggage, fare }));
  return flight;
};
const fareBaggageText = fare => {
  const baggage = fare?.baggage || {};
  const cabin = baggage.cabinKg === null || baggage.cabinKg === undefined ? 'Carry-on: confirm with airline' : `Carry-on: ${baggage.cabinKg} kg`;
  const checked = baggage.checkedKg === null || baggage.checkedKg === undefined ? 'Checked baggage: not included' : `Checked baggage: ${baggage.checkedKg} kg`;
  return `${cabin} · ${checked}`;
};
const ruleValueText = entry => {
  if (!entry || !Number.isFinite(Number(entry.value))) return 'Not provided';
  const value = Number(entry.value);
  return Number(entry.valueType) === 2 ? `${Math.round(value * 100)}% of applicable fare` : quoteMnt(value);
};
const ruleBoundaryHours = value => {
  const match = String(value || '').match(/^(-?)(\d+(?:\.\d+)?)([HD])$/i);
  if (!match) return null;
  return Number(match[2]) * (match[3].toUpperCase() === 'D' ? 24 : 1) * (match[1] === '-' ? -1 : 1);
};
const ruleWindowText = entry => {
  const start = ruleBoundaryHours(entry?.start); const end = ruleBoundaryHours(entry?.end);
  const before = hours => `${Math.abs(hours) % 24 === 0 ? Math.abs(hours) / 24 : Math.abs(hours)}${Math.abs(hours) % 24 === 0 ? ' day' : ' hour'}${Math.abs(hours) === 24 || Math.abs(hours) % 24 === 0 && Math.abs(hours) / 24 !== 1 ? 's' : ''} before departure`;
  if (start === null && end !== null && end < 0) return `More than ${before(end)}`;
  if (start !== null && end !== null && start < 0 && end <= 0) return `${before(start)} to ${end === 0 ? 'departure time' : before(end)}`;
  if (start !== null && start < 0 && end === null) return `Within ${before(start)}`;
  if (start === 0 && end === null) return 'After departure / no-show';
  return 'Applicable time window';
};
const fareDateForPhase = phase => document.querySelector(phase === 'return' ? '#return-date' : '#outbound-date')?.value;
const activeRuleEntry = (fare, type, date, time) => {
  const rule = (fare?.rules || []).find(item => Number(item.type) === type);
  const departure = new Date(`${date || ''}T${time || '00:00'}:00`);
  if (!rule || Number.isNaN(departure.getTime())) return null;
  const relativeHours = (Date.now() - departure.getTime()) / 3_600_000;
  return rule.entries.find(entry => {
    const start = ruleBoundaryHours(entry.start); const end = ruleBoundaryHours(entry.end);
    return (start === null || relativeHours >= start) && (end === null || relativeHours < end);
  }) || rule.entries[0] || null;
};
const fareRuleText = (fare, type, emptyText, date, time) => {
  const rule = (fare?.rules || []).find(item => Number(item.type) === type);
  const entry = activeRuleEntry(fare, type, date, time);
  if (!entry) return emptyText;
  return `${rule?.label}: ${ruleValueText(entry)} · ${ruleWindowText(entry)}`;
};
const fareDetailButton = (fare, phase) => `<button type="button" class="text-btn fare-rule-details" data-fare-phase="${phase}" data-fare-index="${fare.index}">Details</button>`;
let fareDetailsByBound = {};
const inlineFareBreakdown = ({ baseFare = 0, taxes = 0, total = 0 }) => {
  const counts = activePassengerCounts;
  const adultFare = baseFare * counts.adults;
  const adultTaxes = taxes * counts.adults;
  const adultTotal = total * counts.adults;
  const typeBlock = (label, count, fare, tax, isLiveOnly = false) => {
    if (!count) return '';
    if (isLiveOnly) return `<div class="fare-breakdown-row pending"><span>${label} × ${count}</span><b>Live verification required</b></div>`;
    return `<div class="fare-breakdown-row"><span><b>${label} × ${count}</b><small>Fare ${quoteMnt(fare)} · Taxes & fees ${quoteMnt(tax)}</small></span><b>${quoteMnt(total)}</b></div>`;
  };
  return `<div class="fare-price-breakdown"><span class="fare-breakdown-title">Price breakdown</span>${typeBlock('Adult', counts.adults, adultFare, adultTaxes)}${typeBlock('Child', counts.children, 0, 0, true)}${typeBlock('Infant', counts.infants, 0, 0, true)}<div class="fare-breakdown-total"><span>${passengerFareCaption()}</span><b>${quoteMnt(adultTotal)}</b></div></div>`;
};
const farePriceMarkup = (fare, multiplier = 1) => {
  const total = cnyAmount(fare?.total ?? fare?.price ?? 0) * multiplier;
  const adultTotal = total * activePassengerCounts.adults;
  return `<div class="fare-family-price"><span>${passengerFareCaption()}</span><b>${Number.isFinite(adultTotal) ? quoteMnt(adultTotal) : 'To be confirmed'}</b></div>`;
};
const fareBreakdownMarkup = (fare, multiplier = 1) => inlineFareBreakdown({
  baseFare: cnyAmount(fare?.baseFare ?? fare?.price ?? 0) * multiplier,
  taxes: cnyAmount(fare?.taxes ?? 0) * multiplier,
  total: cnyAmount(fare?.total ?? fare?.price ?? 0) * multiplier
});
const showFareRuleDetails = (fare, flight) => {
  let modal = document.querySelector('#fare-rule-modal');
  if (!modal) { modal = document.createElement('dialog'); modal.id = 'fare-rule-modal'; document.body.append(modal); }
  modal.className = 'fare-details-dialog';
  const baggage = baggageDetailMarkup(fare, flight, 'FLIGHT');
  const rules = `<h3 class="policy-title">Cancellation fee <small>Per adult ticket</small></h3>${fareRuleTable(fare, flight, 'FLIGHT', 1)}<h3 class="policy-title">Change fee <small>Per adult ticket</small></h3>${fareRuleTable(fare, flight, 'FLIGHT', 2)}`;
  modal.innerHTML = `<form method="dialog" class="fare-rule-modal round-fare-modal"><button class="close" value="cancel" aria-label="Close">×</button><p class="eyebrow">${fare?.fareType || fare?.bookingClass || 'FARE'} · ONE WAY</p><h2>Baggage allowance & fare policies</h2><p class="modal-copy">The highlighted row is the current time period for this flight. Fees are calculated per adult and may be confirmed again by the airline at ticket issue.</p><nav class="fare-detail-tabs"><button type="button" data-fare-tab="baggage" class="active">Baggage allowance</button><button type="button" data-fare-tab="rules">Cancellation & change policies</button></nav><div class="fare-detail-pane" data-fare-pane="baggage">${baggage}</div><div class="fare-detail-pane hidden" data-fare-pane="rules">${rules}</div><button class="primary" value="cancel">Close</button></form>`;
  modal.querySelectorAll('[data-fare-tab]').forEach(button => button.addEventListener('click', () => {
    const tab = button.dataset.fareTab;
    modal.querySelectorAll('[data-fare-tab]').forEach(item => item.classList.toggle('active', item === button));
    modal.querySelectorAll('[data-fare-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.farePane !== tab));
  }));
  modal.showModal();
};
const fareChoiceCard = (fare, index, phase, selected = false, flight = null, lowest = false) => {
  const date = fareDateForPhase(phase); const time = flight?.departure?.time || (phase === 'return' ? selectedReturn?.departure?.time : selectedOutbound?.departure?.time);
  return `<div class="fare-choice-item"><button type="button" class="fare-family-choice ${selected ? 'recommended' : ''}" data-fare-bound="${phase}" data-fare-index="${index}"><span class="fare-family-top"><b>${fare.fareType || fare.bookingClass || 'Economy'} class</b><i class="fare-radio" aria-hidden="true"></i></span><small>${fare.bookingClass ? `Booking class ${fare.bookingClass}` : fare.cabin || 'Economy'}</small>${lowest ? '<em class="fare-recommended">Lowest fare</em>' : ''}<hr><strong>Baggage</strong><p>${oneWayBaggageSummary(fare)}</p><strong>Flexibility</strong><p>Cancellation: ${oneWayFeeSummary(fare, 1, date, time)}<br>Change: ${oneWayFeeSummary(fare, 2, date, time)}</p>${farePriceMarkup(fare)}</button>${fareDetailButton({ index }, phase)}</div>`;
};
const bindFareCarousel = (screen, selections, onSelect) => {
  screen.querySelectorAll('[data-fare-bound]').forEach(card => card.addEventListener('click', () => {
    selections[card.dataset.fareBound] = Number(card.dataset.fareIndex); onSelect();
  }));
  screen.querySelectorAll('.fare-scroll').forEach(button => button.addEventListener('click', () => {
    const scroller = button.parentElement.querySelector('.fare-choice-grid');
    scroller.scrollBy({ left: (button.classList.contains('fare-scroll-back') ? -1 : 1) * Math.max(300, scroller.clientWidth * .8), behavior: 'smooth' });
  }));
  screen.querySelectorAll('.fare-rule-details').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const source = fareDetailsByBound[button.dataset.farePhase];
    if (source) showFareRuleDetails(source.fares[Number(button.dataset.fareIndex)], source.flight);
  }));
};
const continueWithFare = (flight, fare, phase) => {
  applyFareOption(flight, fare);
  if (phase === 'return') { selectedReturn = flight; return tripType === 'round' ? showRoundFareOptions() : prepareBookingScreen(); }
  selectedOutbound = flight;
  if (tripType !== 'round') { selectedReturn = null; return prepareBookingScreen(); }
  if (roundReturnFlights.length) return renderFlights(roundReturnFlights, 'return', true);
  resultArea.innerHTML = '<div class="no-results"><strong>Return flight is unavailable.</strong><br>Please search again or choose another outbound flight.</div>';
};
const showFareOptions = (flight, phase) => {
  const options = flight.fareOptions?.length ? flight.fareOptions : [flight.fare].filter(Boolean);
  if (options.length < 2) return continueWithFare(flight, options[0] || { total: flight.price, baseFare: flight.price, taxes: 0, fareType: 'Public fare', cabin: 'Economy' }, phase);
  const leg = phase === 'return' ? 'Return' : 'Departure';
  resultArea.classList.remove('hidden');
  const selections = { [phase]: 0 };
  fareDetailsByBound = { [phase]: { flight, fares: options } };
  const render = () => {
    const selectedFare = options[selections[phase]];
    resultArea.innerHTML = `<section class="fare-choice-screen"><header><p class="eyebrow">${leg.toUpperCase()} FLIGHT · FARE SELECTION</p><h2>Select your fare</h2><div class="fare-selected-flights one-way-fare-selection">${fareSelectionFlight(flight, leg, phase)}</div></header><div class="fare-carousel"><button type="button" class="fare-scroll fare-scroll-back" aria-label="Previous fares">‹</button><div class="fare-choice-grid">${options.map((fare, index) => fareChoiceCard(fare, index, phase, selections[phase] === index, flight, index === 0)).join('')}</div><button type="button" class="fare-scroll fare-scroll-next" aria-label="Next fares">›</button></div><footer class="fare-choice-footer"><div>${fareBreakdownMarkup(selectedFare)}</div><button class="primary confirm-single-fare">Continue to passenger details</button></footer></section>`;
    bindFareCarousel(resultArea, selections, render);
    resultArea.querySelector('.confirm-single-fare').addEventListener('click', () => continueWithFare(flight, options[selections[phase]], phase));
  };
  render();
};
const roundFareKey = fare => String(fare?.fareType || fare?.bookingClass || fare?.cabin || '').trim().toUpperCase();
const buildSharedRoundFares = (outboundOptions, returnOptions) => {
  if (!outboundOptions.length || !returnOptions.length) return [];
  const pairs = []; const added = new Set();
  const addPair = (outboundIndex, returnIndex) => {
    if (outboundIndex < 0 || returnIndex < 0) return;
    const id = `${outboundIndex}:${returnIndex}`;
    if (added.has(id)) return;
    const outbound = outboundOptions[outboundIndex]; const inbound = returnOptions[returnIndex];
    const outboundName = roundFareKey(outbound) || 'Economy'; const inboundName = roundFareKey(inbound) || 'Economy';
    added.add(id);
    pairs.push({
      outbound, inbound, outboundIndex, returnIndex,
      label: outboundName === inboundName ? outboundName : `${outboundName} + ${inboundName}`,
      subtitle: outboundName === inboundName ? 'Same fare family for departure and return' : `Departure ${outboundName} · Return ${inboundName}`
    });
  };
  // Always put the cheapest live fare on each bound together first, even when
  // Spring returns different booking classes (for example P outbound + R4 return).
  addPair(0, 0);
  const outboundFamilies = [...new Set(outboundOptions.map(roundFareKey).filter(Boolean))];
  outboundFamilies.forEach(key => {
    const outboundIndex = outboundOptions.findIndex(fare => roundFareKey(fare) === key);
    const returnIndex = returnOptions.findIndex(fare => roundFareKey(fare) === key);
    if (returnIndex >= 0) addPair(outboundIndex, returnIndex);
  });
  // Retain the remaining price tiers without making a large all-to-all matrix.
  for (let index = 1; index < Math.max(outboundOptions.length, returnOptions.length); index += 1) {
    addPair(Math.min(index, outboundOptions.length - 1), Math.min(index, returnOptions.length - 1));
  }
  return pairs;
};
const baggageAllowanceText = (fare, kind) => {
  const value = fare?.baggage?.[kind === 'cabin' ? 'cabinKg' : 'checkedKg'];
  if (value === null || value === undefined || value === '') return kind === 'cabin' ? 'Not provided' : 'Not included';
  return `1 × ${value} kg per passenger`;
};
const activeRuleAmount = (fare, type, date, time) => {
  const entry = activeRuleEntry(fare, type, date, time);
  if (!entry || !Number.isFinite(Number(entry.value))) return null;
  return Number(entry.valueType) === 2 ? cnyAmount(fare?.baseFare) * Number(entry.value) : Number(entry.value);
};
const roundFeeSummary = (pair, type) => {
  const outbound = activeRuleAmount(pair.outbound, type, fareDateForPhase('outbound'), selectedOutbound?.departure?.time);
  const inbound = activeRuleAmount(pair.inbound, type, fareDateForPhase('return'), selectedReturn?.departure?.time);
  if (outbound === null && inbound === null) return 'Check fare rules';
  const parts = [outbound, inbound].filter(value => value !== null);
  const total = parts.reduce((sum, value) => sum + value, 0);
  return quoteMnt(total);
};
const oneWayBaggageSummary = fare => `Carry-on baggage: ${baggageAllowanceText(fare, 'cabin')}<br>Checked baggage: ${baggageAllowanceText(fare, 'checked')}`;
const oneWayFeeSummary = (fare, type, date, time) => {
  const amount = activeRuleAmount(fare, type, date, time);
  return amount === null ? 'Check fare rules' : quoteMnt(amount);
};
const sharedBaggageSummary = pair => {
  const outboundCabin = baggageAllowanceText(pair.outbound, 'cabin');
  const outboundChecked = baggageAllowanceText(pair.outbound, 'checked');
  const inboundCabin = baggageAllowanceText(pair.inbound, 'cabin');
  const inboundChecked = baggageAllowanceText(pair.inbound, 'checked');
  const allowanceLines = (label, outboundValue, inboundValue) => outboundValue === inboundValue
    ? `${label}: ${outboundValue}`
    : `Departure · ${label}: ${outboundValue}<br>Return · ${label}: ${inboundValue}`;
  return `${allowanceLines('Carry-on baggage', outboundCabin, inboundCabin)}<br>${allowanceLines('Checked baggage', outboundChecked, inboundChecked)}`;
};
const fareRuleTable = (fare, flight, title, type) => {
  const rule = (fare?.rules || []).find(item => Number(item.type) === type);
  const date = title === 'RETURN' ? fareDateForPhase('return') : fareDateForPhase('outbound');
  const active = activeRuleEntry(fare, type, date, flight?.departure?.time);
  const rows = (rule?.entries || []).map(entry => `<tr class="${entry === active ? 'current-rule' : ''}"><td>${entry === active ? '<b>Current time period</b><br>' : ''}${ruleWindowText(entry)}</td><td>${ruleValueText(entry)}</td></tr>`).join('') || '<tr><td colspan="2">Not provided for this fare.</td></tr>';
  const heading = title === 'RETURN' ? 'Return' : title === 'DEPARTURE' ? 'Departure' : 'Flight';
  return `<section class="fare-policy-direction"><h3><span>${heading}</span>${flight?.departure?.id || ''} → ${flight?.arrival?.id || ''}</h3><table class="fare-policy-table"><thead><tr><th>Request time</th><th>Per adult</th></tr></thead><tbody>${rows}</tbody></table></section>`;
};
const baggageDetailMarkup = (fare, flight, title) => {
  const heading = title === 'RETURN' ? 'Return' : title === 'DEPARTURE' ? 'Departure' : 'Flight';
  const cabinKg = fare?.baggage?.cabinKg;
  const checkedKg = fare?.baggage?.checkedKg;
  const cabinLines = cabinKg === null || cabinKg === undefined || cabinKg === ''
    ? 'Not provided for this fare.'
    : `• 1 piece per passenger, ${cabinKg} kg per piece.${fare?.baggage?.cabinSize ? `<br>• Each piece cannot exceed ${String(fare.baggage.cabinSize).replaceAll('X', ' × ')} cm in size.` : ''}`;
  const checkedLines = checkedKg === null || checkedKg === undefined || checkedKg === ''
    ? 'Not included for this fare.'
    : `• Total weight limit per person: ${checkedKg} kg.`;
  return `<section class="baggage-detail-direction"><h3><span>${heading}</span>${flight?.departure?.id || ''} – ${flight?.arrival?.id || ''}</h3><div class="baggage-allowance-item"><i aria-hidden="true">🧳</i><div><strong>Carry-on Baggage</strong><p>${cabinLines}</p></div></div><div class="baggage-allowance-item"><i aria-hidden="true">🧳</i><div><strong>Checked baggage</strong><p>${checkedLines}</p></div></div>${fare?.baggage?.cabinSize ? '<small class="baggage-dimension-note">*Baggage dimensions include wheels and handles</small>' : ''}</section>`;
};
const showSharedRoundFareDetails = (pair, initialTab = 'rules') => {
  let modal = document.querySelector('#fare-rule-modal');
  if (!modal) { modal = document.createElement('dialog'); modal.id = 'fare-rule-modal'; document.body.append(modal); }
  modal.className = 'fare-details-dialog';
  const baggage = `${baggageDetailMarkup(pair.outbound, selectedOutbound, 'DEPARTURE')}${baggageDetailMarkup(pair.inbound, selectedReturn, 'RETURN')}`;
  const rules = `<h3 class="policy-title">Cancellation fee <small>Per adult ticket</small></h3>${fareRuleTable(pair.outbound, selectedOutbound, 'DEPARTURE', 1)}${fareRuleTable(pair.inbound, selectedReturn, 'RETURN', 1)}<h3 class="policy-title">Change fee <small>Per adult ticket</small></h3>${fareRuleTable(pair.outbound, selectedOutbound, 'DEPARTURE', 2)}${fareRuleTable(pair.inbound, selectedReturn, 'RETURN', 2)}`;
  modal.innerHTML = `<form method="dialog" class="fare-rule-modal round-fare-modal"><button class="close" value="cancel" aria-label="Close">×</button><p class="eyebrow">${pair.label} CLASS · ROUND TRIP</p><h2>Baggage allowance & fare policies</h2><p class="modal-copy">The highlighted row is the current time period for each flight. Fees are calculated per adult and may be confirmed again by the airline at ticket issue.</p><nav class="fare-detail-tabs"><button type="button" data-fare-tab="baggage" class="${initialTab === 'baggage' ? 'active' : ''}">Baggage allowance</button><button type="button" data-fare-tab="rules" class="${initialTab === 'rules' ? 'active' : ''}">Cancellation & change policies</button></nav><div class="fare-detail-pane ${initialTab === 'baggage' ? '' : 'hidden'}" data-fare-pane="baggage">${baggage}</div><div class="fare-detail-pane ${initialTab === 'rules' ? '' : 'hidden'}" data-fare-pane="rules">${rules}</div><button class="primary" value="cancel">Close</button></form>`;
  modal.querySelectorAll('[data-fare-tab]').forEach(button => button.addEventListener('click', () => {
    const tab = button.dataset.fareTab;
    modal.querySelectorAll('[data-fare-tab]').forEach(item => item.classList.toggle('active', item === button));
    modal.querySelectorAll('[data-fare-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.farePane !== tab));
  }));
  modal.showModal();
};
const showSelectedFareDetails = () => {
  if (!selectedOutbound?.fare) return;
  if (!selectedReturn?.fare) return showFareRuleDetails(selectedOutbound.fare, selectedOutbound);
  showSharedRoundFareDetails({
    outbound: selectedOutbound.fare,
    inbound: selectedReturn.fare,
    label: selectedOutbound.fare.fareType || selectedOutbound.fare.bookingClass || 'Economy'
  }, 'baggage');
};
const sharedRoundFareCard = (pair, index, selected) => {
  const combinedFare = {
    baseFare: cnyAmount(pair.outbound?.baseFare) + cnyAmount(pair.inbound?.baseFare),
    taxes: cnyAmount(pair.outbound?.taxes) + cnyAmount(pair.inbound?.taxes),
    total: cnyAmount(pair.outbound?.total) + cnyAmount(pair.inbound?.total)
  };
  return `<div class="fare-choice-item"><button type="button" class="fare-family-choice ${selected ? 'recommended' : ''}" data-shared-fare-index="${index}"><span class="fare-family-top"><b>${pair.label} class</b><i class="fare-radio" aria-hidden="true"></i></span><small>${pair.subtitle}</small>${index === 0 ? '<em class="fare-recommended">Lowest available pair</em>' : ''}<hr><strong>Baggage</strong><p>${sharedBaggageSummary(pair)}</p><strong>Flexibility</strong><p>Cancellation: ${roundFeeSummary(pair, 1)}<br>Change: ${roundFeeSummary(pair, 2)}</p>${farePriceMarkup(combinedFare)}</button><div class="shared-fare-actions"><button type="button" class="text-btn shared-fare-details" data-shared-fare-index="${index}">Details</button></div></div>`;
};
const showRoundFareOptions = () => {
  const outboundOptions = selectedOutbound?.fareOptions?.length ? selectedOutbound.fareOptions : [selectedOutbound?.fare].filter(Boolean);
  const returnOptions = selectedReturn?.fareOptions?.length ? selectedReturn.fareOptions : [selectedReturn?.fare].filter(Boolean);
  const pairs = buildSharedRoundFares(outboundOptions, returnOptions);
  if (!pairs.length) return toast('No shared fare is available for this round trip. Please select another flight.');
  const selections = { shared: 0 };
  const render = () => {
    const pair = pairs[selections.shared];
    const total = cnyAmount(pair.outbound?.total) + cnyAmount(pair.inbound?.total);
    resultArea.classList.remove('hidden');
    const combinedFare = { baseFare: cnyAmount(pair.outbound?.baseFare) + cnyAmount(pair.inbound?.baseFare), taxes: cnyAmount(pair.outbound?.taxes) + cnyAmount(pair.inbound?.taxes), total };
    resultArea.innerHTML = `<section class="fare-choice-screen round-fare-choice"><header><p class="eyebrow">ROUND TRIP · FARE SELECTION</p><div class="fare-selected-flights">${fareSelectionFlight(selectedOutbound, 'Departure', 'outbound')}${fareSelectionFlight(selectedReturn, 'Return', 'return')}</div></header><section class="bound-fare-picker"><header><p class="eyebrow">FARE COMBINATION FOR BOTH FLIGHTS</p></header><div class="fare-carousel"><button type="button" class="fare-scroll fare-scroll-back" aria-label="Previous fares">‹</button><div class="fare-choice-grid">${pairs.map((pairOption, index) => sharedRoundFareCard(pairOption, index, selections.shared === index)).join('')}</div><button type="button" class="fare-scroll fare-scroll-next" aria-label="Next fares">›</button></div></section><footer class="fare-choice-footer"><div>${fareBreakdownMarkup(combinedFare)}</div><button class="primary confirm-round-fares">Continue to passenger details</button></footer></section>`;
    resultArea.querySelectorAll('[data-shared-fare-index]').forEach(button => button.addEventListener('click', event => {
      const index = Number(button.dataset.sharedFareIndex);
      if (button.classList.contains('shared-fare-details')) { event.stopPropagation(); return showSharedRoundFareDetails(pairs[index], 'baggage'); }
      selections.shared = index; render();
    }));
    resultArea.querySelectorAll('.fare-scroll').forEach(button => button.addEventListener('click', () => {
      const scroller = button.parentElement.querySelector('.fare-choice-grid');
      scroller.scrollBy({ left: (button.classList.contains('fare-scroll-back') ? -1 : 1) * Math.max(300, scroller.clientWidth * .8), behavior: 'smooth' });
    }));
    resultArea.querySelector('.confirm-round-fares').addEventListener('click', () => {
      applyFareOption(selectedOutbound, pair.outbound);
      applyFareOption(selectedReturn, pair.inbound);
      prepareBookingScreen();
    });
  };
  render();
};
async function selectFlight(flight) {
  if (passengerSearchStale) return toast('Search again after changing passenger count before selecting a flight.');
  if (tripType === 'round' && searchPhase === 'outbound') { selectedOutbound = flight; return renderFlights(roundReturnFlights, 'return', true); }
  if (tripType === 'round' && searchPhase === 'return') { selectedReturn = flight; return showRoundFareOptions(); }
  showFareOptions(flight, searchPhase);
}
document.querySelectorAll('[data-trip]').forEach(button => button.addEventListener('click', () => { tripType = button.dataset.trip; document.querySelectorAll('[data-trip]').forEach(b => b.classList.toggle('selected', b === button)); document.querySelector('.return-date').hidden = tripType !== 'round'; resultArea.classList.add('hidden'); }));
const passengerLimits = { adults: { min: 1, max: 9 }, children: { min: 0, max: 8 }, infants: { min: 0, max: 8 } };
document.querySelectorAll('[data-change]').forEach(button => button.addEventListener('click', () => {
  const field = button.dataset.change; const input = document.querySelector(`#${field}`); const limit = passengerLimits[field];
  const previous = Number(input.value); const next = Math.min(limit.max, Math.max(limit.min, previous + Number(button.dataset.step)));
  input.value = next; document.querySelector(`#${field}-output`).value = next;
  if (next !== previous) {
    passengerSearchStale = true;
    if (!resultArea.classList.contains('hidden')) toast('Passenger count changed. Search again to refresh fares for this party.');
  }
  if (field === 'adults' && next === 1 && Number(button.dataset.step) < 0) toast('At least one adult is required when travelling with children or infants.');
}));
const outboundDateInput = document.querySelector('#outbound-date'); const returnDateInput = document.querySelector('#return-date');
const isoDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const localToday = isoDate(new Date());
if (outboundDateInput.value < localToday) outboundDateInput.value = localToday;
if (returnDateInput.value < outboundDateInput.value) returnDateInput.value = outboundDateInput.value;
outboundDateInput.addEventListener('change', () => { if (returnDateInput.value < outboundDateInput.value) returnDateInput.value = outboundDateInput.value; });
const calendarPopover = document.querySelector('#calendar-popover'); let activeDateInput = null; let calendarMonth = null;
const calendarMinimum = input => input.id === 'outbound-date' ? localToday : (outboundDateInput.value > localToday ? outboundDateInput.value : localToday);
const renderCalendar = () => { const year = calendarMonth.getFullYear(); const month = calendarMonth.getMonth(); const first = new Date(year, month, 1); const start = (first.getDay() + 6) % 7; const selected = activeDateInput.value; const minimum = calendarMinimum(activeDateInput); const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; const days = Array.from({ length: 42 }, (_, i) => { const date = new Date(year, month, i - start + 1); const dateIso = isoDate(date); const weekend = i % 7 >= 5; return `<button type="button" class="${weekend ? 'weekend ' : ''}${date.getMonth() !== month ? 'outside ' : ''}${dateIso === selected ? 'selected' : ''}" data-calendar-date="${dateIso}" ${dateIso < minimum ? 'disabled' : ''}>${date.getDate()}</button>`; }).join(''); calendarPopover.innerHTML = `<div class="calendar-head"><button type="button" data-calendar-nav="-1">‹</button><strong>${calendarMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</strong><button type="button" data-calendar-nav="1">›</button></div><div class="calendar-week">${labels.map((label, index) => `<span class="${index >= 5 ? 'weekend' : ''}">${label}</span>`).join('')}</div><div class="calendar-days">${days}</div>`; calendarPopover.querySelectorAll('[data-calendar-nav]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); calendarMonth = new Date(year, month + Number(button.dataset.calendarNav), 1); renderCalendar(); })); calendarPopover.querySelectorAll('[data-calendar-date]').forEach(button => button.addEventListener('click', () => { activeDateInput.value = button.dataset.calendarDate; activeDateInput.dispatchEvent(new Event('change')); calendarPopover.hidden = true; })); };
const openCalendar = input => { activeDateInput = input; const [year, month] = input.value.split('-').map(Number); calendarMonth = new Date(year, month - 1, 1); const rect = input.getBoundingClientRect(); calendarPopover.style.top = `${Math.min(rect.bottom + 7, window.innerHeight - 345)}px`; calendarPopover.style.left = `${Math.min(rect.left, window.innerWidth - 320)}px`; calendarPopover.hidden = false; renderCalendar(); };
document.querySelectorAll('.open-calendar').forEach(button => button.addEventListener('click', () => openCalendar(document.querySelector(`#${button.dataset.dateInput}`)))); [outboundDateInput, returnDateInput].forEach(input => input.addEventListener('click', () => openCalendar(input))); document.addEventListener('click', event => { if (!event.target.closest('.calendar-popover') && !event.target.closest('.date-control')) calendarPopover.hidden = true; });
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const commonAirports = { ULN: 'Ulaanbaatar', PVG: 'Shanghai', SHA: 'Shanghai' };
const offlineLocations = [{ city: 'Ulaanbaatar', code: 'ULN', airport: 'Chinggis Khaan International Airport' }, { city: 'Shanghai', code: 'PVG', airport: 'Pudong International Airport' }, { city: 'Shanghai', code: 'SHA', airport: 'Hongqiao International Airport' }, { city: 'Beijing', code: 'PEK', airport: 'Capital International Airport' }, { city: 'Beijing', code: 'PKX', airport: 'Daxing International Airport' }, { city: 'Hong Kong', code: 'HKG', airport: 'Hong Kong International Airport' }, { city: 'Tokyo', code: 'NRT', airport: 'Narita International Airport' }, { city: 'Seoul', code: 'ICN', airport: 'Incheon International Airport' }];
const setupAirportAutocomplete = (inputId, listId) => {
  const input = document.querySelector(`#${inputId}`); const list = document.querySelector(`#${listId}`); let timer;
  const clear = () => { list.innerHTML = ''; };
  const getOptions = async q => { const local = () => offlineLocations.filter(option => `${option.city} ${option.code} ${option.airport}`.toLowerCase().includes(q.toLowerCase())); try { const response = await fetch(`/api/locations?q=${encodeURIComponent(q)}`); const data = await response.json(); return response.ok ? (data.options ?? []) : local(); } catch { return local(); } };
  const choose = option => { input.value = `${option.city} (${option.code})`; clear(); };
  const lookup = async () => { const q = input.value.trim(); if (q.length < 2) return clear(); try { const options = await getOptions(q); list.innerHTML = options.slice(0, 7).map(option => `<button type="button" class="suggestion" data-code="${escapeHtml(option.code)}" data-city="${escapeHtml(option.city)}"><span><strong>${escapeHtml(option.city)} (${escapeHtml(option.code)})</strong><small>${escapeHtml(option.airport)}</small></span><code>${escapeHtml(option.code)}</code></button>`).join(''); list.querySelectorAll('.suggestion').forEach(button => button.addEventListener('mousedown', event => { event.preventDefault(); choose({ city: button.dataset.city, code: button.dataset.code }); })); } catch { clear(); } };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(lookup, 350); }); input.addEventListener('focus', () => { if (input.value.trim().length >= 2) { clearTimeout(timer); timer = setTimeout(lookup, 150); } }); input.addEventListener('blur', () => { const code = input.value.trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(code)) return; setTimeout(async () => { if (input.value.trim().toUpperCase() !== code) return; try { const options = commonAirports[code] ? [{ city: commonAirports[code], code }] : await getOptions(code); const exact = options.find(option => option.code.toUpperCase() === code); if (exact) choose(exact); } catch { clear(); } }, 120); }); document.addEventListener('click', event => { if (!event.target.closest('.autocomplete')) clear(); });
};
setupAirportAutocomplete('departure', 'departure-suggestions'); setupAirportAutocomplete('arrival', 'arrival-suggestions');
document.querySelector('.swap').addEventListener('click', () => { const from = document.querySelector('#departure'); const to = document.querySelector('#arrival'); [from.value, to.value] = [to.value, from.value]; from.focus(); });
document.querySelector('#search-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.currentTarget.querySelector('.primary'); const departureInput = document.querySelector('#departure'); const arrivalInput = document.querySelector('#arrival');
  const departure = departureInput.value.match(/\(([A-Z]{3})\)/)?.[1] || departureInput.value.trim(); const arrival = arrivalInput.value.match(/\(([A-Z]{3})\)/)?.[1] || arrivalInput.value.trim();
  activePassengerCounts = passengerCounts(); passengerSearchStale = false;
  selectedOutbound = null; selectedReturn = null; roundReturnFlights = []; button.disabled = true; button.textContent = 'Searching…';
  try { const query = new URLSearchParams({ departure, arrival, date: document.querySelector('#outbound-date').value, returnDate: document.querySelector('#return-date').value, adults: document.querySelector('#adults').value, children: document.querySelector('#children').value, infants: document.querySelector('#infants').value, trip: tripType }); const response = await fetch(`/api/flights?${query}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); activePassengerCounts = data.passengers || activePassengerCounts; if (tripType === 'round') { const seen = new Set(); roundReturnFlights = (data.roundPairs ?? []).map(pair => pair.returnFlight).filter(flight => { const key = `${flight.number}|${flight.departure?.time}|${flight.arrival?.time}`; if (seen.has(key)) return false; seen.add(key); return true; }); renderFlights(data.results, 'outbound'); } else renderFlights(data.results, 'outbound'); }
  catch (error) { showMockSearch(departure, arrival); }
  finally { button.disabled = false; button.textContent = 'Search flights'; }
});
bindFlightButtons();
const topup = document.querySelector('#topup-modal'); topup.querySelector('.close').addEventListener('click', () => topup.close());
const toast = message => { if (message === '__SESSION_EXPIRED__') return; const t=document.querySelector('#toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3400); };
const portalSession = () => JSON.parse(sessionStorage.getItem('flightb2b-session') || '{}');
const secureFetch = async (url, options = {}) => {
  const request = () => fetch(url, { ...options, headers: { authorization: `Bearer ${portalSession().accessToken}`, ...(options.headers || {}) } });
  let response = await request();
  if (response.status === 401 && await window.refreshPortalSession?.()) response = await request();
  if (response.status === 401) {
    window.forcePortalSignOut?.();
    throw new Error('__SESSION_EXPIRED__');
  }
  return response;
};
const portalBookingFromRow = row => {
  const itinerary = row.itinerary || {};
  const travellers = row.passengers?.travellers || [];
  return {
    ref: row.pnr,
    route: itinerary.route || '',
    passenger: travellers.map(person => `${person.lastName} / ${person.firstName}`.trim()).filter(Boolean).join(', ') || 'Passenger',
    passengers: travellers.map(person => `${person.lastName} / ${person.firstName}`.trim()),
    passengerTypes: travellers.map(person => person.type || 'ADT'),
    passengerCount: travellers.length,
    issued: new Date(row.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    createdAt: row.created_at,
    total: row.total_cny,
    status: row.status,
    oneWay: itinerary.trip === 'oneway',
    itinerary,
    contact: row.passengers?.contact || {},
    documents: travellers
  };
};
const loadBookings = async () => {
  if (!portalSession().accessToken) return;
  try {
    const response = await secureFetch('/api/bookings');
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.error || 'Bookings could not be loaded.');
    const pendingSpringSync = rows.filter(row => row.status !== 'Cancelled' && row.pnr && !String(row.pnr).startsWith('B2B'));
    if (pendingSpringSync.length) {
      await Promise.all(pendingSpringSync.map(row => secureFetch(`/api/bookings/${encodeURIComponent(row.pnr)}/sync`, { method: 'POST' }).catch(() => null)));
      const refreshed = await secureFetch('/api/bookings');
      if (refreshed.ok) rows.splice(0, rows.length, ...(await refreshed.json()));
    }
    bookings.splice(0, bookings.length, ...rows.map(portalBookingFromRow));
    renderBookings();
  } catch (error) { console.warn(error.message); }
};
const totalCnyForSelection = () => [selectedOutbound, selectedReturn].filter(Boolean).reduce((sum, flight) => sum + cnyAmount(flight.price), 0) * activePassengerCounts.adults;
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? new Date(`${value}T00:00:00`) : null;
const ageOnDate = (birthDate, travelDate) => {
  let age = travelDate.getFullYear() - birthDate.getFullYear();
  const birthdayThisYear = new Date(travelDate.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  if (travelDate < birthdayThisYear) age -= 1;
  return age;
};
const addCalendarMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
const passengerValidationError = (traveller, departureDate) => {
  const birthDate = dateOnly(traveller.dateOfBirth);
  const expiryDate = dateOnly(traveller.documentExpiry);
  if (!birthDate) return { field: 'date-of-birth', message: 'Date of birth is required.' };
  const age = ageOnDate(birthDate, departureDate);
  const type = traveller.type;
  if (type === 'ADT' && age < 12) return { field: 'date-of-birth', message: `ADT must be 12 years old or above on departure. This passenger is ${age}.` };
  if (type === 'CHD' && (age < 2 || age >= 12)) return { field: 'date-of-birth', message: `CHD must be from age 2 until the day before the 12th birthday. This passenger is ${age}.` };
  if (type === 'INF' && age >= 2) return { field: 'date-of-birth', message: `INF must be under 2 years old on departure. This passenger is ${age}.` };
  if (!expiryDate || expiryDate < addCalendarMonths(departureDate, 6)) return { field: 'document-expiry', message: 'Travel document must be valid for at least 6 months from departure.' };
  return null;
};
const clearFormErrors = form => form.querySelectorAll('.field-error, .field-error-message').forEach(element => {
  if (element.classList.contains('field-error')) element.classList.remove('field-error');
  else element.remove();
});
const setFieldError = (field, message) => {
  if (!field) return;
  const visibleField = field.type === 'hidden' ? field.closest('label')?.querySelector('.split-date-control') : field;
  visibleField?.classList.add('field-error');
  const label = field.closest('label');
  if (!label) return;
  const help = document.createElement('small');
  help.className = 'field-error-message';
  help.textContent = message;
  label.append(help);
};
const validateRequiredFields = form => {
  const required = [...form.querySelectorAll('[required]')];
  const missing = required.filter(field => !String(field.value || '').trim());
  missing.forEach(field => setFieldError(field, 'This field is required.'));
  return missing[0] || null;
};
const syncSplitDateControl = control => {
  const day = control.querySelector('[data-date-part="day"]')?.value.replace(/\D/g, '') || '';
  const month = monthNumber(control.querySelector('[data-date-part="month"]')?.value);
  const year = control.querySelector('[data-date-part="year"]')?.value.replace(/\D/g, '') || '';
  const hidden = control.querySelector('input[type="hidden"]');
  if (!hidden) return;
  hidden.value = '';
  if (day.length < 1 || !month || year.length !== 4) return;
  const monthValue = String(month).padStart(2, '0');
  const candidate = new Date(`${year}-${monthValue}-${day.padStart(2, '0')}T12:00:00`);
  if (candidate.getFullYear() === Number(year) && candidate.getMonth() + 1 === Number(month) && candidate.getDate() === Number(day)) hidden.value = `${year}-${monthValue}-${day.padStart(2, '0')}`;
};
const splitDateError = control => {
  const day = control.querySelector('[data-date-part="day"]')?.value.replace(/\D/g, '') || '';
  const month = monthNumber(control.querySelector('[data-date-part="month"]')?.value);
  const year = control.querySelector('[data-date-part="year"]')?.value.replace(/\D/g, '') || '';
  if (!day || !month || !year) return null;
  const candidate = new Date(`${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}T12:00:00`);
  const valid = day.length <= 2 && year.length === 4 && Number(year) > 0
    && candidate.getFullYear() === Number(year)
    && candidate.getMonth() + 1 === Number(month)
    && candidate.getDate() === Number(day);
  return valid ? null : 'Enter a valid calendar date for the selected month and year.';
};
const clearSplitDateError = control => {
  control?.classList.remove('field-error');
  control?.closest('label')?.querySelectorAll('.field-error-message').forEach(message => message.remove());
};
const validateSplitDateControls = form => {
  const invalid = [...form.querySelectorAll('.split-date-control')].find(control => splitDateError(control));
  if (!invalid) return null;
  const hidden = invalid.querySelector('input[type="hidden"]');
  setFieldError(hidden, splitDateError(invalid));
  return hidden;
};
document.addEventListener('input', event => {
  const control = event.target.closest('.split-date-control');
  if (!control) return;
  if (event.target.matches('[data-date-part="day"], [data-date-part="year"]')) event.target.value = event.target.value.replace(/\D/g, '');
  syncSplitDateControl(control);
  if (!splitDateError(control)) clearSplitDateError(control);
});
document.addEventListener('change', event => {
  const control = event.target.closest('.split-date-control');
  if (control) {
    syncSplitDateControl(control);
    if (!splitDateError(control)) clearSplitDateError(control);
  }
});
document.addEventListener('focusout', event => {
  const control = event.target.closest('.split-date-control');
  if (!control) return;
  const monthInput = control.querySelector('[data-date-part="month"]');
  const month = monthNumber(monthInput?.value);
  if (event.target.matches('[data-date-part="month"]') && monthInput && month) monthInput.value = monthOptions[month - 1];
  syncSplitDateControl(control);
  if (control.contains(event.relatedTarget)) return;
  const error = splitDateError(control);
  clearSplitDateError(control);
  if (error) setFieldError(control.querySelector('input[type="hidden"]'), error);
});
document.addEventListener('focusout', event => {
  const field = event.target.closest('.passenger-card input[name="last-name"], .passenger-card input[name="first-name"], .passenger-card input[name="document-number"]');
  if (field?.value) field.value = field.value.trim().toUpperCase();
});
const createPortalBookingFromForm = async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('.issue-ticket');
  clearFormErrors(event.currentTarget);
  const invalidDate = validateSplitDateControls(event.currentTarget);
  if (invalidDate) { invalidDate.closest('label')?.querySelector('[data-date-part]')?.focus(); toast('Correct the highlighted date.'); return; }
  const missing = validateRequiredFields(event.currentTarget);
  if (missing) { (missing.type === 'hidden' ? missing.closest('label')?.querySelector('[data-date-part]') : missing)?.focus(); toast('Complete the highlighted required field.'); return; }
  const cards = [...event.currentTarget.querySelectorAll('.passenger-card')];
  const travellers = cards.map(card => {
    const get = name => card.querySelector(`[name="${name}"]`)?.value.trim() || '';
    return { type: ({ Adult: 'ADT', Child: 'CHD', Infant: 'INF' })[card.dataset.passengerType] || 'ADT', lastName: get('last-name'), firstName: get('first-name'), dateOfBirth: get('date-of-birth'), documentType: get('document-type'), documentNumber: get('document-number'), nationality: get('nationality'), issuingCountry: get('issuing-country'), documentExpiry: get('document-expiry'), gender: get('gender') };
  });
  const departureDate = document.querySelector('#outbound-date')?.value;
  const returnDate = document.querySelector('#return-date')?.value || '';
  const travelDate = dateOnly(departureDate);
  if (!travelDate) { toast('A valid departure date is required.'); return; }
  const invalidPassenger = travellers.map((traveller, index) => ({ index, error: passengerValidationError(traveller, travelDate) })).find(item => item.error);
  if (invalidPassenger) {
    const field = cards[invalidPassenger.index]?.querySelector(`[name="${invalidPassenger.error.field}"]`);
    setFieldError(field, invalidPassenger.error.message);
    (field?.type === 'hidden' ? field.closest('label')?.querySelector('[data-date-part]') : field)?.focus();
    toast(invalidPassenger.error.message);
    return;
  }
  const bookingFlightSnapshot = (flight, travelDate) => {
    const fare = flight?.fare || {};
    const spring = flight?.spring || {};
    return {
      airline: flight?.airline,
      airlineCode: flight?.airlineCode,
      airlineLogo: flight?.airlineLogo,
      number: flight?.number,
      duration: flight?.duration,
      travelDate,
      stops: flight?.stops || 0,
      departure: { id: flight?.departure?.id, name: flight?.departure?.name, time: flight?.departure?.time, terminal: flight?.departure?.terminal || null },
      arrival: { id: flight?.arrival?.id, name: flight?.arrival?.name, time: flight?.arrival?.time, terminal: flight?.arrival?.terminal || null },
      fare: {
        id: fare.id,
        fareType: fare.fareType,
        bookingClass: fare.bookingClass,
        cabin: fare.cabin,
        baseFare: fare.baseFare,
        taxes: fare.taxes,
        total: fare.total,
        baggage: fare.baggage,
        rules: fare.rules,
        spring: { segHeadId: fare.spring?.segHeadId, combId: fare.spring?.combId, combType: fare.spring?.combType, combPrice: fare.spring?.combPrice, adultCabin: fare.spring?.adultCabin, moneyClassId: fare.spring?.moneyClassId }
      },
      spring: { segHeadId: spring.segHeadId, combId: spring.combId, combType: spring.combType, combPrice: spring.combPrice, adultCabin: spring.adultCabin, moneyClassId: spring.moneyClassId }
    };
  };
  const route = `${selectedOutbound?.departure?.id || ''} → ${selectedOutbound?.arrival?.id || ''}`;
  const itinerary = { route, trip: selectedReturn ? 'round' : 'oneway', departureDate, returnDate, flights: [selectedOutbound, selectedReturn].filter(Boolean).map((flight, index) => bookingFlightSnapshot(flight, index ? returnDate : departureDate)) };
  const phoneCountryCode = event.currentTarget.querySelector('[name="contact-country-code"]')?.value.trim() || '';
  const phoneNumber = event.currentTarget.querySelector('[name="contact-phone"]')?.value.trim() || '';
  const contact = {
    name: event.currentTarget.querySelector('[name="contact-name"]')?.value.trim(),
    phone: `${phoneCountryCode} ${phoneNumber}`.trim(),
    // Spring's passengerDetailInfo requires the country calling code as a
    // separate areaCode value (for example, Mongolia is 976).
    areaCode: phoneCountryCode.replace(/[^\d]/g, ''),
    email: event.currentTarget.querySelector('[name="contact-email"]')?.value.trim()
  };
  submit.disabled = true; submit.textContent = 'Creating booking…';
  try {
    const response = await secureFetch('/api/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ totalCny: totalCnyForSelection(), itinerary, passengers: { travellers, contact } }) });
    const rawResponse = await response.text();
    let data;
    try { data = rawResponse ? JSON.parse(rawResponse) : {}; }
    catch {
      const status = response.status ? ` (HTTP ${response.status})` : '';
      throw new Error(`Booking service is temporarily unavailable${status}. No PNR or ticket was created. Please try again shortly.`);
    }
    if (!response.ok) throw new Error(data.error || 'Booking could not be created.');
    const booking = portalBookingFromRow(data.booking);
    bookings.unshift(booking);
    renderBookings();
    const modal = document.querySelector('#ticket-modal');
    modal.innerHTML = `<form method="dialog"><button class="close" value="cancel">×</button><div class="ticket-icon">✓</div><p class="eyebrow">SPRING BOOKING CREATED</p><h2>PNR ${booking.ref}</h2><p class="modal-copy">The reservation was created in Spring Airlines. Issue the ticket from the booking details when you are ready.</p><div class="booking-ref">TOTAL <strong>${quoteMnt(booking.total)}</strong></div><div class="booking-detail-actions"><button class="secondary copy-pnr" type="button">Copy PNR</button><button class="primary view-created-booking" type="button">View booking</button></div></form>`;
    modal.querySelector('.copy-pnr').addEventListener('click', async () => { await navigator.clipboard?.writeText(booking.ref); toast(`PNR ${booking.ref} copied.`); });
    modal.querySelector('.view-created-booking').addEventListener('click', () => { modal.close(); showView('bookings'); openBookingDetail(booking.ref); });
    modal.showModal();
  } catch (error) { toast(error.message || 'Booking could not be created.'); }
  finally { submit.disabled = false; submit.textContent = 'Book'; }
};
// Capture the booking button click before any browser/default form handling.
// A caught error must always be visible to the agent instead of silently
// leaving the Book button unchanged.
document.addEventListener('click', event => {
  const book = event.target.closest('.issue-ticket');
  if (!book?.form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void createPortalBookingFromForm({ preventDefault() {}, currentTarget: book.form })
    .catch(error => {
      console.error('Booking form failed before API request:', error);
      toast(error?.message || 'Booking form could not be submitted.');
    });
}, true);
document.addEventListener('click', event => {
  const book = event.target.closest('.issue-ticket');
  if (book?.form) book.form.noValidate = true;
});
const updatePortalBookingStatus = async (pnr, action, payload) => {
  const response = await secureFetch(`/api/bookings/${encodeURIComponent(pnr)}/${action}`, { method: 'POST', headers: payload ? { 'content-type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Booking could not be updated.');
  const updated = portalBookingFromRow(data.booking);
  const index = bookings.findIndex(item => item.ref === pnr);
  if (index >= 0) bookings.splice(index, 1, updated);
  else bookings.unshift(updated);
  renderBookings();
  return updated;
};
const cny = value => `¥ ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const walletEntryLabel = entry => ({ credit: 'Credit', debit: 'Debit', adjustment: 'Adjustment' }[entry] || entry || 'Transaction');
const loadWallet = async () => { const session = portalSession(); if (!session.accessToken) return; try { const response = await secureFetch('/api/wallet'); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Wallet could not be loaded.'); const balance = Number(data.wallet?.balance_cny || 0); const rate = Number(data.rate?.effectiveRateMnt || pricingRate?.effectiveRateMnt || 0); const asMnt = value => rate ? mnt(Number(value || 0) * rate) : '—'; document.querySelectorAll('#wallet-balance, .balance-copy').forEach(element => { element.textContent = asMnt(balance); }); document.querySelectorAll('#wallet-balance-cny, .balance-cny-copy').forEach(element => { element.textContent = `${cny(balance)} CNY`; }); const ledger = document.querySelector('#ledger'); if (!ledger) return; let runningBalance = balance; ledger.innerHTML = (data.transactions || []).map(item => { const balanceAfter = runningBalance; runningBalance -= Number(item.amount_cny || 0); const amount = Number(item.amount_cny || 0); const sign = amount >= 0 ? '+' : '−'; return `<tr><td>${new Date(item.created_at).toLocaleString('en-GB')}</td><td>WLT-${String(item.id || '').slice(0, 8).toUpperCase()}</td><td>${item.reason || 'Wallet transaction'}</td><td>${walletEntryLabel(item.entry_type)}</td><td class="${amount >= 0 ? 'credit' : 'debit'}">${sign} ${asMnt(Math.abs(amount))}<small class="currency-secondary">${sign} ${cny(Math.abs(amount))} CNY</small></td><td>${asMnt(balanceAfter)}<small class="currency-secondary">${cny(balanceAfter)} CNY</small></td></tr>`; }).join('') || '<tr><td colspan="6" class="no-bookings">No wallet transactions yet.</td></tr>'; } catch (error) { console.warn(error.message); } };
const loadPricingRate = async () => { const preview = document.querySelector('#topup-rate-preview'); try { const response = await fetch('/api/fx/cny-mnt'); const rate = await response.json(); if (!response.ok) throw new Error(rate.error); pricingRate = rate; renderBookings(); if (preview) preview.textContent = 'Enter an MNT amount to see the CNY wallet credit.'; const amount = document.querySelector('#topup-amount'); const update = () => { const raw = String(amount?.value || '').replace(/[^\d]/g, ''); if (amount) amount.value = raw ? Number(raw).toLocaleString('en-US') : ''; if (preview && Number(raw) > 0) { const fundingMnt = Number(raw); const sellRate = Number(rate.nonCashSellMnt || rate.effectiveRateMnt); const walletCny = fundingMnt / sellRate; const serviceFee = Math.round(fundingMnt * 0.03); const correspondentFeeCny = walletCny <= 100_000 ? 50 : 150; const correspondentFee = Math.round(correspondentFeeCny * sellRate); const golomtFee = walletCny <= 50_000 ? 5000 : walletCny <= 100_000 ? 10_000 : 20_000; const payable = fundingMnt + serviceFee + correspondentFee + golomtFee; preview.innerHTML = `Wallet credit: <strong>${cny(walletCny)}</strong><br>Үйлчилгээний хөлс (3%): ${mnt(serviceFee)}<br>Корреспондент банк (OUR · ¥${correspondentFeeCny}): ${mnt(correspondentFee)}<br>Голомт Банкны шимтгэл: ${mnt(golomtFee)}<br><strong>Төлөх нийт дүн: ${mnt(payable)}</strong>`; } }; amount?.addEventListener('input', update); } catch (error) { if (preview) preview.textContent = error.message || 'Exchange rate is temporarily unavailable.'; } };
const downloadInvoice = async (id, number) => { const response = await secureFetch(`/api/invoices/${id}`); if (!response.ok) return toast('Invoice download failed.'); const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${number}.html`; link.click(); URL.revokeObjectURL(link.href); };
const viewInvoice = async (id, number) => { const response = await secureFetch(`/api/invoices/${id}`); if (!response.ok) return toast('Invoice preview failed.'); const blobUrl = URL.createObjectURL(await response.blob()); let viewer = document.querySelector('#invoice-viewer'); if (!viewer) { viewer = document.createElement('dialog'); viewer.id = 'invoice-viewer'; document.body.append(viewer); } viewer.innerHTML = `<div class="invoice-viewer-head"><strong>${number}</strong><button class="close" type="button" aria-label="Close">×</button></div><iframe title="${number}" src="${blobUrl}"></iframe>`; const close = () => { URL.revokeObjectURL(blobUrl); viewer.close(); }; viewer.querySelector('.close').addEventListener('click', close, { once: true }); viewer.addEventListener('close', () => URL.revokeObjectURL(blobUrl), { once: true }); viewer.showModal(); };
const loadTopupInvoices = async () => { const target = document.querySelector('#topup-invoices'); if (!target || !portalSession().accessToken) return; try { const response = await secureFetch('/api/topups'); const rows = await response.json(); if (!response.ok) throw new Error(rows.error); const invoiceTotal = item => Number(item.total_mnt ?? Number(item.amount_mnt || 0) + Number(item.service_fee_mnt || 0)); const pending = rows.filter(item => item.status === 'pending').reduce((sum, item) => sum + invoiceTotal(item), 0); const total = document.querySelector('#pending-topups'); if (total) total.textContent = mnt(pending); target.innerHTML = rows.map(item => { const tag = item.status === 'approved' ? 'ticketed' : item.status === 'cancelled' ? 'cancelled' : 'pending'; return `<tr><td><strong>${item.invoice_number}</strong></td><td>${new Date(item.created_at).toLocaleDateString('en-GB')}</td><td><strong>${mnt(invoiceTotal(item))}</strong><small class="currency-secondary">Wallet credit: ${cny(item.amount_cny)} CNY</small></td><td><span class="tag ${tag}">${item.status}</span></td><td><button class="text-btn view-invoice" data-invoice-id="${item.id}" data-invoice-number="${item.invoice_number}">View</button><button class="text-btn download-invoice" data-invoice-id="${item.id}" data-invoice-number="${item.invoice_number}">Download</button>${item.status === 'pending' ? `<button class="text-btn delete-invoice" data-invoice-id="${item.id}">Delete</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="no-bookings">No top-up invoices yet.</td></tr>'; } catch (error) { target.innerHTML = `<tr><td colspan="5" class="no-bookings">${error.message || 'Unable to load invoices.'}</td></tr>`; } };
document.querySelectorAll('[data-open-topup]').forEach(b=>b.addEventListener('click',()=>topup.showModal()));
document.querySelector('#topup-form').addEventListener('submit', async e=>{ e.preventDefault(); const error = document.querySelector('#topup-error'); const submit = e.target.querySelector('.primary'); error.hidden = true; submit.disabled = true; try { const form = Object.fromEntries(new FormData(e.target)); form.amountMnt = String(form.amountMnt || '').replace(/,/g, ''); const response = await secureFetch('/api/topups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); topup.close(); e.target.reset(); await Promise.all([loadTopupInvoices(), loadWallet()]); toast(`Invoice ${result.invoice.invoice_number} created.`); downloadInvoice(result.invoice.id, result.invoice.invoice_number); } catch (issue) { if (issue.message === '__SESSION_EXPIRED__') return; error.textContent = issue.message; error.hidden = false; } finally { submit.disabled = false; } });
document.addEventListener('click', async event => { const view = event.target.closest('.view-invoice'); if (view) return viewInvoice(view.dataset.invoiceId, view.dataset.invoiceNumber); const download = event.target.closest('.download-invoice'); if (download) return downloadInvoice(download.dataset.invoiceId, download.dataset.invoiceNumber); const remove = event.target.closest('.delete-invoice'); if (!remove || !confirm('Delete this pending invoice?')) return; const response = await secureFetch(`/api/topups/${remove.dataset.invoiceId}`, { method: 'DELETE' }); const result = await response.json(); if (!response.ok) return toast(result.error || 'Invoice could not be deleted.'); await Promise.all([loadTopupInvoices(), loadWallet()]); toast('Pending invoice deleted.'); });
window.loadTopupInvoices = loadTopupInvoices;
window.loadWallet = loadWallet;
window.loadBookings = loadBookings;
loadPricingRate();
loadTopupInvoices();
loadWallet();

// Wallet funding can be approved from a platform-admin session on another
// device. Polling keeps an agent's open dashboard and Wallet page current
// without asking the agent to refresh the browser manually.
setInterval(() => {
  if (document.visibilityState !== 'visible' || !portalSession().accessToken) return;
  loadWallet();
  loadTopupInvoices();
}, 5000);

