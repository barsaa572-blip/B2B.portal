import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createBookingDiagnostic, safeSpringCode, springRequestError } from '../backend/booking-diagnostic.mjs';
import { createSpringClient } from '../backend/spring-client.mjs';
import { BookingReviewRequired } from '../backend/booking-review.mjs';

test('diagnostic emits only fixed fields and strict provider codes, never private errors', () => {
  const lines = [];
  const diagnostic = createBookingDiagnostic({ write: line => lines.push(line) });
  diagnostic.step('secret-stage-token');
  const error = springRequestError('PRIVATE passenger, passport, token, URL and payload', 'AUTH-004', 403);
  error.name = 'PRIVATE_NAME'; error.stack = 'PRIVATE_STACK'; error.body = { secret: 'PRIVATE_BODY' };
  assert.equal(diagnostic.fail(error), diagnostic.id);
  const record = JSON.parse(lines[0].slice('NEXAHUB_BOOKING_DIAGNOSTIC '.length));
  assert.deepEqual(record, { id: diagnostic.id, stage: 'authentication', supplierAttempted: false,
    supplierReferenceReceived: false, kind: 'Error', springCode: 'AUTH-004', springHttpStatus: 403 });
  assert.doesNotMatch(lines.join(''), /PRIVATE|secret-stage|passenger|passport|payload/);
  for (const value of ['jwt.token', '0123456789abcdef', 'secret-value', 'AUTH-004\nSECRET', {}, null, '120403279']) assert.equal(safeSpringCode(value), null);
  assert.equal(safeSpringCode(1001), '1001');
  error.springCode = 'PRIVATE_TOKEN'; error.springHttpStatus = 'PRIVATE_STATUS';
  diagnostic.fail(error);
  assert.doesNotMatch(lines[1], /PRIVATE/);
});

test('diagnostic logger failures never alter the booking error or reset mutation state', () => {
  const diagnostic = createBookingDiagnostic({ write: () => { throw Error('logger failed'); } });
  diagnostic.step('supplier_booking'); diagnostic.step('portal_save');
  assert.doesNotThrow(() => diagnostic.fail(Error('private')));
});

test('Spring JSON and token failures carry safe structured code/status without logging provider text', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ ifSuccess: 'N', errCode: 'AUTH-004', errMsg: 'PRIVATE_SUPPLIER_MESSAGE' }), { status: 403 });
  const client = createSpringClient({ SPRING_HTTP_BASE_URL: 'https://mock.invalid', SPRING_OAUTH_CLIENT_ID: 'fixture', SPRING_OAUTH_CLIENT_SECRET: 'fixture' });
  for (const operation of [() => client.getAccessToken(), () => client.bookOrder({}, 'fixture-token')]) {
    await assert.rejects(operation(), error => error.springCode === 'AUTH-004' && error.springHttpStatus === 403);
  }
});

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const booking = source.slice(source.indexOf('async function createLiveSpringBooking'), source.indexOf('async function prepareRetailIssue'));
function fixture(failingStage) {
  let calls = 0, saves = 0, consumed = false;
  const lines = [], diagnostic = createBookingDiagnostic({ write: line => lines.push(line) });
  const fail = stage => { if (stage === failingStage) throw springRequestError('PRIVATE_DATA', 'ORDER-005', 400); };
  const context = {
    process: { env: { SPRING_BOOKING_ENABLED: 'true' } }, BookingReviewRequired, springRequestError,
    roundingEnabled: () => true, assertRetailSchemaReady: async () => fail('pricing_schema'),
    cleanBookingItinerary: value => { fail('input_cleanup'); return value; }, cleanPassengers: value => value,
    getSpringStatus: () => ({ httpJsonReady: true }), createSpringBookingPayload: () => { fail('spring_payload'); return { adultNum: 1 }; },
    priceSelection: () => ({}), priceRequest: () => ({}), verifiedPrice: () => ({ total: 100 }),
    priceQuotes: { require: () => { if (consumed) throw Error('quote consumed'); return { total: 100 }; }, requireRetail: () => ({}), consume: () => { consumed = true; } },
    createSpringClient: () => ({ getAccessToken: async () => { fail('spring_token'); return { accessToken: 'PRIVATE_TOKEN' }; },
      getSpecificPrice: async () => { fail('price_verification'); return {}; }, bookOrder: async () => { calls++; fail('supplier_booking'); return failingStage === 'supplier_response' ? {} : { pnr: 'PRIVATE_PNR' }; } }),
    springOrderReference: result => result.pnr,
    createPortalBooking: async () => { saves++; fail('portal_save'); return { pnr: 'PRIVATE_PNR' }; }
  };
  vm.createContext(context); vm.runInContext(booking, context);
  return { lines, diagnostic, context, counts: () => ({ calls, saves, consumed }) };
}
test('actual booking stages distinguish no supplier attempt, uncertain outcome and local save failure', async () => {
  for (const stage of ['pricing_schema', 'input_cleanup', 'spring_payload', 'spring_token', 'supplier_booking', 'supplier_response', 'portal_save']) {
    const f = fixture(stage);
    await assert.rejects(f.context.createLiveSpringBooking({ id: 'PRIVATE_ACTOR' }, { itinerary: { flights: [{}] } }, f.diagnostic), error => {
      assert.ok(!(error instanceof BookingReviewRequired)); f.diagnostic.fail(error); return true;
    });
    const record = JSON.parse(f.lines[0].slice('NEXAHUB_BOOKING_DIAGNOSTIC '.length));
    assert.equal(record.stage, stage);
    assert.equal(record.supplierAttempted, ['supplier_booking', 'supplier_response', 'portal_save'].includes(stage));
    assert.equal(record.supplierReferenceReceived, stage === 'portal_save');
    assert.doesNotMatch(f.lines.join(''), /PRIVATE|accessToken|pnr|passenger/);
    assert.equal(f.counts().calls, record.supplierAttempted ? 1 : 0);
    if (record.supplierAttempted) {
      await assert.rejects(f.context.createLiveSpringBooking({}, { itinerary: { flights: [{}] } }), /quote/);
      assert.equal(f.counts().calls, 1, 'Consumed quote must not replay supplier reservation');
    }
  }
});

