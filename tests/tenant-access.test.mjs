import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listPortalBookings, getTopupRequests, getTopupInvoice, deleteTopupRequest,
  updatePortalBooking, setPortalBookingSpringAmount, syncPortalBookingFromSpring,
  recordPortalBookingChange, saveBookingFinancialData
} from '../backend/supabase-client.mjs';

const agent = { id: 'agent-a', role: 'agent', agency_id: 'agency-a' };
const manager = { id: 'manager-a', role: 'office_manager', agency_id: 'agency-a' };
const admin = { id: 'admin', role: 'platform_admin' };

// Import the real backend, but replace its entire network boundary. No live
// Supabase/Spring calls, credentials, customer data or financial writes are used.
function database(t, bookingStatus = 'Reserved') {
  const environment = {
    SUPABASE_URL: 'https://database.test',
    SUPABASE_PUBLISHABLE_KEY: 'test-only-publishable',
    SUPABASE_SECRET_KEY: 'test-only-server'
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const booking = (id, owner, agency) => ({
    id, pnr: id.toUpperCase(), created_by: owner, agency_id: agency,
    status: bookingStatus, total_cny: 100,
    itinerary: { flights: [{ number: '9C1', travelDate: '2030-01-01' }] }
  });
  const invoice = (id, owner, agency) => ({
    id, requested_by: owner, agency_id: agency, status: 'pending'
  });
  const tables = {
    bookings: [
      booking('own', 'agent-a', 'agency-a'),
      booking('colleague', 'agent-other', 'agency-a'),
      booking('foreign', 'agent-b', 'agency-b'),
      booking('former', 'agent-a', 'agency-b')
    ],
    topup_requests: [
      invoice('own', 'agent-a', 'agency-a'),
      invoice('colleague', 'agent-other', 'agency-a'),
      invoice('foreign', 'agent-b', 'agency-b'),
      invoice('former', 'agent-a', 'agency-b')
    ],
    agencies: [{ id: 'agency-a', name: 'Agency A' }, { id: 'agency-b', name: 'Agency B' }]
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, environment.SUPABASE_URL, 'Unexpected network target');
    const method = options.method || 'GET';
    calls.push({ url, method });
    const tableName = url.pathname.replace('/rest/v1/', '');
    assert.ok(Object.hasOwn(tables, tableName), `Unexpected endpoint: ${url.pathname}`);
    const rows = tables[tableName].filter(row => {
      for (const field of ['id', 'pnr', 'agency_id', 'created_by', 'requested_by', 'status']) {
        const condition = url.searchParams.get(field);
        if (condition != null) {
          assert.ok(condition.startsWith('eq.'), 'Only equality filters expected');
          if (row[field] !== condition.slice(3)) return false;
        }
      }
      return true;
    });
    if (method === 'PATCH') {
      const body = JSON.parse(options.body);
      for (const row of rows) Object.assign(row, body);
    }
    return new Response(JSON.stringify(rows), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  });
  return calls;
}

for (const [label, profile, expected] of [
  ['agent', agent, ['own']],
  ['office manager', manager, ['own', 'colleague']],
  ['platform admin', admin, ['own', 'colleague', 'foreign', 'former']]
]) {
  test(`${label} lists only authorized bookings and top-ups`, async t => {
    const calls = database(t);
    assert.deepEqual((await listPortalBookings(profile)).map(row => row.id), expected);
    assert.deepEqual((await getTopupRequests(profile)).map(row => row.id), expected);
    if (profile.role !== 'platform_admin') {
      for (const call of calls) assert.equal(call.url.searchParams.get('agency_id'), 'eq.agency-a');
    }
  });
}

for (const [label, profile] of [
  ['missing profile', null],
  ['missing identity', { role: 'agent', agency_id: 'agency-a' }],
  ['missing agency', { id: 'agent-a', role: 'agent' }],
  ['unknown role', { ...agent, role: 'unknown' }]
]) {
  test(`list queries fail closed for ${label} before requesting data`, async t => {
    const calls = database(t);
    await assert.rejects(() => listPortalBookings(profile), /access|Agency/i);
    await assert.rejects(() => getTopupRequests(profile), /access|Agency/i);
    assert.equal(calls.length, 0);
  });
}

