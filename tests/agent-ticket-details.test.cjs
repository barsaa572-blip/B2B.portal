const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'backend/supabase-client.mjs'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
const extract = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end)).replace(/^export /gm, '');

(async () => {
  const calls = [];
  const ctx = {
    secretRequest: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('wallet_transactions')) return [{ created_at: '2026-09-04T04:00:00Z', created_by: 'actual-issuer' }];
      return [{ full_name: 'TEST ISSUING AGENT', phone: '+976 12345678' }];
    }
  };
  vm.createContext(ctx);
  vm.runInContext(extract(backend, 'export async function getTicketIssueDetails', 'export async function approveTopupRequest') + ';globalThis.getIssue=getTicketIssueDetails', ctx);
  const issue = await ctx.getIssue({ pnr: 'TEST123', agency_id: 'agency-1', created_by: 'booking-creator' });
  assert(calls[0].url.includes('agency_id=eq.agency-1'));
  assert(calls[1].url.includes('id=eq.actual-issuer'));
  assert(!calls[1].url.includes('booking-creator'));
  assert.equal(issue.agent.phone, '+976 12345678');
  ctx.secretRequest = async () => [];
  assert.equal((await ctx.getIssue({ pnr: 'OLD', agency_id: 'agency-1' })).agent, null);

  const writes = [];
  const userCtx = {
    config: () => ({ configured: true, secretKey: 'test-only' }),
    request: async () => ({ ok: true, json: async () => ({ id: 'new-agent', email: 'test@example.com' }) }),
    secretRequest: async (url, options) => { writes.push({ url, options }); return []; }
  };
  vm.createContext(userCtx);
  vm.runInContext(extract(backend, 'export async function createUser', 'export async function adjustWallet') + ';globalThis.create=createUser', userCtx);
  await userCtx.create({ fullName: 'TEST AGENT', phone: '+976 12345678', email: 'test@example.com', password: 'test-only', agencyId: 'agency-1', role: 'agent' });
  assert.equal(writes[0].options.body.phone, '+976 12345678');
  assert.equal(writes[0].options.body.email, 'test@example.com');
  await assert.rejects(userCtx.create({ fullName: 'TEST', phone: '' }), /required/);

  const pdfCtx = { Buffer, airportByCode: async () => ({ airport: 'International Airport' }) };
  vm.createContext(pdfCtx);
  vm.runInContext(extract(server, 'const pdfSafeText =', 'const pdfWrappedLines =') + extract(server, 'const ticketPdf =', 'let invoiceDocument =') + ';globalThis.render=ticketPdf', pdfCtx);
  const flight = { airline: 'Spring Airlines', number: '9C8855', travelDate: '2026-09-11', duration: 270, departure: { id: 'ICN', time: '09:00', terminal: 'T1' }, arrival: { id: 'PVG', time: '13:30', terminal: 'T4' }, fare: { cabin: 'P1', baggage: { carryOn: 7, checked: 20 } } };
  const booking = { pnr: 'TEST123', status: 'Ticketed', itinerary: { flights: [flight] }, passengers: { travellers: [{ lastName: 'TEST', firstName: 'PASSENGER', type: 'ADT' }], contact: { name: 'DIFFERENT CONTACT', phone: '00000000' } } };
  const agency = { name: 'TEST AIR SALES LLC', address: '1ST FLOOR, URBAN CENTER, SUKHBAATAR DISTRICT, ULAANBAATAR', registration_number: '1234567', phone: '+976 72000000' };
  const pdf = await pdfCtx.render(booking, agency, issue.issuedAt, issue.agent);
  const content = pdf.toString('ascii');
  for (const value of ['Agency Information', 'Agent Details', 'TEST ISSUING AGENT', '+976 12345678', 'TEST AIR SALES LLC']) assert(content.includes(value));
  assert(!content.includes('Issuing office'));
  assert(!content.includes('DIFFERENT CONTACT'));
  assert(!content.includes('(Contact)'));
  assert(!content.includes('0.95 0.97 1 rg'));
  assert(!content.includes('0.95 0.96 0.98 rg'));
  assert(/36 [\d.]+ Tm \(Agency Information\)/.test(content));
  const output = path.resolve(root, '../../tmp/pdfs');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'agency-agent-preview.pdf'), pdf);
  const mixed = { ...booking, itinerary: { flights: [flight, { ...flight, departure: flight.arrival, arrival: flight.departure }] }, passengers: { travellers: ['ADT', 'CHD', 'INF'].map(type => ({ lastName: 'TEST', firstName: type, type })) } };
  fs.writeFileSync(path.join(output, 'agency-agent-round-preview.pdf'), await pdfCtx.render(mixed, agency, issue.issuedAt, issue.agent));
  console.log('PASS: actual issuer lookup, missing issuer, agent contact persistence, PDF agency/agent sections');
})().catch(error => { console.error(error); process.exitCode = 1; });
