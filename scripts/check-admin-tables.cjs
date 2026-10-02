// Real browser regression with the actual admin HTML/CSS/renderer; fake APIs only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.argv[2] ? path.resolve(process.argv[2]) : 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1124, height: 940 } });
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = [...index.matchAll(/href="([^"?]+\.css)(?:\?[^"\s]*)?"/g)]
      .map(match => fs.readFileSync(path.join(root, match[1]), 'utf8')).join('\n');
    const overview = {
      agencies: [{ id: 'agency-a', name: 'AIR SALES', active: true },
        { id: 'agency-b', name: 'AIR TICKET', active: true }], branches: [],
      wallets: [{ agency_id: 'agency-a', balance_cny: 0 }, { agency_id: 'agency-b', balance_cny: 1245.67 }],
      profiles: [
        { id: 'user-a', full_name: 'Altanzaya', email: 'altanzaya@example.invalid', agency_id: 'agency-b', role: 'office_manager', active: true },
        { id: 'user-b', full_name: 'Barsbold', email: 'barsbold@example.invalid', role: 'platform_admin', active: true },
        { id: 'user-c', full_name: 'Otgonbayar', email: 'otgonbayar@example.invalid', agency_id: 'agency-a', role: 'office_manager', active: true }
      ], topups: [], statistics: {}
    };
    const writes = [];
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      const data = url.pathname === '/api/admin/overview' ? overview :
        url.pathname === '/api/fx/cny-mnt' ? { effectiveRateMnt: 540.8 } : null;
      return data ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }) : route.abort();
    });
    await page.goto('http://127.0.0.1:4199/');
    await page.addStyleTag({ content: css });
    await page.addStyleTag({ content: 'body{padding:20px}#administration{margin:auto}.admin-view{display:block}' });
    await page.evaluate(html => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const admin = parsed.querySelector('#administration');
      document.body.classList.add('role-platform');
      document.body.append(document.importNode(admin, true));
      const toast = document.createElement('div'); toast.id = 'toast'; document.body.append(toast);
      sessionStorage.setItem('flightb2b-session', JSON.stringify({ accessToken: 'cookie', profile: { id: 'test-admin', role: 'platform_admin' } }));
    }, index);
    for (const file of ['dompurify.js', 'safe-html.js', 'admin.js']) await page.addScriptTag({ path: path.join(root, file) });
    await page.waitForSelector('#agency-list > tr > td');
    assert.equal(await page.locator('#agency-list > tr').count(), 2);
    assert.equal(await page.locator('#user-list > tr').count(), 3);
    assert.equal(await page.locator('#admin-topups > tr > td[colspan="6"]').count(), 1);
    assert.equal(await page.locator('[data-user-id="user-b"].user-invite').count(), 0);
    await page.evaluate(() => {
      // Match the user's screenshot crop, while retaining all actual panel markup.
      document.querySelector('#administration > .section-heading').style.display = 'none';
      document.querySelectorAll('#administration > .admin-stats').forEach(stats => { stats.style.display = 'none'; });
    });
    const checkLayout = async () => {
      const results = await page.evaluate(() => [...document.querySelectorAll('.admin-panel table')].map(table => {
        const headers = [...table.tHead.rows[0].cells];
        return [...table.tBodies[0].rows].every(row => row.cells.length === 1
          ? row.cells[0].colSpan === headers.length
          : row.cells.length === headers.length && [...row.cells].every((cell, index) =>
            Math.abs(cell.getBoundingClientRect().left - headers[index].getBoundingClientRect().left) < 1));
      }));
      assert.ok(results.every(Boolean), 'Admin cells must align with their column headers.');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Only the table wrapper, not the whole page, may scroll horizontally.');
    };
    await checkLayout();
    const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'nexahub-admin-layout-'));
    await page.screenshot({ path: path.join(screenshots, 'desktop-light.png'), fullPage: true, animations: 'disabled' });
    console.log('PASS: desktop rows, columns, empty invoice state and platform-admin actions');
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await checkLayout();
    await page.screenshot({ path: path.join(screenshots, 'desktop-dark.png'), fullPage: true, animations: 'disabled' });
    console.log('PASS: dark theme table layout');
    await page.setViewportSize({ width: 390, height: 844 });
    await checkLayout();
    assert.equal(await page.locator('#admin-topups .no-bookings').evaluate(cell => getComputedStyle(cell).textAlign), 'left', 'Empty state should remain readable without horizontal scrolling.');
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.admin-panel .table-wrap')]
      .every(wrap => wrap.scrollWidth > wrap.clientWidth && getComputedStyle(wrap).overflowX === 'auto')));
    await page.screenshot({ path: path.join(screenshots, 'mobile-dark.png'), fullPage: true, animations: 'disabled' });
    console.log('PASS: mobile table scrolling without page overflow');
    overview.topups = [{ id: 'topup-a', invoice_number: 'INV-TEST-0001', agency_id: 'agency-a', amount_mnt: 1000000,
      amount_cny: 1858.39, total_mnt: 1061905, status: 'pending' }];
    await page.evaluate(() => window.loadAdministration());
    await page.waitForSelector('#admin-topups .topup-approve');
    assert.equal(await page.locator('#admin-topups > tr > td').count(), 6);
    assert.equal(await page.locator('#admin-topups .admin-action-group > button').count(), 2);
    await checkLayout();
    assert.deepEqual(writes, [], 'Layout checks must never send email or change financial records.');
    console.log('PASS: pending invoice actions stay in one cell; no API writes');
    console.log(`Screenshots: ${screenshots}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
