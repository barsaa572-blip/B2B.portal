import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { BookingReviewRequired } from '../backend/booking-review.mjs';
import { createPriceQuotes, priceSelection, verifiedPrice, priceRequest } from '../backend/spring-pricing.mjs';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const booking = source.slice(source.indexOf('async function createLiveSpringBooking'), source.indexOf('async function prepareRetailIssue'));
const flight = { spring: { segHeadId: 123, combId: 1, combType: 1, combPrice: 100, adultCabin: 'S', cabinType: 3, moneyClassId: 0 } };
const counts = { adults: 1, children: 0, infants: 0 };
const priceData = { ifSuccess: 'Y', adultTravPriceForSeg: [{ cabinPrice: 100, fuelFee: 0, portPay: 0, otherFeeSum: 0 }] };

test('only failures before booking mutation get the safe price-review error', async () => {
  const selection = priceSelection([flight], counts), quotes = createPriceQuotes();
  let prices = priceData, bookCalls = 0, timeout = false, priceTimeout = false;
  const context = { process: { env: { SPRING_BOOKING_ENABLED: 'true' } }, console,
    cleanBookingItinerary: v => v, cleanPassengers: v => v, roundingEnabled: () => false,
    getSpringStatus: () => ({ httpJsonReady: true }), createSpringBookingPayload: () => ({ adultNum: 1, childNum: 0, infantNum: 0 }),
    priceSelection, priceRequest, verifiedPrice, priceQuotes: quotes, BookingReviewRequired,
    createSpringClient: () => ({ getAccessToken: async () => ({ accessToken: 'mock' }),
      getSpecificPrice: async () => { if (priceTimeout) throw new Error('timeout'); return prices; },
      bookOrder: async () => { bookCalls++; if (timeout) throw new Error('Unknown booking outcome'); return { pnr: 'MOCK' }; } }),
    springOrderReference: r => r.pnr, createPortalBooking: async (_p, body) => body };
  vm.createContext(context); vm.runInContext(booking, context);
  const body = { itinerary: { flights: [flight] } };
  await assert.rejects(context.createLiveSpringBooking({ id: 'actor' }, body), e => e instanceof BookingReviewRequired && e.status === 409);
  body.quoteId = quotes.save('actor', selection, verifiedPrice(priceData, selection)).quoteId;
  prices = { ifSuccess: 'N' };
  await assert.rejects(context.createLiveSpringBooking({ id: 'actor' }, body), BookingReviewRequired);
  priceTimeout = true;
  await assert.rejects(context.createLiveSpringBooking({ id: 'actor' }, body), BookingReviewRequired);
  assert.equal(bookCalls, 0);
  priceTimeout = false; prices = priceData; timeout = true;
  await assert.rejects(context.createLiveSpringBooking({ id: 'actor' }, body), e => !(e instanceof BookingReviewRequired) && /Unknown/.test(e.message));
  assert.equal(bookCalls, 1);
  assert.throws(() => quotes.require(body.quoteId, 'actor', selection));
});

test('expired browser quote offers review but never auto-refreshes, submits or resets fields', async () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('const createPortalBookingFromForm ='), app.indexOf('// Capture the booking button click'));
  const button = { disabled: false }, form = { querySelector: () => button }, values = { passengerName: 'PRESERVED' };
  let refresh = 0, mutation = 0, panel = 0;
  const context = { bookingSubmissionPending: false, bookingQuoteError: '', currentBookingQuote: () => null,
    refreshBookingPricePanel: () => panel++, toast() {}, verifyBookingPrice: () => refresh++, secureFetch: () => mutation++ };
  vm.createContext(context); vm.runInContext(code + ';globalThis.book=createPortalBookingFromForm', context);
  await context.book({ preventDefault() {}, currentTarget: form });
  assert.equal(refresh, 0); assert.equal(mutation, 0); assert.equal(panel, 1); assert.equal(values.passengerName, 'PRESERVED');
  assert.match(context.bookingQuoteError, /expired/);
  assert.match(app, /data-refresh-booking-price/);
  assert.match(app, /Refreshing updates prices only/);
});

test('auth migration denies direct grants and detects column, view and privileged RPC bypasses', () => {
  const sql = readFileSync(new URL('../supabase/portal-auth-security.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /has_any_column_privilege/);
  assert.match(sql, /c\.relkind in \('v','m'\)/);
  assert.match(sql, /has_function_privilege/);
  for (const grant of sql.matchAll(/grant\s+[\s\S]*?;/gi)) assert.match(grant[0], /to service_role;/);
});
