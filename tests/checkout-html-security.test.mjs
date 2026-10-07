import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
test('refreshed price panel escapes supplier baggage text AND routes through sanitizer', () => {
  const builders = source.slice(source.indexOf('const baggageSummary ='), source.indexOf('const retailTotalMnt ='));
  const refresh = source.slice(source.indexOf('const refreshBookingPricePanel ='), source.indexOf('const verifyBookingPrice ='));
  let captured, calls = 0;
  const panel = { set outerHTML(v) { captured = v; }, addEventListener() {} };
  vm.runInNewContext(builders + '\n' + refresh + '\nrefreshBookingPricePanel();', {
    selectedOutbound: { fare: { baggage: { personalItem: '<img onerror="attack()">', cabinKg: '<b>bad</b>', checkedKg: 20 } } },
    selectedReturn: null, currentBookingQuote: () => null, bookingQuoteError: '', bookingReviewAllowed: false,
    bookingQuoteLoading: false, bookingSubmissionPending: false,
    escapeHtml: v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    safeHtml: v => { calls++; return v; }, document: { querySelector: s => s === '.booking-price-panel' ? panel : null }
  });
  assert.equal(calls, 1);
  assert.doesNotMatch(captured, /<img|<b>bad/);
  assert.match(captured, /&lt;img/);
  assert.match(captured, /20 kg included/);
});
test('all dynamic HTML assignments in public application scripts use the sanitizer', () => {
  for (const file of ['app.js','auth.js','admin.js','team.js','interface.js','flight-detail-card.js']) {
    const ast = parse(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { ecmaVersion: 'latest' });
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression'
        && ['innerHTML','outerHTML'].includes(node.left.property.name)) {
        assert.equal(node.right.type, 'CallExpression', file + ': HTML assignment bypasses sanitizer');
        assert.equal(node.right.callee.name, 'safeHtml', file + ': HTML assignment bypasses sanitizer');
      }
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
    };
    walk(ast);
  }
});