test('invoice access allows owner, own-agency manager and platform admin', async t => {
  database(t);
  assert.equal((await getTopupInvoice(agent, 'own')).agencyName, 'Agency A');
  assert.equal((await getTopupInvoice(manager, 'colleague')).agencyName, 'Agency A');
  assert.equal((await getTopupInvoice(admin, 'foreign')).agencyName, 'Agency B');
});

for (const [label, profile, id] of [
  ['colleague', agent, 'colleague'],
  ['foreign agency', agent, 'foreign'],
  ['previous agency of the same requester', agent, 'former'],
  ['foreign agency for manager', manager, 'foreign'],
  ['reassigned agent', { ...agent, agency_id: 'agency-b' }, 'own'],
  ['missing agency', { id: 'agent-a', role: 'agent' }, 'own'],
  ['unknown role', { ...agent, role: 'unknown' }, 'own'],
  ['missing profile', null, 'own']
]) {
  test(`invoice lookup denies ${label} before fetching agency details`, async t => {
    const calls = database(t);
    await assert.rejects(() => getTopupInvoice(profile, id), /access/i);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, '/rest/v1/topup_requests');
  });
}

const mutations = [
  ['delete invoice', profile => deleteTopupRequest(profile, 'own')],
  ['cancel booking', profile => updatePortalBooking(profile, 'OWN', 'Cancelled')],
  ['issue ticket', profile => updatePortalBooking(profile, 'OWN', 'Ticketed')],
  ['update supplier amount', profile => setPortalBookingSpringAmount(profile, 'OWN', 120)],
  ['sync supplier order', profile => syncPortalBookingFromSpring(profile, 'OWN', {})],
  ['save flight change', profile => recordPortalBookingChange(profile, 'OWN', { appId: 23 })],
  ['save refund', profile => saveBookingFinancialData(profile, 'OWN', 'refund', {})]
];
for (const [label, profile] of [
  ['foreign agent', { id: 'agent-b', role: 'agent', agency_id: 'agency-b' }],
  ['foreign manager', { id: 'manager-b', role: 'office_manager', agency_id: 'agency-b' }],
  ['reassigned owner', { ...agent, agency_id: 'agency-b' }],
  ['colleague', { ...agent, id: 'agent-other' }],
  ['unknown role', { ...agent, role: 'unknown' }],
  ['missing agency', { id: 'agent-a', role: 'agent' }]
]) {
  for (const [action, execute] of mutations) {
    test(`${label} cannot ${action}; no write or wallet RPC occurs`, async t => {
      const calls = database(t);
      await assert.rejects(() => execute(profile), /access|permission|Agency/i);
      assert.ok(calls.every(call => call.method === 'GET'));
    });
  }
}

test('same-agency owner and manager can update bookings', async t => {
  database(t);
  assert.equal((await setPortalBookingSpringAmount(agent, 'OWN', 120)).total_cny, 120);
  assert.equal((await syncPortalBookingFromSpring(agent, 'OWN', {})).status, 'Reserved');
  assert.equal((await updatePortalBooking(manager, 'COLLEAGUE', 'Cancelled')).status, 'Cancelled');
  assert.equal((await updatePortalBooking(admin, 'FOREIGN', 'Cancelled')).status, 'Cancelled');
});

test('authorized flight change retains original flight history', async t => {
  database(t, 'Ticketed');
  const row = await recordPortalBookingChange(agent, 'OWN', {
    appId: 23, changes: [{ key: 'outbound', newFlight: { flightNo: '9C2', travelDate: '2030-01-02' } }]
  });
  assert.equal(row.itinerary.flights[0].number, '9C2');
  assert.equal(row.itinerary.changeHistory[0].legs[0].oldFlight.number, '9C1');
});

test('missing invoice is rejected before fetching agency details', async t => {
  const calls = database(t);
  await assert.rejects(() => getTopupInvoice(admin, 'missing'), /Invoice not found/);
  assert.equal(calls.length, 1);
});
