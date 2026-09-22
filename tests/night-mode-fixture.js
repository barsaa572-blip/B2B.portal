// Seed fake data before authentication in the local-only preview harness.
document.querySelector('#auth-root').hidden = true;
sessionStorage.setItem('flightb2b-session', JSON.stringify({ accessToken: 'qa-only', profile: { id: 'qa', role: 'platform_admin', full_name:'Preview User' } }));
document.documentElement.dataset.theme = 'dark';
activePassengerCounts = { adults: 1, children: 1, infants: 1 };
pricingRate = { effectiveRateMnt: 540.8 };
for (const id of ['adults', 'children', 'infants']) {
  document.querySelector(`#${id}`).value = '1';
  document.querySelector(`#${id}`).closest('.counter')?.querySelector('output')?.replaceChildren('1');
}
document.querySelector('#outbound-date').value = '2027-03-21';
const qaFares = ['R1', 'E'].map((id, i) => ({ id, fareType: id, cabin: 'Economy', baseFare: 800, taxes: 200, total: 1000,
  baggage: { cabinKg: 7, checkedKg: i ? 0 : 20 }, rules: [1, 2].map(type => ({ type, entries: [{ value: 100, valueType: 1, start: null, end: null }] })),
  spring: { segHeadId: 1, combId: i + 1, combType: 1, combPrice: 1000, adultCabin: id, cabinType: 3, moneyClassId: 0 }
}));
const qaFlight = { airline: 'Spring Airlines', number: '9C7058', departure: { id: 'UBN', time: '13:00' }, arrival: { id: 'PVG', time: '17:00' }, duration: 240, fare: qaFares[0], fareOptions: qaFares, spring: qaFares[0].spring, price: 1000 };
showView('search');
void showFareOptions(qaFlight, 'outbound');
const qaCheckout = document.createElement('button');
qaCheckout.className = 'nav-link'; qaCheckout.textContent = 'QA: passenger details';
qaCheckout.onclick = () => { selectedOutbound = qaFlight; selectedReturn = null; prepareBookingScreen(); };
document.querySelector('.sidebar nav').append(qaCheckout);
