// Optional headless UI check. Pass the installed Playwright package path as argv[2].
// All API traffic is intercepted locally; no supplier or financial actions occur.
const { chromium } = require(process.argv[2] || 'playwright');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!/^[a-z0-9.-]+$/i.test(name)) { res.writeHead(404); return res.end(); }
    try { res.setHeader('content-type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html'); res.end(readFileSync(path.join(root, name))); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.FARE_TEST_BROWSER_CHANNEL ? { channel: process.env.FARE_TEST_BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let data = {};
      if (url.pathname === '/api/bookings' || url.pathname === '/api/topups') data = [];
      if (url.pathname === '/api/fx/cny-mnt') data = { effectiveRateMnt: 1, topupRateMnt: 1, currency: 'CNY' };
      if (url.pathname.startsWith('/api/flights/price')) {
        const body = route.request().postDataJSON();
        const price = flights => {
          const base = flights.reduce((sum, f) => sum + ({ R2: 1000, R1: 1200, E: 900 }[f.spring.adultCabin]), 0);
          const breakdown = [['adults', base], ['children', base / 2], ['infants', 10]].map(([type, value]) => ({ type, count: body.passengers[type], fare: value * body.passengers[type], taxes: 0, total: value * body.passengers[type] })).filter(row => row.count);
          return { currency: 'CNY', breakdown, total: breakdown.reduce((sum, row) => sum + row.total, 0) };
        };
        data = body.selections ? { results: body.selections.map(flights => ({ price: price(flights) })) } : { ...price(body.flights), quoteId: 'local-only', expiresAt: Date.now() + 60000 };
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.addInitScript(() => sessionStorage.setItem('flightb2b-session', JSON.stringify({ accessToken: 'local-fake', expiresAt: Date.now() + 3600000, profile: { id: 'local', role: 'agent', agency_id: 'local', active: true } })));
    await page.goto(origin);
    await page.evaluate(() => {
      showView('search');
      activePassengerCounts = { adults: 1, children: 1, infants: 1 };
      for (const id of ['adults', 'children', 'infants']) document.querySelector(`#${id}`).value = '1';
      document.querySelector('#outbound-date').value = '2027-03-21';
      const fares = ['R2', 'R1', 'E'].map((id, index) => ({ id, fareType: id, cabin: 'Economy', baseFare: [1000, 1200, 900][index], total: [1000, 1200, 900][index], taxes: 0, baggage: { cabinKg: 7, checkedKg: id === 'E' ? 0 : 20 }, rules: [1, 2].map(type => ({ type, entries: [{ value: 100, valueType: 1, start: null, end: null }] })), spring: { segHeadId: 1, combId: index + 1, combType: 1, combPrice: [1000, 1200, 900][index], adultCabin: id, cabinType: 3, moneyClassId: 0 } }));
      window.localFlight = { airline: 'Spring Airlines', number: '9C7058', departure: { id: 'UBN', time: '13:00' }, arrival: { id: 'PVG', time: '17:00' }, duration: 240, fare: fares[0], fareOptions: fares, spring: fares[0].spring, price: 1000 };
      renderFlights([window.localFlight]);
    });
    await page.locator('.flight .passenger-price').waitFor();
    await page.locator('.flight .passenger-price').hover();
    await page.locator('.passenger-price-popover:not([hidden])').waitFor();
    assert.match(await page.locator('.passenger-price-popover').innerText(), /Child × 1/);
    await page.mouse.move(0, 0);
    assert.equal(await page.locator('.passenger-price-popover').isVisible(), false);
    await page.evaluate(() => showFareOptions(window.localFlight, 'outbound'));
    assert.equal(await page.locator('.fare-family-choice').count(), 2);
    assert.match(await page.locator('.fare-family-choice').first().innerText(), /E class/);
    const total = await page.evaluate(() => quoteMnt(1360));
    assert.ok((await page.locator('.fare-family-choice').first().innerText()).includes(total));
    await page.locator('.fare-family-choice').first().locator('.passenger-price').hover();
    await page.locator('.passenger-price-popover:not([hidden])').waitFor();
    assert.match(await page.locator('.passenger-price-popover').innerText(), /Infant × 1/);
    if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.passenger-price-popover').isVisible(), false);
    await page.evaluate(() => {
      selectedOutbound = window.localFlight;
      selectedReturn = { ...window.localFlight, departure: { id: 'PVG', time: '08:00' }, arrival: { id: 'UBN', time: '12:00' }, fareOptions: window.localFlight.fareOptions.map(fare => ({ ...fare, spring: { ...fare.spring, segHeadId: 2 } })) };
      document.querySelector('#return-date').value = '2027-03-27';
      return showRoundFareOptions();
    });
    assert.equal(await page.locator('.fare-family-choice').count(), 2);
    assert.match(await page.locator('.fare-family-choice').first().innerText(), /E \+ E class/);
    assert.ok((await page.locator('.fare-family-choice').first().innerText()).includes(await page.evaluate(() => quoteMnt(2710))));
    await page.locator('.fare-family-choice').last().click();
    await page.locator('.fare-family-choice').last().locator('.passenger-price').focus();
    await page.locator('.passenger-price-popover:not([hidden])').waitFor();
    assert.match(await page.locator('.passenger-price-popover').innerText(), /Child × 1/);
    console.log('PASS: flight, one-way and round-trip totals/grouping; hover, hide and keyboard tooltip');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
