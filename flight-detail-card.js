(() => {
  const text = (element, fallback = 'Not provided') => element?.textContent?.trim() || fallback;
  const flightsByNumber = new Map();
  const rememberFlight = flight => {
    if (!flight?.number) return;
    flightsByNumber.set(String(flight.number).replace(/\s/g, ''), flight);
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = String(args[0] || '');
    if (url.includes('/api/flights')) {
      response.clone().json().then(data => {
        (data.results || []).forEach(rememberFlight);
        (data.roundPairs || []).forEach(pair => { rememberFlight(pair.outbound); rememberFlight(pair.returnFlight); });
      }).catch(() => {});
    }
    return response;
  };
  const flightFor = detail => {
    const number = text(detail.querySelector('.segment-carrier span')).match(/[A-Z0-9]+\s*\d+/i)?.[0]?.replace(/\s/g, '');
    return number ? flightsByNumber.get(number) : null;
  };
  const fareFor = detail => {
    const flight = detail.closest('.flight');
    const pair = detail.closest('.round-pair');
    const data = flightFor(detail);
    const fare = data?.fare || data?.spring?.fare || data?.spring || {};
    const money = value => Number.isFinite(Number(value)) && typeof quoteMnt === 'function' ? quoteMnt(value) : 'Verified before issue';
    const total = data ? money(fare.total ?? data.price) : text(flight?.querySelector('.fare strong'), text(pair?.querySelector('.pair-footer strong'), 'Shown at itinerary selection'));
    const number = data?.number || flight?.querySelector('.segment-carrier span')?.textContent?.match(/[A-Z0-9]+\s*\d+/i)?.[0] || '';
    return `<div class="fare-detail-table"><div class="fare-head"><span>Passenger</span><span>Fare type</span><span>Fare amount</span><span>Taxes</span><span>Total</span></div><div class="fare-value"><strong>ADT</strong><span>${fare.fareType || fare.seatName || 'Public fare'}</span><span>${data ? money(fare.baseFare ?? fare.seatPrice) : 'Verified before issue'}</span><span>${data ? money(fare.taxes) : 'Verified before issue'}</span><strong>${total}</strong></div></div><button type="button" class="passenger-price-details" data-flight-number="${number.replace(/\s/g, '')}">ⓘ Details per passenger</button>`;
  };

  const currentCounts = () => ({
    adults: Math.max(1, Number(document.querySelector('#adults')?.value) || 1),
    children: Math.max(0, Number(document.querySelector('#children')?.value) || 0),
    infants: Math.max(0, Number(document.querySelector('#infants')?.value) || 0)
  });
  const price = value => Number.isFinite(Number(value)) && typeof quoteMnt === 'function' ? quoteMnt(value) : '—';
  const openPassengerPriceDetails = number => {
    const flight = flightsByNumber.get(String(number).replace(/\s/g, ''));
    const fare = flight?.fare || flight?.spring?.fare || flight?.spring || {};
    const counts = currentCounts();
    const base = Number(fare.baseFare ?? fare.seatPrice ?? 0);
    const taxes = Number(fare.taxes ?? 0);
    const adultRows = counts.adults ? `<tr><td>${counts.adults} <b>ADT</b></td><td>${flight?.departure?.id || '—'}–${flight?.arrival?.id || '—'}</td><td>${fare.fareType || fare.seatName || 'Public fare'}</td><td>${price(base * counts.adults)}</td><td>${price(taxes * counts.adults)}</td><td><strong>${price((base + taxes) * counts.adults)}</strong></td></tr>` : '';
    const pendingRow = (count, type) => count ? `<tr class="price-pending"><td>${count} <b>${type}</b></td><td>${flight?.departure?.id || '—'}–${flight?.arrival?.id || '—'}</td><td>Live verification required</td><td>—</td><td>—</td><td>—</td></tr>` : '';
    const adultTotal = (base + taxes) * counts.adults;
    let modal = document.querySelector('#passenger-price-modal');
    if (!modal) { modal = document.createElement('dialog'); modal.id = 'passenger-price-modal'; document.body.append(modal); }
    const hasPending = counts.children || counts.infants;
    modal.innerHTML = `<section class="passenger-price-modal-content"><button type="button" class="close" aria-label="Close">×</button><h2>Price details</h2><p class="price-detail-total">${hasPending ? 'Adult subtotal:' : 'Total for all passengers:'} <strong>${price(adultTotal)}</strong> <span>(including taxes and fees)</span></p><div class="price-detail-table-wrap"><table><thead><tr><th>Passenger</th><th>Bounds</th><th>Fare basis</th><th>Fare amount</th><th>Taxes</th><th>Total</th></tr></thead><tbody>${adultRows}${pendingRow(counts.children, 'CHD')}${pendingRow(counts.infants, 'INF')}</tbody><tfoot><tr><th colspan="3">${hasPending ? 'Confirmed adult amount' : 'Total amounts'}</th><th>${price(base * counts.adults)}</th><th>${price(taxes * counts.adults)}</th><th>${price(adultTotal)}</th></tr></tfoot></table></div>${hasPending ? '<p class="price-detail-note">Spring availability returned an adult-seat fare only. Child and infant fares will be populated from the supplier’s <b>getSpecificPriceNew</b> verification response before booking.</p>' : ''}</section>`;
    modal.querySelector('.close').addEventListener('click', () => modal.close());
    modal.showModal();
  };
  const buildLeg = source => {
    const carrier = text(source.querySelector('.segment-carrier span'), 'Flight');
    const carrierIcon = source.querySelector('.segment-carrier img')?.outerHTML || '&#9992;';
    const points = [...source.querySelectorAll('.segment-point')];
    const departure = points[0]; const arrival = points[1];
    const duration = text(source.querySelector('.segment-line b'), 'Flight');
    const meta = text(source.querySelector('.segment-meta'), 'Economy');
    const baggage = text(source.querySelector('.segment-baggage span'), 'Baggage allowance is not provided for this fare.');
    const point = (label, node) => `<div class="rich-point"><small>${label}</small><strong>${text(node?.querySelector('strong'), '')}</strong><span>${text(node?.querySelector('span'), '')}</span></div>`;
    return `<section class="rich-leg"><div class="rich-leg-main"><div class="rich-carrier"><span class="rich-plane">${carrierIcon}</span><div><b>${carrier}</b><small>${meta}</small></div></div><div class="rich-leg-points">${point('DEPARTURE', departure)}<div class="rich-duration"><b>${duration}</b><i></i><small>Nonstop</small></div>${point('ARRIVAL', arrival)}</div><div class="rich-info-row"><span><span class="rich-info-label">AIRCRAFT / CABIN</span><strong>${meta}</strong></span></div><div class="rich-baggage"><b>Baggage information</b><br><span>${baggage}</span></div></div><aside class="rich-services"><h4>Included</h4><p>${baggage}</p><h4>Fare conditions</h4><p>Change, refund and no-show rules are confirmed from Spring before ticket issuance.</p></aside></section>`;
  };
  const enhance = detail => {
    if (detail.dataset.richDetails === 'true') return;
    const legs = [...detail.querySelectorAll('.segment-detail')];
    if (!legs.length) return;
    const route = detail.querySelector('.detail-route')?.outerHTML || '';
    detail.dataset.richDetails = 'true';
    detail.classList.add('rich-details-ui');
    detail.innerHTML = fareFor(detail) + route + legs.map((leg, index) => buildLeg(leg) + (index < legs.length - 1 ? '<div class="rich-connection">Connection</div>' : '')).join('');
  };
  document.addEventListener('click', event => {
    const priceButton = event.target.closest('.passenger-price-details');
    if (priceButton) { openPassengerPriceDetails(priceButton.dataset.flightNumber); return; }
    const button = event.target.closest('.segment-toggle');
    if (!button) return;
    const detail = document.querySelector('#' + button.dataset.detailId);
    if (detail) setTimeout(() => enhance(detail), 0);
  });
  new MutationObserver(() => document.querySelectorAll('.segment-details').forEach(enhance)).observe(document.body, { childList: true, subtree: true });
})();
