const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.argv[2] ? path.resolve(process.argv[2]) : 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage(), calls = [];
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/api/auth/accept-invite') {
        calls.push(request.postDataJSON());
        return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="auth-root"></div></body></html>' });
      return route.abort();
    });
    const load = async fragment => {
      await page.goto(`http://127.0.0.1:4199/${fragment}`);
      for (const file of ['dompurify.js', 'safe-html.js', 'auth.js']) await page.addScriptTag({ path: path.join(root, file) });
    };
    await load('#invite_token=' + 'a'.repeat(64));
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(calls.length, 0); // GET/scanner visits do not consume a link.
    await page.locator('[name="newPassword"]').fill('TestPassword1!');
    await page.locator('[name="confirmPassword"]').fill('Mismatch1!');
    await page.locator('[type="submit"]').click();
    assert.equal(calls.length, 0);
    await page.locator('[name="confirmPassword"]').fill('TestPassword1!');
    await page.locator('[type="submit"]').click();
    await page.waitForSelector('#login-email');
    assert.deepEqual(calls[0], { tokenHash: 'a'.repeat(64), newPassword: 'TestPassword1!', confirmPassword: 'TestPassword1!' });
    assert.match(await page.locator('.auth-error').textContent(), /password is ready/);
    assert.equal(await page.evaluate(() => sessionStorage.length + localStorage.length), 0);
    console.log('PASS: invitation is human-submitted, URL cleared and storage stays token-free');
    await load('#error=access_denied&error_code=otp_expired');
    assert.equal(new URL(page.url()).hash, '');
    assert.match(await page.locator('.auth-error').textContent(), /outdated/);
    await load('#access_token=fake-legacy&refresh_token=fake-legacy&type=invite');
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(calls.length, 1);
    assert.equal(await page.evaluate(() => sessionStorage.length + localStorage.length), 0);
    console.log('PASS: expired/legacy links display safe errors without importing bearer tokens');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