test('diagnostics do not change successful booking payload, totals or number of supplier/save calls', async () => {
  const f = fixture(null);
  await f.context.createLiveSpringBooking({}, { itinerary: { flights: [{}] } }, f.diagnostic);
  assert.deepEqual(f.counts(), { calls: 1, saves: 1, consumed: true });
  assert.equal(f.lines.length, 0);
});

test('price review retains safe provider metadata without sending reservation or exposing provider message', async () => {
  const f = fixture('price_verification');
  await assert.rejects(f.context.createLiveSpringBooking({}, { itinerary: { flights: [{}] } }, f.diagnostic), error => {
    assert.ok(error instanceof BookingReviewRequired);
    assert.doesNotMatch(error.message, /PRIVATE/);
    f.diagnostic.fail(error); return true;
  });
  const record = JSON.parse(f.lines[0].slice('NEXAHUB_BOOKING_DIAGNOSTIC '.length));
  assert.equal(record.stage, 'price_verification'); assert.equal(record.springCode, 'ORDER-005');
  assert.equal(record.supplierAttempted, false);
  assert.deepEqual(f.counts(), { calls: 0, saves: 0, consumed: false });
});

test('only reservation POST gets diagnostic ID; browser only displays UUID and retains fail-closed lock', () => {
  assert.match(source, /url\.pathname === '\/api\/bookings' && req\.method === 'POST' \? createBookingDiagnostic\(\) : null/);
  assert.match(source, /bookingDiagnostic\?\.fail\(error\)/);
  assert.match(source, /code: 'BOOKING_FAILED', diagnosticId/);
  assert.doesNotMatch(source, /console\.warn\(`Spring booking rejected|console\.warn\('Spring booking response/);
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /Support ID: \$\{data\.diagnosticId\}/);
  assert.match(app, /bookingReviewAllowed = false/);
  assert.match(app, /if \(!bookingReviewAllowed\) bookingQuoteError = 'Review existing bookings/);
});

test('actual browser submission displays support UUID, preserves inputs and cannot replay an uncertain booking', async () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('const createPortalBookingFromForm ='), app.indexOf('// Capture the booking button click'));
  const id = '00000000-0000-4000-8000-000000000001';
  for (const diagnosticId of [id, 'PRIVATE_PROVIDER_TEXT']) {
    const submit = { disabled: false }, messages = [];
    const fields = { 'last-name': 'FIXTURE', 'first-name': 'TEST', 'date-of-birth': '1990-01-01',
      'document-type': 'passport', 'document-number': 'FIXTURE', nationality: 'Mongolia',
      'document-expiry': '2035-01-01', gender: 'male' };
    const card = { dataset: { passengerType: 'Adult' }, querySelector: selector => ({ value: fields[selector.match(/name="([^"]+)"/)[1]] || '' }) };
    const form = { querySelectorAll: () => [card], querySelector: selector => selector === '.issue-ticket' ? submit :
      ({ value: ({ 'contact-country-code': '+976', 'contact-phone': '12345678', 'contact-name': 'TEST', 'contact-email': 'test@example.invalid' })[selector.match(/name="([^"]+)"/)?.[1]] || '' }) };
    let calls = 0;
    const context = { bookingSubmissionPending: false, bookingReviewAllowed: true, bookingQuote: {}, bookingQuoteError: '',
      currentBookingQuote: () => ({ quoteId: 'fixture', total: 100 }), clearFormErrors() {}, validateSplitDateControls: () => null,
      validateRequiredFields: () => null, passengerValidationError: () => null, dateOnly: value => value,
      selectedOutbound: { departure: { id: 'AAA' }, arrival: { id: 'BBB' } }, selectedReturn: null,
      document: { querySelector: selector => ({ value: selector === '#outbound-date' ? '2027-03-22' : '' }) },
      secureFetch: async () => { calls++; return { ok: false, status: 403, text: async () => JSON.stringify({ error: 'Booking failed. Check existing bookings.', diagnosticId }) }; },
      toast: message => messages.push(message), refreshBookingPricePanel() {} };
    vm.createContext(context); vm.runInContext(code + ';globalThis.book=createPortalBookingFromForm', context);
    await context.book({ preventDefault() {}, currentTarget: form });
    assert.equal(calls, 1); assert.equal(submit.disabled, true); assert.equal(context.bookingReviewAllowed, false);
    assert.equal(fields['first-name'], 'TEST'); assert.equal(context.bookingQuote, null);
    assert.equal(messages[0].includes('Support ID:'), diagnosticId === id);
    assert.doesNotMatch(messages[0], /PRIVATE_PROVIDER_TEXT/);
    await context.book({ preventDefault() {}, currentTarget: form });
    assert.equal(calls, 1, 'Disabled ambiguous-result submission must never replay');
  }
});
