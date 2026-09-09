const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const start = source.indexOf("document.querySelector('#search-form').addEventListener('submit'");
const end = source.indexOf('\nbindFlightButtons();', start);
assert.ok(start >= 0 && end > start);
assert.doesNotMatch(source, /mockFlight|mockSearchResults|showMockSearch/);

async function run(fetchImpl, trip = 'oneway') {
  let submit;
  const resultArea = { innerHTML: 'old selectable flights', classList: { remove() {} } };
  const button = { disabled: false, textContent: 'Search flights' };
  const nodes = {
    '#search-form': { addEventListener: (_, fn) => { submit = fn; } },
    '#departure': { value: 'ULN' }, '#arrival': { value: 'PVG' },
    '#outbound-date': { value: '2026-09-20' }, '#return-date': { value: '2026-09-25' },
    '#adults': { value: '1' }, '#children': { value: '0' }, '#infants': { value: '0' }
  };
  const rendered = []; const messages = [];
  const context = {
    document: { querySelector: key => nodes[key] }, resultArea, URLSearchParams,
    outboundDateInput: nodes['#outbound-date'], returnDateInput: nodes['#return-date'],
    tripType: trip, passengerCounts: () => ({ adults: 1 }),
    visibleFlights: ['old'], selectedOutbound: {}, selectedReturn: {}, roundReturnFlights: [{}],
    toast: message => messages.push(message),
    escapeHtml: value => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    renderFlights: results => rendered.push(results),
    fetch: async () => {
      assert.equal(resultArea.innerHTML.includes('old selectable'), false);
      assert.equal(context.visibleFlights.length, 0);
      assert.equal(button.disabled, true);
      return fetchImpl();
    }
  };
  vm.runInNewContext(source.slice(start, end), context);
  await submit({ preventDefault() {}, currentTarget: { querySelector: () => button } });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Search flights');
  return { context, resultArea, rendered, messages };
}

for (const trip of ['oneway', 'round']) {
  for (const failure of ['502', 'network', 'invalid-json']) {
    test(`${trip}: ${failure} clears results and never invents flights`, async () => {
      const result = await run(() => {
        if (failure === 'network') throw new Error('fetch failed');
        return { ok: false, json: async () => {
          if (failure === 'invalid-json') throw new Error('Invalid JSON');
          return { error: '<script>bad</script>' };
        } };
      }, trip);
      assert.equal(result.rendered.length, 0);
      assert.equal(result.context.visibleFlights.length, 0);
      assert.equal(result.context.selectedOutbound, null);
      assert.equal(result.context.selectedReturn, null);
      assert.equal(result.context.roundReturnFlights.length, 0);
      assert.match(result.resultArea.innerHTML, /role="alert"/);
      assert.doesNotMatch(result.resultArea.innerHTML, /<script>/);
      assert.equal(result.messages.length, 1);
    });
  }
  test(`${trip}: successful and empty responses use actual results`, async () => {
    for (const results of [[], [{ number: 'real-flight' }]]) {
      const result = await run(() => ({ ok: true, json: async () => ({ results, roundPairs: [] }) }), trip);
      assert.deepEqual(result.rendered, [results]);
      assert.equal(result.messages.length, 0);
    }
  });
}
