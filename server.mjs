import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpringClient, getSpringStatus } from './backend/spring-client.mjs';
import { airportByCode, searchAirports } from './backend/airport-directory.mjs';
import { rankSpringAirport } from './backend/spring-route-directory.mjs';
import { getCnyMntRate, quoteCnyToMnt } from './backend/fx-rate.mjs';
import { createOfficeAgent, getOfficeUserAccess, requireOfficeManager, updateOfficeAgent } from './backend/supabase-client.mjs';
import { adjustWallet, approveTopupRequest, createAgency, createPortalBooking, createTopupRequest, createUser, deleteAgency, deleteTopupRequest, deleteUser, getAdminOverview, getSupabaseStatus, getTopupInvoice, getTopupRequests, getWalletDetails, listPortalBookings, profileForAccessToken, recordPortalBookingNoShow, requirePlatformAdmin, signInWithPassword, updateAgency, updatePortalBooking, updateUser } from './backend/supabase-client.mjs';

const PORT = Number(process.env.PORT || 4173);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const send = (res, status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data)); };
const readJson = req => new Promise((resolve, reject) => {
  let raw = ''; let tooLarge = false;
  req.on('data', chunk => {
    if (tooLarge) return;
    raw += chunk;
    if (raw.length > 100_000) { tooLarge = true; raw = ''; }
  });
  req.on('end', () => {
    if (tooLarge) return reject(new Error('Request is too large.'));
    try { resolve(raw ? JSON.parse(raw) : {}); }
    catch { reject(new Error('Invalid JSON request.')); }
  });
  req.on('error', reject);
});
const bearer = req => req.headers.authorization?.replace(/^Bearer\s+/i, '');
const requiredText = (value, label) => { const text = String(value || '').trim();
if (!text && label === 'Payment reference') return 'Not provided';
if (!text) throw new Error(`${label} is required.`); return text; };
const parseDateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? new Date(`${value}T00:00:00Z`) : null;
const ageAtDeparture = (birth, departure) => {
  let age = departure.getUTCFullYear() - birth.getUTCFullYear();
  if (departure.getUTCMonth() < birth.getUTCMonth() || (departure.getUTCMonth() === birth.getUTCMonth() && departure.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
};
const addMonths = (date, months) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
const SPRING_PASSENGER_TYPE = { ADT: 1, CHD: 2, INF: 3 };
const SPRING_GENDER = { male: 1, female: 2 };
const SPRING_DOCUMENT_TYPE = { passport: 2, 'national id': 1 };
const COUNTRY_THREE_CODES = {
  mongolia: 'MNG', china: 'CHN', russia: 'RUS', japan: 'JPN', 'south korea': 'KOR',
  'north korea': 'PRK', kazakhstan: 'KAZ', 'united states': 'USA', 'united kingdom': 'GBR',
  germany: 'DEU', france: 'FRA', turkey: 'TUR', thailand: 'THA', singapore: 'SGP',
  vietnam: 'VNM', india: 'IND', australia: 'AUS', canada: 'CAN'
};
const countryThreeCode = value => {
  const text = String(value || '').trim();
  if (/^[A-Za-z]{3}$/.test(text)) return text.toUpperCase();
  return COUNTRY_THREE_CODES[text.toLowerCase()] || null;
};
const validateBookingPassengers = ({ itinerary, passengers }) => {
  const departure = parseDateOnly(itinerary?.departureDate);
  if (!departure) throw new Error('A valid departure date is required.');
  for (const traveller of passengers?.travellers || []) {
    const birth = parseDateOnly(traveller.dateOfBirth);
    const expiry = parseDateOnly(traveller.documentExpiry);
    const name = traveller.lastName || 'Passenger';
    if (!birth) throw new Error(`${name}: date of birth is required.`);
    const age = ageAtDeparture(birth, departure);
    if (traveller.type === 'ADT' && age < 12) throw new Error(`${name}: ADT must be at least 12 years old on departure.`);
    if (traveller.type === 'CHD' && (age < 2 || age >= 12)) throw new Error(`${name}: CHD must be from 2 years old until the day before the 12th birthday.`);
    if (traveller.type === 'INF' && age >= 2) throw new Error(`${name}: INF must be under 2 years old on departure.`);
    if (!expiry || expiry < addMonths(departure, 6)) throw new Error(`${name}: travel document must be valid for at least 6 months from departure.`);
  }
};
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
const SPRING_AIRLINES_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Spring_Airlines_Logo.png';
// Spring uses ULN for Ulaanbaatar. Accept UBN as a legacy alias if submitted.
const springAirportCode = code => String(code || '').toUpperCase() === 'UBN' ? 'ULN' : String(code || '').toUpperCase();
const portalAirportCode = code => String(code || '').toUpperCase() === 'UBN' ? 'ULN' : String(code || '').toUpperCase();
const springText = value => String(value ?? '')
  .replace(/春秋航空/g, 'Spring Airlines')
  .replace(/吉祥航空/g, 'Juneyao Airlines')
  .replace(/中国国际航空/g, 'Air China')
  .replace(/中国东方航空/g, 'China Eastern Airlines')
  .replace(/中国南方航空/g, 'China Southern Airlines')
  .replace(/经济舱/g, 'Economy')
  .replace(/超级经济舱/g, 'Premium Economy')
  .replace(/公务舱|商务舱/g, 'Business')
  .replace(/头等舱/g, 'First Class')
  .replace(/空客/g, 'Airbus ')
  .replace(/波音/g, 'Boeing ')
  .replace(/航站楼/g, 'Terminal ')
  .replace(/国际机场/g, 'International Airport')
  .replace(/机场/g, 'Airport')
  .replace(/直飞/g, 'Nonstop')
  .replace(/公斤/g, 'kg');
const springAirport = async endpoint => {
  const airport = endpoint?.airportCityInfo ?? endpoint ?? {};
  const time = endpoint?.oriTimeInfo?.timeBJ ?? endpoint?.destTimeInfo?.timeBJ ?? endpoint?.timeInfo?.timeBJ ?? endpoint?.timeBJ;
  const id = portalAirportCode(airport.airportCode || airport.cityCode);
  const directoryAirport = await airportByCode(id);
  return { id, name: directoryAirport?.airport || springText(airport.airportName || airport.cityName || ''), terminal: springText(airport.airportTerminal || airport.terminal || ''), time: springTime(time) };
};
const minutesBetween = (first, last) => {
  const value = time => { const match = String(time || '').match(/(\d{1,2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };
  const start = value(first); const end = value(last);
  return start === null || end === null ? 0 : (end - start + 1440) % 1440;
};
const normaliseFareRules = allowance => {
  const labels = { 1: 'Refund', 2: 'Change' };
  return (allowance?.keguiInfoList ?? []).map(rule => ({
    type: Number(rule.keguiType),
    label: labels[Number(rule.keguiType)] ?? 'Fare condition',
    valueType: Number(rule.valueType ?? rule.valType),
    calculationSource: Number(rule.calcSource ?? 0),
    entries: (rule.keguiValueList ?? []).map(entry => ({
      value: Number(entry.keguiValue),
      valueType: Number(entry.valType ?? rule.valueType),
      calculationSource: Number(entry.calcSource ?? rule.calcSource ?? 0),
      intervalType: Number(entry.intervalType ?? 0),
      start: entry.flightDateStart ?? null,
      end: entry.flightDateEnd ?? null
    })).filter(entry => Number.isFinite(entry.value))
  })).filter(rule => rule.entries.length);
};
const normaliseSpring = async item => {
  const basic = item.flightBasicInfo ?? item;
  const [departure, arrival] = await Promise.all([springAirport(basic.oriEndPoint), springAirport(basic.destEndPoint)]);
  // cSeatPriceList contains the combination IDs that bookOrderC needs. Fall
  // back to normSeatPriceList only if a legacy search response omits it.
  const bookingSeats = item.cSeatPriceList ?? basic.cSeatPriceList ?? [];
  const seats = [...(bookingSeats.length ? bookingSeats : (item.normSeatPriceList ?? basic.normSeatPriceList ?? []))].filter(seat => Number(seat.remSeatNum ?? seat.remainSeatNum ?? 1) > 0).sort((a, b) => Number(a.seatPrice ?? a.price ?? Infinity) - Number(b.seatPrice ?? b.price ?? Infinity));
  const taxes = Number(basic.fuelFee ?? 0) + Number(basic.portPay ?? 0) + Number(basic.otherFeeSum ?? 0);
  const duration = Number(basic.flightDuration ?? basic.duration ?? minutesBetween(departure.time, arrival.time));
  const toFareOption = (seat, index) => {
    const baseFare = Number(seat.seatPrice ?? seat.price ?? basic.pubPrice ?? 0);
    const allowance = seat.kegui ?? seat.baggage ?? basic.kegui ?? {};
    const baggage = {
      checkedKg: allowance.bag ?? allowance.checkedBag ?? allowance.checkedBaggage ?? null,
      cabinKg: allowance.handbag ?? allowance.cabinBag ?? allowance.handBaggage ?? null,
      cabinSize: allowance.handbagSize ?? allowance.cabinBagSize ?? null,
      // Optional fields are kept only when Spring sends them. The frontend
      // deliberately does not invent a "personal item" allowance.
      personalItem: allowance.personalItem ?? allowance.personalBag ?? allowance.smallBag ?? null
    };
    return {
      id: String(seat.seatId ?? seat.seatCode ?? seat.cabinCode ?? `fare-${index}`),
      fareType: springText(seat.seatName || seat.cabinName || 'Public fare'),
      bookingClass: seat.seatCode || seat.cabinCode || null,
      cabin: springText(seat.cabinName || seat.seatName || 'Economy'),
      baseFare,
      taxes,
      total: baseFare + taxes,
      remainingSeats: seat.remSeatNum ?? seat.remainSeatNum ?? null,
      baggage,
      rules: normaliseFareRules(allowance),
      spring: {
        segHeadId: basic.segHeadId ?? null,
        combId: seat.combId ?? null,
        combType: seat.combType ?? null,
        combPrice: baseFare,
        adultCabin: seat.seatName ?? seat.cabinCode ?? null,
        moneyClassId: seat.moneyClassId ?? 0
      }
    };
  };
  const fareOptions = (seats.length ? seats : [{}]).map(toFareOption);
  const fare = fareOptions[0];
  const baggage = fare.baggage;
  const airline = springText(basic.airlineName || 'Spring Airlines');
  return { airline, airlineLogo: SPRING_AIRLINES_LOGO, airlineCode: String(basic.flightNo || '9C').slice(0, 2), number: basic.flightNo || 'Flight', departure, arrival, duration, stops: 0, price: fare.total, source: 'spring', spring: { ...fare.spring, seatName: fare.fareType, seatPrice: fare.baseFare, taxes, baggage, fare }, fare, fareOptions, segments: [{ number: basic.flightNo || 'Flight', airline, airlineLogo: SPRING_AIRLINES_LOGO, departure, arrival, duration, airplane: springText(basic.acType || '' ) || null, travelClass: fare.cabin, baggage, fare }] };
};
const validateFlightSearch = ({ departure, arrival, date, trip, returnDate }) => {
  if (!/^[A-Z]{3}$/.test(departure || '') || !/^[A-Z]{3}$/.test(arrival || '') || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('departure, arrival and date are required.');
  if (date < new Date().toISOString().slice(0, 10)) throw new Error('Departure date cannot be in the past.');
  if (trip === 'round' && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate || '')) throw new Error('A return date is required for a round trip.');
  if (trip === 'round' && returnDate < date) throw new Error('Return date cannot be earlier than departure date.');
};
async function searchSpringFlights({ departure, arrival, date, trip, returnDate, passengers }) {
  const client = createSpringClient(); const token = await client.getAccessToken();
  const payload = (oriCode, destCode, flightDay) => ({ codeType: 1, oriCode: springAirportCode(oriCode), destCode: springAirportCode(destCode), flightDay, lang: 'zh_cn', moneyClassId: 0 });
  const outboundData = await client.searchFlights(payload(departure, arrival, date), token.accessToken);
  const outbound = (await Promise.all((outboundData.flightsList ?? []).map(normaliseSpring))).filter(flight => flight.departure.id && flight.arrival.id);
  // Spring availability returns a fare per adult seat. The supplied request
  // specification has no passenger-count fields, so CHD/INF amounts must be
  // verified by getSpecificPriceNew rather than guessed here.
  if (trip !== 'round') return { source: 'Spring Airlines', phase: 'outbound', trip, passengers, results: outbound };
  const returnData = await client.searchFlights(payload(arrival, departure, returnDate), token.accessToken);
  const returns = (await Promise.all((returnData.flightsList ?? []).map(normaliseSpring))).filter(flight => flight.departure.id && flight.arrival.id);
  return { source: 'Spring Airlines', phase: 'outbound', trip, passengers, results: outbound, roundPairs: outbound.slice(0, 3).flatMap(outboundFlight => returns.slice(0, 3).map(returnFlight => ({ outbound: outboundFlight, returnFlight, sameAirline: outboundFlight.airlineCode === returnFlight.airlineCode }))) };
}
async function searchFlights(url, res) {
  const departure = url.searchParams.get('departure')?.toUpperCase();
const arrival = url.searchParams.get('arrival')?.toUpperCase();
const date = url.searchParams.get('date');
const adults = url.searchParams.get('adults') || '1';
const children = url.searchParams.get('children') || '0';
const infants = url.searchParams.get('infants') || '0';
const passengers = { adults: Math.max(1, Number(adults) || 1), children: Math.max(0, Number(children) || 0), infants: Math.max(0, Number(infants) || 0) };
const trip = url.searchParams.get('trip') || 'oneway';
const returnDate = url.searchParams.get('returnDate');
const departureToken = url.searchParams.get('departureToken');
const airline = url.searchParams.get('airline')?.toUpperCase();
  if (getSpringStatus().httpJsonReady && !departureToken) {
    try { validateFlightSearch({ departure, arrival, date, trip, returnDate }); return send(res, 200, await searchSpringFlights({ departure, arrival, date, trip, returnDate, passengers })); }
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
  const query = url.searchParams.get('q')?.trim();
  if (!query || query.length < 2) return send(res, 200, { options: [] });
  try {
    const options = await searchAirports(query);
    // Spring-supported airports appear first; city and airport names themselves
    // still come from the English global airport directory.
    options.sort((left, right) => rankSpringAirport(left.code) - rankSpringAirport(right.code) || left.city.localeCompare(right.city));
    return send(res, 200, { options: options.map(option => ({ ...option, springSupported: rankSpringAirport(option.code) === 0 })) });
  }
  catch (error) { return send(res, 503, { error: error.message || 'Airport directory is unavailable.' }); }
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

const springPassenger = (traveller, contact, departureDate) => {
  const passengerType = SPRING_PASSENGER_TYPE[traveller.type];
  const gender = SPRING_GENDER[String(traveller.gender || '').toLowerCase()];
  const cardTypeId = SPRING_DOCUMENT_TYPE[String(traveller.documentType || '').toLowerCase()];
  const nationality = countryThreeCode(traveller.nationality);
  // Spring requires both nationality and document issuing country for
  // international bookings, even when they are the same country.
  const countryOfIssue = countryThreeCode(traveller.issuingCountry || traveller.nationality);
  const passportExpireDate = String(traveller.documentExpiry || '').trim();
  const phoneNo = String(contact.phone || '').replace(/[^\d]/g, '');
  const areaCode = String(contact.areaCode || '').replace(/[^\d]/g, '');
  if (!passengerType || !gender || !cardTypeId) throw new Error('Passenger type, gender and document type are required for Spring booking.');
  if (!nationality) throw new Error(`${traveller.lastName || 'Passenger'}: choose a nationality supported by the country list.`);
  if (!countryOfIssue) throw new Error(`${traveller.lastName || 'Passenger'}: choose the document issuing country from the country list.`);
  if (!parseDateOnly(passportExpireDate)) throw new Error(`${traveller.lastName || 'Passenger'}: document expiry is required.`);
  if (!phoneNo) throw new Error('A valid contact phone number is required for Spring booking.');
  if (!areaCode) throw new Error('A contact country calling code is required for Spring booking.');
  return {
    combXprodInfo: [],
    insuranceInfo: [],
    xprodInfo: [],
    passengerDetailInfo: {
      age: ageAtDeparture(parseDateOnly(traveller.dateOfBirth), parseDateOnly(departureDate)),
      areaCode,
      birthdate: traveller.dateOfBirth,
      cardNo: String(traveller.documentNumber || '').toUpperCase(),
      cardTypeId,
      countryOfIssue,
      familyName: String(traveller.lastName || '').toUpperCase(),
      personalName: String(traveller.firstName || '').toUpperCase(),
      gender,
      nationality,
      passengerType,
      passportExpireDate,
      phoneNo
    }
  };
};

const springSegmentPayload = (prefix, flight, passengerInfo) => {
  const spring = flight?.spring || {};
  const missing = [
    ['segment ID', spring.segHeadId], ['fare combination ID', spring.combId],
    ['fare combination type', spring.combType], ['adult cabin', spring.adultCabin]
  ].find(([, value]) => value === null || value === undefined || value === '');
  if (missing) throw new Error(`The selected ${prefix} flight is missing Spring ${missing[0]}. Search again and select its fare.`);
  return {
    [`${prefix}SegId`]: Number(spring.segHeadId),
    [`${prefix}CombId`]: Number(spring.combId),
    [`${prefix}CombType`]: Number(spring.combType),
    [`${prefix}CombPrice`]: Number(spring.combPrice ?? spring.seatPrice ?? flight.fare?.baseFare ?? 0),
    [`${prefix}SegAdultCabin`]: String(spring.adultCabin),
    [`${prefix}SegPassengerInfo`]: passengerInfo
  };
};

const createSpringBookingPayload = body => {
  const { itinerary, passengers } = body;
  const flights = itinerary?.flights || [];
  const [outbound, inbound] = flights;
  if (!outbound) throw new Error('Select an outbound flight before booking.');
  if (flights.length > 2) throw new Error('Connecting itinerary booking is not enabled yet.');
  const contact = passengers?.contact || {};
  if (!contact.name || !contact.phone || !contact.email) throw new Error('Contact name, phone and email are required.');
  const contactPhone = String(contact.phone).replace(/[^\d]/g, '');
  if (!contactPhone) throw new Error('Contact phone must contain digits.');
  const remoteIp = String(process.env.SPRING_REMOTE_IP || '').trim();
  // Spring marks remoteIp as NN (not-null) in the bookOrderC contract.
  // Fail clearly before calling Spring if the VPS IP has not been configured.
  if (!remoteIp) throw new Error('Spring booking is not configured: SPRING_REMOTE_IP (the whitelisted VPS IP) is required.');
  const passengerInfo = passengers.travellers.map(traveller => springPassenger(traveller, contact, itinerary.departureDate));
  const counts = passengers.travellers.reduce((total, traveller) => ({
    adults: total.adults + Number(traveller.type === 'ADT'),
    children: total.children + Number(traveller.type === 'CHD'),
    infants: total.infants + Number(traveller.type === 'INF')
  }), { adults: 0, children: 0, infants: 0 });
  const payload = {
    adultNum: counts.adults,
    childNum: counts.children,
    infantNum: counts.infants,
    lang: 'zh_cn',
    lcType: inbound ? 'Y' : 'N',
    linkmanEmail: contact.email,
    linkmanName: contact.name,
    linkmanWorkTel: contactPhone,
    moneyClassId: Number(outbound.spring?.moneyClassId ?? 0),
    remoteIp,
    ...springSegmentPayload('first', outbound, passengerInfo),
    // Explicit empty second/third segment values are required by Spring's
    // one-way schema. The inbound values below overwrite the second segment.
    secondSegId: 0,
    thirdSegId: 0,
    secondSegAdultCabin: '',
    thirdSegAdultCabin: '',
    secondCombId: null,
    thirdCombId: null,
    secondCombType: null,
    thirdCombType: null,
    secondCombPrice: null,
    thirdCombPrice: null,
    secondSegPassengerInfo: [],
    thirdSegPassengerInfo: []
  };
  if (inbound) Object.assign(payload, springSegmentPayload('second', inbound, passengerInfo));
  return payload;
};

const SPRING_ORDER_REFERENCE_KEYS = new Set([
  'orderno', 'ordernumber', 'pnr', 'pnrno', 'pnrcode', 'orderid', 'ordercode', 'recordlocator'
]);

const springOrderReference = (response, depth = 0) => {
  if (!response || depth > 7 || typeof response !== 'object') return null;
  // The booking gateway can return a successful reference directly in `content`.
  if (response.success === true && (typeof response.content === 'string' || typeof response.content === 'number') && String(response.content).trim()) {
    return String(response.content).trim();
  }
  for (const [key, value] of Object.entries(response)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (SPRING_ORDER_REFERENCE_KEYS.has(normalizedKey) && (typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value).trim();
    }
  }
  for (const value of Object.values(response)) {
    if (value && typeof value === 'object') {
      const found = springOrderReference(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
};

// Logs only field names and value types. This helps identify a new Spring response
// format without placing passenger data or any booking values in the server journal.
const springResponseShape = (value, depth = 0) => {
  if (value === null || value === undefined) return String(value);
  if (depth > 5 || typeof value !== 'object') return typeof value;
  if (Array.isArray(value)) return value.length ? [springResponseShape(value[0], depth + 1)] : [];
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, springResponseShape(item, depth + 1)]));
};

async function createLiveSpringBooking(profile, body) {
  if (process.env.SPRING_BOOKING_ENABLED !== 'true') throw new Error('Spring test booking is disabled on this server. Set SPRING_BOOKING_ENABLED=true only after confirming the test environment.');
  if (!getSpringStatus().httpJsonReady) throw new Error('Spring HTTP JSON API is not configured on this server.');
  const payload = createSpringBookingPayload(body);
  const client = createSpringClient();
  const token = await client.getAccessToken();
  const result = await client.bookOrder(payload, token.accessToken);
  if (result?.success === false || result?.flag === false) {
    const code = typeof result.code === 'string' || typeof result.code === 'number' ? ` (${result.code})` : '';
    const message = typeof result.message === 'string' && result.message.trim()
      ? result.message.trim()
      : 'Spring did not accept this booking request.';
    console.warn(`Spring booking rejected${code}: ${message}`);
    throw new Error(`Spring booking rejected${code}: ${message}`);
  }
  const pnr = springOrderReference(result);
  if (!pnr) {
    console.warn('Spring booking response has no recognised order reference:', JSON.stringify(springResponseShape(result)));
    throw new Error('Spring returned a booking response without a PNR/order number. No local booking was created.');
  }
  const itinerary = { ...body.itinerary, springOrder: { pnr, responseCode: result.errCode || null } };
  return createPortalBooking(profile, { ...body, itinerary, pnr, status: 'Reserved' });
}

createServer(async (req, res) => { const url = new URL(req.url, `http://${req.headers.host}`);
if (url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'flight-b2b-backend' });
if (url.pathname === '/api/backend/status') return send(res, 200, { spring: getSpringStatus(), supabase: getSupabaseStatus() });
if (url.pathname === '/api/fx/cny-mnt') { try { return send(res, 200, await getCnyMntRate()); } catch (error) { return send(res, 503, { error: error.message }); } }
if (url.pathname.startsWith('/api/office/users')) return handleOfficeUsers(req, res, url);
if (url.pathname.startsWith('/api/bookings')) { try {
  const profile = await profileForAccessToken(bearer(req));
  if (url.pathname === '/api/bookings' && req.method === 'GET') return send(res, 200, await listPortalBookings(profile));
  if (url.pathname === '/api/bookings' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.itinerary || !body.passengers) throw new Error('Itinerary and passenger details are required.');
    validateBookingPassengers(body);
    return send(res, 201, { booking: await createLiveSpringBooking(profile, body) });
  }
  const match = url.pathname.match(/^\/api\/bookings\/([A-Za-z0-9-]+)\/(issue|cancel)$/);
  if (match && req.method === 'POST') {
    const status = match[2] === 'issue' ? 'Ticketed' : 'Cancelled';
    return send(res, 200, { booking: await updatePortalBooking(profile, match[1], status) });
  }
  const noShowMatch = url.pathname.match(/^\/api\/bookings\/([A-Za-z0-9-]+)\/no-show$/);
  if (noShowMatch && req.method === 'POST') {
    return send(res, 200, { booking: await recordPortalBookingNoShow(profile, noShowMatch[1], await readJson(req)) });
  }
  return send(res, 404, { error: 'Booking endpoint not found.' });
} catch (error) { return send(res, 403, { error: error.message || 'Booking request is not allowed.' }); } }
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
