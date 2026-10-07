// Optional real-browser regression. Supply a Playwright module path when using
// the desktop's bundled runtime; no browser package is added to production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] ? path.resolve(process.argv[2]) : 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {})
    });
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1:4199/'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
      : route.abort());
    await page.goto('http://127.0.0.1:4199/');
    await page.addScriptTag({ path: path.join(root, 'dompurify.js') });
    await page.addScriptTag({ path: path.join(root, 'safe-html.js') });
    const names = [];
    for (const file of ['app.js', 'admin.js', 'team.js', 'auth.js', 'interface.js', 'flight-detail-card.js']) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      for (const match of source.matchAll(/\b(id|name)\s*=\s*["']([^"']+)["']/g)) {
        if (!match[2].includes('${')) names.push({ file, attribute: match[1], value: match[2] });
      }
    }
    const result = await page.evaluate(names => {
      const parse = html => {
        const template = document.createElement('template');
        template.innerHTML = safeHtml(html);
        return template.content;
      };
      const attack = parse('<img src=x onerror="alert(1)"><a href="javascript:alert(1)">Link</a><iframe src="https://attacker.invalid" srcdoc="<script>alert(1)</script>"></iframe><svg onload="alert(1)"></svg><script>alert(1)</script>');
      const xss = !attack.querySelector('script,svg,object,embed') &&
        [...attack.querySelectorAll('*')].every(element =>
          [...element.attributes].every(attribute => !/^on/i.test(attribute.name) &&
            attribute.name !== 'srcdoc' && !/^\s*(javascript|vbscript):/i.test(attribute.value)) &&
          (element.tagName !== 'IFRAME' || !element.hasAttribute('src')));
      const form = parse('<label for="portal-passenger-first">Name</label><input id="portal-passenger-first" name="passengerFirstName" required><button type="button" data-action="book">Book</button>');
      const formOk = !!form.querySelector('label[for="portal-passenger-first"]') &&
        !!form.querySelector('input[name="passengerFirstName"][required]') &&
        !!form.querySelector('button[data-action="book"]');
      const input = parse('<input name="name">').querySelector('input');
      const clobberProtection = !!input && !input.hasAttribute('name');
      const href = URL.createObjectURL(new Blob(['Preview fixture'], { type: 'application/pdf' }));
      const frame = parse(`<iframe src="${href}" srcdoc="<script>alert(1)</script>"></iframe>`).querySelector('iframe');
      const preview = frame?.getAttribute('src') === href &&
        frame?.getAttribute('sandbox') === 'allow-same-origin' && !frame.hasAttribute('srcdoc');
      URL.revokeObjectURL(href);
      const remoteBlob = parse('<iframe src="blob:https://attacker.invalid/11111111-1111-1111-1111-111111111111"></iframe>').querySelector('iframe');
      const remotePreviewBlocked = !!remoteBlob && !remoteBlob.hasAttribute('src');
      const tbody = document.createElement('tbody');
      tbody.innerHTML = safeHtml('<tr><td>Agency</td><td><button data-agency-id="agency-a">Open</button></td></tr><tr><td colspan="2">Empty</td></tr>');
      const tableRows = tbody.rows.length === 2 && tbody.rows[0].cells.length === 2 &&
        tbody.rows[1].cells[0].colSpan === 2 && !!tbody.querySelector('button[data-agency-id="agency-a"]');
      const hostileRows = document.createElement('tbody');
      hostileRows.innerHTML = safeHtml('<tr><td><img src=x onerror="alert(1)"><a href="javascript:alert(1)">Link</a><script>alert(1)</script></td></tr>');
      const tableXss = hostileRows.rows.length === 1 && !hostileRows.querySelector('script,[onerror],[href^="javascript:"]');
      const formElement = document.createElement('form');
      const collisions = names.filter(entry => entry.value in document || entry.value in formElement);
      return { checks: { xss, form: formOk, clobberProtection, preview, remotePreviewBlocked, tableRows, tableXss }, collisions };
    }, names);
    for (const [name, ok] of Object.entries(result.checks)) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
    if (result.collisions.length) console.log('FAIL: potential dynamic form name collisions', JSON.stringify(result.collisions));
    assert.ok(Object.values(result.checks).every(Boolean), 'HTML security regression failed.');
    assert.equal(result.collisions.length, 0, 'Dynamic markup uses clobbering id/name values.');
    console.log('PASS: dynamic form names');

    // Actual checkout refresh with the real DOMPurify build, not a VM identity stub.
    const checkoutSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const builders = checkoutSource.slice(checkoutSource.indexOf('const baggageSummary ='), checkoutSource.indexOf('const retailTotalMnt ='));
    const refresh = checkoutSource.slice(checkoutSource.indexOf('const refreshBookingPricePanel ='), checkoutSource.indexOf('const verifyBookingPrice ='));
    await page.setContent('<aside class="booking-price-panel"></aside>');
    await page.addScriptTag({ content: `(() => {
      const selectedOutbound = { fare: { baggage: { personalItem: '<img src=x onerror="window.__checkoutAttack=true">', cabinKg: '<b>bad</b>', checkedKg: 20 } } };
      const selectedReturn = null, bookingQuoteError = '', bookingReviewAllowed = false, bookingQuoteLoading = false, bookingSubmissionPending = false;
      const currentBookingQuote = () => null;
      const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      ${builders}\n${refresh}\nrefreshBookingPricePanel();
    })();` });
    assert.equal(await page.locator('.booking-price-panel img').count(), 0);
    assert.match(await page.locator('.booking-price-panel').textContent(), /20 kg included/);
    assert.equal(await page.evaluate(() => window.__checkoutAttack === true), false);
    console.log('PASS: checkout refresh escapes supplier text and sanitizes actual DOM');

    // Exercise the actual admin renderer and submit handlers, with fake API
    // responses only. Catch mappings that a synthetic form check cannot cover.
    const requests = [];
    const overview = {
      agencies: [{ id: 'agency-a', name: 'Test Agency', registration_number: '1234567',
        email: 'agency@example.invalid', phone: '99112233', address: 'Test address', active: true }],
      branches: [], wallets: [{ agency_id: 'agency-a', balance_cny: 0 }], topups: [],
      profiles: [{ id: 'user-a', full_name: 'Test User', email: 'user@example.invalid',
        phone: '99112233', role: 'agent', agency_id: 'agency-a', active: true }], statistics: {}
    };
    await page.route('**/api/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let data;
      if (request.method() !== 'GET') {
        requests.push({ path: pathname, method: request.method(), body: request.postDataJSON() });
        if (!['/api/admin/agencies', '/api/admin/agencies/agency-a', '/api/admin/users', '/api/admin/users/user-a'].includes(pathname)) return route.abort();
        data = { ok: true };
      } else if (pathname === '/api/admin/overview') data = overview;
      else if (pathname === '/api/fx/cny-mnt') data = { effectiveRateMnt: 540.8 };
      else return route.abort();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.setContent(`<button id="add-agency">Add agency</button><button id="add-user">Add manager</button>
      <input id="agency-filter"><div id="administration"></div><div id="toast"></div>
      <span id="admin-agency-count"></span><span id="admin-user-count"></span><span id="admin-network-balance"></span>
      <table><tbody id="agency-list"></tbody></table><table><tbody id="user-list"></tbody></table>
      <table><tbody id="admin-topups"></tbody></table>`);
    await page.evaluate(() => sessionStorage.setItem('flightb2b-session', JSON.stringify({
      accessToken: 'cookie', profile: { id: 'test-admin', role: 'platform_admin' }
    })));
    await page.addScriptTag({ path: path.join(root, 'admin.js') });
    await page.waitForSelector('.agency-edit');
    assert.equal(await page.locator('#agency-list > tr > td').count(), 6);
    assert.equal(await page.locator('#user-list > tr > td').count(), 6);
    assert.equal(await page.locator('#admin-topups > tr > td[colspan="6"]').count(), 1);
    console.log('PASS: actual admin table structure');
    const submit = async (pathname, method) => {
      const response = page.waitForResponse(res => new URL(res.url()).pathname === pathname && res.request().method() === method);
      await page.locator('#admin-modal .primary').click();
      await response;
      await page.waitForFunction(() => !document.querySelector('#admin-modal').open);
      return requests.findLast(request => request.path === pathname && request.method === method).body;
    };
    await page.locator('#add-agency').click();
    for (const [name, value] of Object.entries({ agencyName: 'New Agency', registrationNumber: '1234567',
      email: 'new@example.invalid', phone: '99112233', address: 'New address' })) {
      await page.locator(`#admin-modal [name="${name}"]`).fill(value);
    }
    const createdAgency = await submit('/api/admin/agencies', 'POST');
    assert.equal(createdAgency.name, 'New Agency'); assert.ok(!Object.hasOwn(createdAgency, 'agencyName'));
    console.log('PASS: actual create-agency form');
    await page.locator('.agency-edit').click();
    await page.locator('#admin-modal [name="agencyName"]').fill('Edited Agency');
    assert.equal((await submit('/api/admin/agencies/agency-a', 'PATCH')).name, 'Edited Agency');
    console.log('PASS: actual edit-agency form');
    await page.locator('#add-user').click();
    for (const [name, value] of Object.entries({ fullName: 'Test Manager', phone: '99112233',
      email: 'manager@example.invalid' })) {
      await page.locator(`#admin-modal [name="${name}"]`).fill(value);
    }
    await page.locator('#admin-modal [name="agencyId"]').selectOption('agency-a');
    const createdManager = await submit('/api/admin/users', 'POST');
    assert.equal(createdManager.role, 'office_manager'); assert.ok(!Object.hasOwn(createdManager, 'accountRole'));
    console.log('PASS: actual create-manager form');
    await page.locator('.user-edit').click();
    await page.locator('#admin-modal [name="accountRole"]').selectOption('office_manager');
    assert.equal((await submit('/api/admin/users/user-a', 'PATCH')).role, 'office_manager');
    console.log('PASS: actual edit-user form');
  } finally {
    await browser?.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
