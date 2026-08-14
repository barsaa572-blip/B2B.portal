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
    return `<div class="fare-detail-table"><div class="fare-head"><span>Passenger</span><span>Fare type</span><span>Fare amount</span><span>Taxes</span><span>Total</span></div><div class="fare-value"><strong>ADT</strong><span>${fare.fareType || fare.seatName || 'Public fare'}</span><span>${data ? money(fare.baseFare ?? fare.seatPrice) : 'Verified before issue'}</span><span>${data ? money(fare.taxes) : 'Verified before issue'}</span><strong>${total}</strong></div></div>`;
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
    const button = event.target.closest('.segment-toggle');
    if (!button) return;
    const detail = document.querySelector('#' + button.dataset.detailId);
    if (detail) setTimeout(() => enhance(detail), 0);
  });
  new MutationObserver(() => document.querySelectorAll('.segment-details').forEach(enhance)).observe(document.body, { childList: true, subtree: true });
})();
