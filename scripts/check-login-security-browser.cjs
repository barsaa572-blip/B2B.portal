// Isolated browser test: every request is intercepted; no real email/accounts.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.argv[2] ? path.resolve(process.argv[2]) : 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const errors = [], calls = [];
    page.on('pageerror', error => errors.push(error.message));
    let renew = true, badCode = true;
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="auth-root"></div></body></html>' });
      if (!url.pathname.startsWith('/api/auth/')) return route.abort();
      calls.push({ path: url.pathname, body: request.postDataJSON() });
      if (url.pathname === '/api/auth/login') return reply({ nextStep: 'email', expiresIn: 300, resendAfter: 60 });
      if (url.pathname === '/api/auth/verify-email') {
        if (badCode) return reply({ error: 'Invalid verification code.' }, 400);
        return reply(renew ? { nextStep: 'password', expiresIn: 280 } : { accessToken: 'cookie', refreshToken: 'cookie', expiresIn: 3600, profile: { id: 'mock', full_name: 'Mock Agent', role: 'agent' } });
      }
      if (url.pathname === '/api/auth/renew-password') { renew = false; return reply({ ok: true, signInAgain: true }); }
      return reply({ ok: true });
    });
    await page.goto('http://127.0.0.1:4199/');
    for (const name of ['styles.css', 'auth.css', 'nexahub-brand.css']) await page.addStyleTag({ path: path.join(root, name) });
    for (const name of ['dompurify.js', 'safe-html.js', 'session-activity.js', 'auth.js']) await page.addScriptTag({ path: path.join(root, name) });
    const signIn = async () => {
      await page.locator('#login-email').fill('mock@example.invalid');
      await page.locator('#login-password').fill('MockPassword1!');
      await page.locator('[type="submit"]').click();
      await page.locator('[name="code"]').waitFor();
      assert.equal(await page.evaluate(() => sessionStorage.length + localStorage.length), 0);
    };
    await signIn();
    assert.equal(await page.locator('[data-login-resend]').isDisabled(), true);
    await page.locator('[name="code"]').fill('123456'); await page.locator('[type="submit"]').click();
    await page.locator('.auth-error:not([hidden])').waitFor(); assert.match(await page.locator('.auth-error').textContent(), /Invalid/);
    badCode = false;
    await page.locator('[type="submit"]').click(); await page.locator('[name="currentPassword"]').waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    await page.locator('[name="currentPassword"]').fill('MockPassword1!');
    await page.locator('[name="newPassword"]').fill('NewMockPassword2!');
    await page.locator('[name="confirmPassword"]').fill('NewMockPassword2!');
    await page.locator('[type="submit"]').click(); await page.locator('#login-email').waitFor();
    assert.match(await page.locator('.auth-error').textContent(), /Password renewed/);
    await signIn();
    await page.locator('[name="code"]').fill('123456'); await page.locator('[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#auth-root').hidden);
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('flightb2b-session')));
    assert.equal(stored.accessToken, 'cookie'); assert.equal(stored.refreshToken, 'cookie');
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert.equal(calls.filter(c => c.path === '/api/auth/renew-password').length, 1);
    assert.deepEqual(errors, []);
    console.log('PASS: email code, error, required renewal, subsequent login and token-free storage');
    await page.evaluate(() => window.forcePortalSignOut());
    await signIn();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('[data-login-cancel]').click(); await page.locator('#login-email').waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    console.log('PASS: mobile layout and cancellation return to a clean sign-in');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
