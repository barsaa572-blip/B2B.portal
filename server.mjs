import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpringClient, getSpringStatus } from './backend/spring-client.mjs';
import { getCnyMntRate, quoteCnyToMnt } from './backend/fx-rate.mjs';
import { createOfficeAgent, getOfficeUserAccess, requireOfficeManager, updateOfficeAgent } from './backend/supabase-client.mjs';
import { adjustWallet, approveTopupRequest, createAgency, createTopupRequest, createUser, deleteAgency, deleteTopupRequest, deleteUser, getAdminOverview, getSupabaseStatus, getTopupInvoice, getTopupRequests, getWalletDetails, profileForAccessToken, requirePlatformAdmin, signInWithPassword, updateAgency, updateUser } from './backend/supabase-client.mjs';

const PORT = Number(process.env.PORT || 4173);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const send = (res, status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data)); };
const readJson = req => new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => { raw += chunk;
if (raw.length > 20_000) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON request.')); } }); req.on('error', reject); });
const bearer = req => req.headers.authorization?.replace(/^Bearer\s+/i, '');
const requiredText = (value, label) => { const text = String(value || '').trim();
if (!text && label === 'Payment reference') return 'Not provided';
if (!text) throw new Error(`${label} is required.`); return text; };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const invoiceDocument = invoice => { const amount = Number(invoice.amount_mnt || 0);
const fee = Number(invoice.service_fee_mnt || 0);
const total = Number(invoice.total_mnt ?? amount + fee); return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoice_number)}</title><style>body{font-family:Arial,sans-serif;color:#162847;max-width:720px;margin:44px auto;padding:0 22px}.head{display:flex;justify-content:space-between;border-bottom:2px solid #245ee6;padding-bottom:20px}.brand{font-size:25px;font-weight:800}.tag{color:#245ee6;font-size:12px;font-weight:700;letter-spacing:1px}.box{margin:28px 0;border:1px solid #dbe4f3;border-radius:10px;padding:22px}.total{font-size:28px;color:#df7800;font-weight:800;text-align:right}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf1f7}.muted{color:#66758f;font-size:13px}footer{margin-top:35px;color:#66758f;font-size:12px}</style></head><body><div class="head"><div><div class="brand">Flight B2B</div><div class="muted">Top-up payment invoice</div></div><div><div class="tag">INVOICE</div><strong>${escapeHtml(invoice.invoice_number)}</strong></div></div><div class="box"><div class="row"><span>Agency</span><strong>${escapeHtml(invoice.agencyName)}</strong></div><div class="row"><span>Status</span><strong>${escapeHtml(invoice.status.toUpperCase())}</strong></div><div class="row"><span>Created</span><strong>${new Date(invoice.created_at).toLocaleString('en-GB')}</strong></div><div class="row"><span>Wallet credit</span><strong>CNY ${Number(invoice.amount_cny).toLocaleString('en-US',{minimumFractionDigits:2})}</strong></div><div class="row"><span>Wallet credit amount</span><strong>₮${amount.toLocaleString('en-US')}</strong></div><div class="row"><span>Service fee (3%)</span><strong>₮${fee.toLocaleString('en-US')}</strong></div><div class="row"><span>Note</span><strong>${escapeHtml(invoice.note || '—')}</strong></div><div class="total">Total payable: ₮ ${total.toLocaleString('en-US')}</div></div><p class="muted">Please use the invoice number as the payment reference. Wallet credit is added after finance approval.</p><footer>This invoice is generated electronically by Flight B2B Portal.</footer></body></html>`; };
const normalise = item => { const flights = item.flights ?? [];
const first = flights[0] ?? {};
const last = flights.at(-1) ?? first;
const number = first.flight_number ?? ''; return { airline: first.airline ?? 'Unknown airline', airlineLogo: first.airline_logo ?? null, airlineCode: number.match(/^([A-Z0-9]{2})\s*/i)?.[1]?.toUpperCase() ?? null, number, departure: first.departure_airport ?? {}, arrival: last.arrival_airport ?? {}, duration: item.total_duration ?? flights.reduce((total, leg) => total + (leg.duration ?? 0), 0), stops: Math.max(0, flights.length - 1), price: item.price ?? null, departureToken: item.departure_token ?? null, segments: flights.map(leg => ({ number: leg.flight_number ?? '', airline: leg.airline ?? '', departure: leg.departure_airport ?? {}, arrival: leg.arrival_airport ?? {}, duration: leg.duration ?? null, airplane: leg.airplane ?? null, travelClass: leg.travel_class ?? null, extensions: leg.extensions ?? [] })) }; };
const springTime = value => {
  const match = String(value || '').match(/(\d{1,2}:\d{2})(?::\d{2})?/);
  return match ? match[1].padStart(5, '0') : '';
};
const springAirport = endpoint => {
  const airport = endpoint?.airportCityInfo ?? endpoint ?? {};
  const time = endpoint?.oriTimeInfo?.timeBJ ?? endpoint?.destTimeInfo?.timeBJ ?? endpoint?.timeInfo?.timeBJ ?? endpoint?.timeBJ;
  return { id: airport.airportCode || airport.cityCode || '', name: airport.airportName || airport.cityName || '', time: springTime(time) };
};
const minutesBetween = (first, last) => {
  const value = time => { const match = String(time || '').match(/(\d{1,2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };
  const start = value(first); const end = value(last);
  return start === null || end === null ? 0 : (end - start + 1440) % 1440;
};
const normaliseSpring = item => {
  const basic = item.flightBasicInfo ?? item;
  const departure = springAirport(basic.oriEndPoint);
  const arrival = springAirport(basic.destEndPoint);
  const seats = [...(item.normSeatPriceList ?? basic.normSeatPriceList ?? [])].filter(seat => Number(seat.remSeatNum ?? seat.remainSeatNum ?? 1) > 0).sort((a, b) => Number(a.seatPrice ?? a.price ?? Infinity) - Number(b.seatPrice ?? b.price ?? Infinity));
  const seat = seats[0] ?? {};
  const baseFare = Number(seat.seatPrice ?? seat.price ?? basic.pubPrice ?? 0);
  const taxes = Number(basic.fuelFee ?? 0) + Number(basic.portPay ?? 0) + Number(basic.otherFeeSum ?? 0);
  const duration = Number(basic.flightDuration ?? basic.duration ?? minutesBetween(departure.time, arrival.time));
  return { airline: basic.airlineName || 'Spring Airlines', airlineLogo: null, airlineCode: String(basic.flightNo || '9C').slice(0, 2), number: basic.flightNo || 'Flight', departure, arrival, duration, stops: 0, price: baseFare + taxes, source: 'spring', spring: { segHeadId: basic.segHeadId, seatName: seat.seatName || seat.cabinName || 'Economy', seatPrice: baseFare, taxes }, segments: [{ number: basic.flightNo || 'Flight', airline: basic.airlineName || 'Spring Airlines', departure, arrival, duration, airplane: basic.acType || null, travelClass: seat.seatName || seat.cabinName || 'Economy' }] };
};
const validateFlightSearch = ({ departure, arrival, date, trip, returnDate }) => {
  if (!/^[A-Z]{3}$/.test(departure || '') || !/^[A-Z]{3}$/.test(arrival || '') || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('departure, arrival and date are required.');
  if (date < new Date().toISOString().slice(0, 10)) throw new Error('Departure date cannot be in the past.');
  if (trip === 'round' && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate || '')) throw new Error('A return date is required for a round trip.');
  if (trip === 'round' && returnDate < date) throw new Error('Return date cannot be earlier than departure date.');
};
async function searchSpringFlights({ departure, arrival, date, trip, returnDate }) {
  const client = createSpringClient(); const token = await client.getAccessToken();
  const payload = (oriCode, destCode, flightDay) => ({ codeType: 1, oriCode, destCode, flightDay, lang: 'zh_cn', moneyClassId: 0 });
  const outboundData = await client.searchFlights(payload(departure, arrival, date), token.accessToken);
  const outbound = (outboundData.flightsList ?? []).map(normaliseSpring).filter(flight => flight.departure.id && flight.arrival.id);
  if (trip !== 'round') return { source: 'Spring Airlines', phase: 'outbound', trip, results: outbound };
  const returnData = await client.searchFlights(payload(arrival, departure, returnDate), token.accessToken);
  const returns = (returnData.flightsList ?? []).map(normaliseSpring).filter(flight => flight.departure.id && flight.arrival.id);
  return { source: 'Spring Airlines', phase: 'outbound', trip, results: outbound, roundPairs: outbound.slice(0, 3).flatMap(outboundFlight => returns.slice(0, 3).map(returnFlight => ({ outbound: outboundFlight, returnFlight, sameAirline: outboundFlight.airlineCode === returnFlight.airlineCode }))) };
}
async function searchFlights(url, res) {
  const departure = url.searchParams.get('departure')?.toUpperCase();
const arrival = url.searchParams.get('arrival')?.toUpperCase();
const date = url.searchParams.get('date');
const adults = url.searchParams.get('adults') || '1';
const children = url.searchParams.get('children') || '0';
const infants = url.searchParams.get('infants') || '0';
const trip = url.searchParams.get('trip') || 'oneway';
const returnDate = url.searchParams.get('returnDate');
const departureToken = url.searchParams.get('departureToken');
const airline = url.searchParams.get('airline')?.toUpperCase();
  if (getSpringStatus().httpJsonReady && !departureToken) {
    try { validateFlightSearch({ departure, arrival, date, trip, returnDate }); return send(res, 200, await searchSpringFlights({ departure, arrival, date, trip, returnDate })); }
    catch (error) { return send(res, 502, { error: error.message || 'Spring Airlines flight search is unavailable.' }); }
  }
  const key = process.env.SERPAPI_KEY;
  if (!key) return send(res, 503, { error: 'Flight search is not configured.' });
  if (departureToken) {
    const loadReturn = async includeAirline => { const params = new URLSearchParams({ engine: 'google_flights', departure_token: departureToken, departure_id: departure || '', arrival_id: arrival || '', outbound_date: date || '', return_date: returnDate || '', adults, children, infants_on_lap: infants, travel_class: '1', currency: 'CNY', hl: 'en', gl: 'cn', type: '1', api_key: key });
if (includeAirline) params.set('include_airlines', includeAirline);
const upstream = await fetch(`https://serpapi.com/search.json?${params}`);
const data = await upstream.json(); return { upstream, data, results: [...(data.best_flights ?? []), ...(data.other_flights ?? [])].map(normalise) }; };
    try { let response = await loadReturn(airline); let fallback = false;
if (airline && (!response.upstream.ok || response.data.error || response.results.length === 0)) { response = await loadReturn(null); fallback = true; } if (!response.upstream.ok || response.data.error) return send(res, 502, { error: response.data.error || 'Flight provider returned an error.' }); return send(res, 200, { source: 'SerpApi / Google Flights', phase: 'return', sameAirline: !fallback, results: response.results }); } catch { return send(res, 502, { error: 'Flight provider could not be reached.' }); }
  }
  try { validateFlightSearch({ departure, arrival, date, trip, returnDate }); } catch (error) { return send(res, 400, { error: error.message }); }
  const params = new URLSearchParams({ engine: 'google_flights', departure_id: departure, arrival_id: arrival, outbound_date: date, adults, children, infants_on_lap: infants, travel_class: '1', currency: 'CNY', hl: 'en', gl: 'cn', type: trip === 'round' ? '1' : '2', api_key: key });
  if (trip === 'round') params.set('return_date', returnDate);
  try { const upstream = await fetch(`https://serpapi.com/search.json?${params}`);
const data = await upstream.json();
if (!upstream.ok || data.error) return send(res, 502, { error: data.error || 'Flight provider returned an error.' }); send(res, 200, { source: 'SerpApi / Google Flights', phase: 'outbound', trip, results: [...(data.best_flights ?? []), ...(data.other_flights ?? [])].map(normalise) }); }
  catch { send(res, 502, { error: 'Flight provider could not be reached.' }); }
}
async function autocompleteLocations(url, res) {
  const key = process.env.SERPAPI_KEY;
const query = url.searchParams.get('q')?.trim();
  if (!key) return send(res, 503, { error: 'Location search is not configured.' });
  if (!query || query.length < 2) return send(res, 200, { options: [] });
  const params = new URLSearchParams({ engine: 'google_flights_autocomplete', q: query, exclude_regions: 'true', hl: 'en', gl: 'mn', api_key: key });
  try { const upstream = await fetch(`https://serpapi.com/search.json?${params}`);
const data = await upstream.json();
if (!upstream.ok || data.error) return send(res, 502, { error: data.error || 'Location search failed.' });
const seen = new Set();
const options = (data.suggestions ?? []).flatMap(s => { const airports = (s.airports ?? []).map(a => ({ city: a.city || s.name, airport: a.name, code: a.id }));
if (airports.length) return airports;
if (/^[A-Z]{3}$/i.test(s.id || '')) return [{ city: s.city || s.description?.split(',')[0] || s.name, airport: s.name, code: s.id }]; return []; }).filter(a => a.code && !seen.has(a.code) && seen.add(a.code)); send(res, 200, { options }); }
  catch { send(res, 502, { error: 'Location provider could not be reached.' }); }
}

async function handleOfficeUsers(req, res, url) {
  try {
    const manager = await requireOfficeManager(bearer(req));
    if (url.pathname === '/api/office/users' && req.method === 'GET') return send(res, 200, await getOfficeUserAccess(manager));
    if (url.pathname === '/api/office/users' && req.method === 'POST') {
      const body = await readJson(req);
      return send(res, 201, await createOfficeAgent(manager, {
        email: requiredText(body.email, 'Email'),
        password: requiredText(body.password, 'Password'),
        fullName: requiredText(body.fullName, 'Full name'),
        branchId: body.branchId
      }));
    }
    const userMatch = url.pathname.match(/^\/api\/office\/users\/([\w-]+)$/);
    if (userMatch && req.method === 'PATCH') {
      const body = await readJson(req);
      return send(res, 200, await updateOfficeAgent(manager, userMatch[1], {
        fullName: requiredText(body.fullName, 'Full name'),
        branchId: body.branchId,
        active: Boolean(body.active)
      }));
    }
    return send(res, 404, { error: 'Office user endpoint not found.' });
  } catch (error) {
    return send(res, 403, { error: error.message || 'Request not allowed.' });
  }
}

createServer(async (req, res) => { const url = new URL(req.url, `http://${req.headers.host}`);
if (url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'flight-b2b-backend' });
if (url.pathname === '/api/backend/status') return send(res, 200, { spring: getSpringStatus(), supabase: getSupabaseStatus() });
if (url.pathname === '/api/fx/cny-mnt') { try { return send(res, 200, await getCnyMntRate()); } catch (error) { return send(res, 503, { error: error.message }); } }
if (url.pathname.startsWith('/api/office/users')) return handleOfficeUsers(req, res, url);
if (url.pathname === '/api/wallet' && req.method === 'GET') { try { return send(res, 200, await getWalletDetails(await profileForAccessToken(bearer(req)))); } catch (error) { return send(res, 403, { error: error.message || 'Wallet access is not allowed.' }); } }
if (url.pathname === '/api/auth/login' && req.method === 'POST') { try { const { email, password } = await readJson(req);
if (!email || !password) return send(res, 400, { error: 'Email and password are required.' });
const session = await signInWithPassword(email, password);
const profile = await profileForAccessToken(session.access_token); return send(res, 200, { accessToken: session.access_token, expiresIn: session.expires_in, profile }); } catch (error) { return send(res, 401, { error: error.message || 'Sign in failed.' }); } } if (url.pathname.startsWith('/api/topups') || url.pathname.startsWith('/api/invoices/')) { try { const profile = await profileForAccessToken(bearer(req));
if (url.pathname === '/api/topups' && req.method === 'GET') return send(res, 200, await getTopupRequests(profile));
if (url.pathname === '/api/topups' && req.method === 'POST') { const body = await readJson(req);
const amount = Number(body.amount);
if (!Number.isFinite(amount) || amount <= 0) throw new Error('Top-up amount must be greater than zero.');
const invoice = await createTopupRequest({ profile, amount, paymentReference: body.paymentReference, note: body.note }); return send(res, 201, { invoice, downloadUrl: `/api/invoices/${invoice.id}` }); } const topupMatch = url.pathname.match(/^\/api\/topups\/([\w-]+)$/);
if (topupMatch && req.method === 'DELETE') { await deleteTopupRequest(profile, topupMatch[1]); return send(res, 200, { ok: true }); } const invoiceMatch = url.pathname.match(/^\/api\/invoices\/([\w-]+)$/);
if (invoiceMatch && req.method === 'GET') { const invoice = await getTopupInvoice(profile, invoiceMatch[1]); return send(res, 200, invoiceDocument(invoice), 'text/html; charset=utf-8'); } return send(res, 404, { error: 'Invoice endpoint not found.' }); } catch (error) { return send(res, 403, { error: error.message || 'Request not allowed.' }); } } if (url.pathname.startsWith('/api/admin/')) { try { const admin = await requirePlatformAdmin(bearer(req));
if (url.pathname === '/api/admin/overview' && req.method === 'GET') return send(res, 200, await getAdminOverview());
const approveMatch = url.pathname.match(/^\/api\/admin\/topups\/([\w-]+)\/approve$/);
if (approveMatch && req.method === 'POST') { await approveTopupRequest(approveMatch[1], admin.id); return send(res, 200, { ok: true }); } const agencyMatch = url.pathname.match(/^\/api\/admin\/agencies\/([\w-]+)$/);
const userMatch = url.pathname.match(/^\/api\/admin\/users\/([\w-]+)$/);
if (agencyMatch && req.method === 'PATCH') { const body = await readJson(req); return send(res, 200, await updateAgency(agencyMatch[1], { name: requiredText(body.name, 'Agency name'), active: Boolean(body.active) })); } if (agencyMatch && req.method === 'DELETE') { await deleteAgency(agencyMatch[1]); return send(res, 200, { ok: true }); } if (userMatch && req.method === 'PATCH') { const body = await readJson(req);
if (userMatch[1] === admin.id && body.active === false) throw new Error('You cannot deactivate your own administrator account.');
const role = ['agent', 'office_manager', 'platform_admin'].includes(body.role) ? body.role : null;
if (!role) throw new Error('Valid role is required.'); return send(res, 200, await updateUser(userMatch[1], { fullName: requiredText(body.fullName, 'Full name'), agencyId: body.agencyId, branchId: body.branchId, role, active: Boolean(body.active) })); } if (userMatch && req.method === 'DELETE') { if (userMatch[1] === admin.id) throw new Error('You cannot delete your own administrator account.'); await deleteUser(userMatch[1]); return send(res, 200, { ok: true }); } const body = await readJson(req);
if (url.pathname === '/api/admin/agencies' && req.method === 'POST') { const name = requiredText(body.name, 'Agency name'); return send(res, 201, await createAgency({ name, branchName: body.branchName, initialBalance: body.initialBalance })); } if (url.pathname === '/api/admin/users' && req.method === 'POST') { const email = requiredText(body.email, 'Email');
const password = requiredText(body.password, 'Password');
const fullName = requiredText(body.fullName, 'Full name');
const role = ['agent', 'office_manager'].includes(body.role) ? body.role : null;
if (!role || !body.agencyId) throw new Error('Agency and valid role are required.'); return send(res, 201, await createUser({ email, password, fullName, agencyId: body.agencyId, branchId: body.branchId, role })); } if (url.pathname === '/api/admin/wallet-adjustments' && req.method === 'POST') { const agencyId = requiredText(body.agencyId, 'Agency');
const reason = requiredText(body.reason, 'Reason');
const amount = Number(body.amount);
if (!Number.isFinite(amount) || amount === 0) throw new Error('Adjustment amount must not be zero.'); await adjustWallet({ agencyId, amount, reason, createdBy: admin.id }); return send(res, 201, { ok: true }); } return send(res, 404, { error: 'Admin endpoint not found.' }); } catch (error) { return send(res, 403, { error: error.message || 'Request not allowed.' }); } } if (url.pathname === '/api/flights') return searchFlights(url, res);
if (url.pathname === '/api/locations') return autocompleteLocations(url, res);
const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
const file = normalize(join(ROOT, requested));
if (!file.startsWith(normalize(ROOT))) return send(res, 403, 'Forbidden', 'text/plain'); try { send(res, 200, await readFile(file), MIME[extname(file)] || 'application/octet-stream'); } catch { send(res, 404, 'Not found', 'text/plain'); } }).listen(PORT, '127.0.0.1', () => console.log(`Flight B2B Portal listening on http://127.0.0.1:${PORT}`));
