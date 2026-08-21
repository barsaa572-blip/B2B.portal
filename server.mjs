import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpringClient, getSpringStatus } from './backend/spring-client.mjs';
import { airportByCode, searchAirports } from './backend/airport-directory.mjs';
import { rankSpringAirport } from './backend/spring-route-directory.mjs';
import { getCnyMntRate, quoteCnyToMnt } from './backend/fx-rate.mjs';
import { createOfficeAgent, getOfficeUserAccess, requireOfficeManager, updateOfficeAgent } from './backend/supabase-client.mjs';
import { adjustWallet, approveTopupRequest, assertWalletFunds, clearAllWalletBalancesAndHistory, createAgency, createPortalBooking, createTopupRequest, createUser, deleteAgency, deleteTopupRequest, deleteUser, expireTicketingDeadlineBookings, getAdminOverview, getSupabaseStatus, getTopupInvoice, getTopupRequests, getWalletDetails, listPortalBookings, profileForAccessToken, requirePlatformAdmin, signInWithPassword, syncPortalBookingFromSpring, updateAgency, updatePortalBooking, updateUser } from './backend/supabase-client.mjs';

const PORT = Number(process.env.PORT || 4173);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const send = (res, status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data)); };
const sendPdf = (res, filename, content) => {
  res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
    'content-length': content.length
  });
  res.end(content);
};
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
const pdfSafeText = value => String(value ?? '')
  .normalize('NFKD').replace(/[^\x20-\x7e]/g, '?')
  .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const pdfWrappedLines = lines => lines.flatMap(line => {
  const text = String(line ?? '');
  if (!text) return [''];
  const words = text.split(/\s+/); const chunks = []; let current = '';
  words.forEach(word => { const next = current ? `${current} ${word}` : word; if (next.length > 88 && current) { chunks.push(current); current = word; } else current = next; });
  if (current) chunks.push(current);
  return chunks;
});
const simplePdf = lines => {
  const pages = []; const wrapped = pdfWrappedLines(lines);
  for (let index = 0; index < wrapped.length || !pages.length; index += 52) pages.push(wrapped.slice(index, index + 52));
  const objects = [];
  const pageRefs = pages.map((_, index) => 3 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const fontRef = 3 + pages.length * 2;
  pages.forEach((page, index) => {
    const pageRef = 3 + index * 2; const contentRef = pageRef + 1;
    const text = page.map((line, lineIndex) => `${lineIndex ? 'T* ' : ''}(${pdfSafeText(line)}) Tj`).join('\n');
    const stream = `BT\n/F1 10 Tf\n50 792 Td\n14 TL\n${text}\nET`;
    objects[pageRef] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRef} 0 R >>`;
    objects[contentRef] = `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontRef] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let output = '%PDF-1.4\n%PDF generated by Flight B2B\n'; const offsets = [0];
  for (let index = 1; index <= fontRef; index += 1) { offsets[index] = Buffer.byteLength(output, 'ascii'); output += `${index} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(output, 'ascii'); output += `xref\n0 ${fontRef + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= fontRef; index += 1) output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${fontRef + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, 'ascii');
};
const bookingDocumentLines = async (booking, type) => {
  const rate = await getCnyMntRate();
  const mntAmount = value => `MNT ${quoteCnyToMnt(Number(value || 0), rate).toLocaleString('en-US')}`;
  const title = type === 'receipt' ? 'FLIGHT B2B - TRAVEL RECEIPT' : 'FLIGHT B2B - ELECTRONIC TICKET SUMMARY';
  const lines = [title, '', `PNR: ${booking.pnr}`, `Status: ${booking.status}`, `Created: ${new Date(booking.created_at).toLocaleString('en-GB')}`, ''];
  lines.push('ITINERARY');
  const flights = Array.isArray(booking.itinerary?.flights) ? booking.itinerary.flights : [];
  flights.forEach((flight, index) => {
    const label = flights.length === 1 ? 'ONE WAY' : index ? 'RETURN' : 'OUTBOUND';
    const date = flight.travelDate || (index ? booking.itinerary?.returnDate : booking.itinerary?.departureDate) || 'Date pending';
    lines.push(`${label}: ${date} | ${flight.departure?.id || ''} ${String(flight.departure?.time || '').slice(-5)} -> ${flight.arrival?.id || ''} ${String(flight.arrival?.time || '').slice(-5)}`);
    lines.push(`  ${flight.airline || 'Spring Airlines'} ${flight.number || ''} | ${flight.fare?.cabin || 'Economy'}`);
  });
  lines.push('', 'PASSENGERS');
  (booking.passengers?.travellers || []).forEach((traveller, index) => {
    lines.push(`${index + 1}. ${traveller.lastName || ''} / ${traveller.firstName || ''} (${traveller.type || 'ADT'})`);
    lines.push(`   Passport: ${traveller.documentNumber || '—'} | DOB: ${traveller.dateOfBirth || '—'} | Nationality: ${traveller.nationality || '—'} | Expiry: ${traveller.documentExpiry || '—'} | Gender: ${traveller.gender || '—'}`);
  });
  const contact = booking.passengers?.contact || {};
  lines.push('', 'CONTACT', `Name: ${contact.name || '—'}`, `Phone: ${contact.phone || '—'}`, `Email: ${contact.email || '—'}`);
  const flightFares = flights.map(flight => flight.fare || {});
  const base = flightFares.reduce((sum, fare) => sum + Number(fare.baseFare || 0), 0);
  const taxes = flightFares.reduce((sum, fare) => sum + Number(fare.taxes || 0), 0);
  const raw = base + taxes;
  const total = Number(booking.total_cny || 0);
  const fareAmount = raw ? total * (base / raw) : total;
  const taxAmount = Math.max(0, total - fareAmount);
  lines.push('', 'PRICE BREAKDOWN', `Fare: ${mntAmount(fareAmount)}`, `Taxes and fees: ${mntAmount(taxAmount)}`, `Total: ${mntAmount(total)}`, `Exchange rate used: 1 CNY = MNT ${rate.effectiveRateMnt.toLocaleString('en-US')}`);
  lines.push('', type === 'receipt' ? 'This travel receipt is generated by Flight B2B Portal.' : 'Present this document together with the traveller passport at check-in.');
  return lines;
};
// A compact, airline-style document for the downloadable electronic ticket.
// Passengers deliberately remain on the same PNR document and are printed one
// below another; this avoids producing a separate file for each traveller.
const ticketPdf = async booking => {
  const rate = await getCnyMntRate();
  const mnt = value => `MNT ${quoteCnyToMnt(Number(value || 0), rate).toLocaleString('en-US')}`;
  const pages = []; let commands = []; let y = 790;
  const text = (value, x, top, size = 10, bold = false, colour = '0.06 0.15 0.29') => {
    commands.push(`${colour} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${top} Tm (${pdfSafeText(value)}) Tj ET`);
  };
  const fill = (x, top, width, height, colour) => commands.push(`${colour} rg ${x} ${top - height} ${width} ${height} re f`);
  const stroke = (x, top, width, height, colour = '0.79 0.84 0.92') => commands.push(`${colour} RG 0.7 w ${x} ${top - height} ${width} ${height} re S`);
  const rule = (x1, top, x2, colour = '0.79 0.84 0.92') => commands.push(`${colour} RG 0.6 w ${x1} ${top} m ${x2} ${top} l S`);
  const newPage = () => {
    if (commands.length) pages.push(commands.join('\n')); commands = []; y = 790;
    fill(0, 842, 595, 42, '0.08 0.25 0.55');
    text('FLIGHT B2B  |  ELECTRONIC TICKET', 36, 817, 15, true, '1 1 1');
    text(`PNR ${booking.pnr}`, 440, 817, 11, true, '1 1 1');
    y = 775;
  };
  const ensure = required => { if (y - required < 55) newPage(); };
  newPage();
  text('Travel itinerary', 36, y, 18, true); text(`Status: ${booking.status}`, 430, y + 2, 10, true, booking.status === 'Ticketed' ? '0 0.48 0.29' : '0.52 0.34 0'); y -= 26;
  text(`Prepared on ${new Date(booking.created_at).toLocaleString('en-GB')}`, 36, y, 9, false, '0.36 0.43 0.54'); y -= 20;
  const flights = Array.isArray(booking.itinerary?.flights) ? booking.itinerary.flights : [];
  flights.forEach((flight, index) => {
    ensure(132);
    const label = flights.length === 1 ? 'ONE WAY' : index ? 'RETURN' : 'DEPARTURE';
    const date = flight.travelDate || (index ? booking.itinerary?.returnDate : booking.itinerary?.departureDate) || 'Travel date pending';
    fill(36, y, 523, 23, '0.93 0.96 1'); text(`${label}  |  ${date}`, 47, y - 15, 10, true, '0.10 0.30 0.70'); y -= 32;
    stroke(36, y, 523, 83);
    text(`${flight.airline || 'Spring Airlines'}  ${flight.number || ''}`, 49, y - 21, 13, true);
    text(`Cabin: ${flight.fare?.cabin || 'Economy'}   |   ${flight.duration || 'Nonstop'}`, 49, y - 40, 9, false, '0.36 0.43 0.54');
    rule(230, y - 29, 230, '0.86 0.89 0.94');
    text(String(flight.departure?.time || '').slice(-5) || '--:--', 250, y - 22, 14, true);
    text(`${flight.departure?.id || '---'}  ${flight.departure?.name || ''}`, 250, y - 43, 10, true);
    text('to', 386, y - 35, 9, false, '0.36 0.43 0.54');
    text(String(flight.arrival?.time || '').slice(-5) || '--:--', 414, y - 22, 14, true);
    text(`${flight.arrival?.id || '---'}  ${flight.arrival?.name || ''}`, 414, y - 43, 10, true);
    y -= 99;
  });
  ensure(48); text('Passengers', 36, y, 16, true); y -= 18;
  const travellers = booking.passengers?.travellers || [];
  travellers.forEach((traveller, index) => {
    ensure(67); fill(36, y, 523, 20, '0.95 0.97 1');
    text(`${index + 1}. ${traveller.lastName || ''} / ${traveller.firstName || ''}`, 47, y - 14, 11, true);
    text(traveller.type || 'ADT', 515, y - 14, 9, true, '0.10 0.30 0.70'); y -= 29;
    text(`Passport: ${traveller.documentNumber || '—'}     Date of birth: ${traveller.dateOfBirth || '—'}     Gender: ${traveller.gender || '—'}`, 47, y - 13, 9);
    text(`Nationality: ${traveller.nationality || '—'}     Passport expiry: ${traveller.documentExpiry || '—'}`, 47, y - 30, 9);
    y -= 46;
  });
  ensure(100); rule(36, y, 559); y -= 20; text('Fare summary', 36, y, 16, true); y -= 20;
  const fares = flights.map(flight => flight.fare || {}); const base = fares.reduce((sum, fare) => sum + Number(fare.baseFare || 0), 0); const taxes = fares.reduce((sum, fare) => sum + Number(fare.taxes || 0), 0); const total = Number(booking.total_cny || 0); const fareAmount = base + taxes ? total * (base / (base + taxes)) : total;
  text('Fare', 48, y, 10); text(mnt(fareAmount), 425, y, 10, true); y -= 19;
  text('Taxes and fees', 48, y, 10); text(mnt(Math.max(0, total - fareAmount)), 425, y, 10, true); y -= 19;
  rule(36, y + 7, 559); text('TOTAL', 48, y - 8, 12, true); text(mnt(total), 405, y - 8, 14, true, '0.86 0.40 0'); y -= 35;
  text('Please verify all flight times before travel. Present this document with the traveller passport at check-in.', 36, y, 8, false, '0.36 0.43 0.54');
  pages.push(commands.join('\n'));
  const objects = []; const pageRefs = pages.map((_, index) => 3 + index * 2); const normalFont = 3 + pages.length * 2; const boldFont = normalFont + 1;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((page, index) => { const pageRef = 3 + index * 2; const contentRef = pageRef + 1; objects[pageRef] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${normalFont} 0 R /F2 ${boldFont} 0 R >> >> /Contents ${contentRef} 0 R >>`; objects[contentRef] = `<< /Length ${Buffer.byteLength(page, 'ascii')} >>\nstream\n${page}\nendstream`; });
  objects[normalFont] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'; objects[boldFont] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  let output = '%PDF-1.4\n%PDF generated by Flight B2B\n'; const offsets = [0];
  for (let index = 1; index <= boldFont; index += 1) { offsets[index] = Buffer.byteLength(output, 'ascii'); output += `${index} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(output, 'ascii'); output += `xref\n0 ${boldFont + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= boldFont; index += 1) output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${boldFont + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, 'ascii');
};
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

const findRefundCalculation = (value, depth = 0) => {
  if (!value || depth > 7 || typeof value !== 'object') return null;
  if (['retRealMoney', 'retNetMoney', 'retAllMoney', 'qxxFy'].some(key => Object.hasOwn(value, key))) return value;
  for (const item of Object.values(value)) {
    const found = findRefundCalculation(item, depth + 1);
    if (found) return found;
  }
  return null;
};

const springAmount = (source, key) => {
  const value = Number(source?.[key]);
  return Number.isFinite(value) ? value : null;
};

async function calculateLiveSpringRefund(profile, pnr) {
  const booking = (await listPortalBookings(profile)).find(item => item.pnr === pnr);
  if (!booking) throw new Error('Booking not found or you do not have access to it.');
  if (booking.status !== 'Ticketed') throw new Error('Only a ticketed booking can be calculated for cancellation.');
  if (!getSpringStatus().httpJsonReady) throw new Error('Spring HTTP JSON API is not configured on this server.');

  const client = createSpringClient();
  const token = await client.getAccessToken();
  // calcType O is Spring's full-order / full-PNR calculation. Spring's JSON demo
  // still includes an empty orderHeadIds array for a full-order calculation, so
  // preserve that shape rather than omitting the field. Partial refunds will pass
  // the actual IDs once they are synchronised from the XML order-detail service.
  const result = await client.calculateRefund({ orderId: pnr, calcType: 'O', orderHeadIds: [] }, token.accessToken);
  if (result?.success === false || result?.flag === false) {
    throw new Error(result?.message || result?.errMsg || 'Spring did not accept the refund calculation.');
  }
  const quote = findRefundCalculation(result) || result;
  return {
    bookingRef: pnr,
    calcType: 'O',
    source: 'Spring Airlines',
    amountsCny: {
      ticketAmount: springAmount(quote, 'retAllMoney'),
      refundableFare: springAmount(quote, 'retTktMoney'),
      refundableTaxes: ['retPortMoney', 'retFuelMoney', 'retInsMoney', 'retXMoney', 'retOtherFy']
        .map(key => springAmount(quote, key) || 0).reduce((sum, value) => sum + value, 0),
      cancellationFee: springAmount(quote, 'qxxFy'),
      nonRefundable: springAmount(quote, 'nrfndOtherFy'),
      refund: springAmount(quote, 'retRealMoney') ?? springAmount(quote, 'retNetMoney') ?? springAmount(quote, 'retAllMoney')
    },
    message: typeof result?.message === 'string' ? result.message : null
  };
}

// `orderRetrieve` is an OTA order document and Spring may nest segment data
// differently by product type.  Read the common date/time fields recursively
// so an older portal booking can still display the real Spring travel date
// after it is synchronised.
const springDateOnly = value => {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value).trim();
  const matched = text.match(/(20\d{2})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if (matched) return `${matched[1]}-${matched[2]}-${matched[3]}`;
  if (/^\d{12,13}$/.test(text)) {
    const date = new Date(Number(text));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return '';
};

const springClock = value => {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value).trim();
  const matched = text.match(/(?:T|\s)(\d{2}:\d{2})(?::\d{2})?/);
  if (matched) return matched[1];
  return /^\d{2}:\d{2}$/.test(text) ? text : '';
};

const collectSpringSegmentFields = value => {
  const fields = [];
  const visit = (node, path = '') => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((item, index) => visit(item, `${path}[${index}]`));
    Object.entries(node).forEach(([key, item]) => {
      const nextPath = `${path}.${key}`.toLowerCase();
      if (item && typeof item === 'object') visit(item, nextPath);
      else fields.push({ key: nextPath, value: item });
    });
  };
  visit(value);
  return fields;
};

const firstSpringField = (fields, pattern) => fields.find(field => pattern.test(field.key))?.value;

const springCollection = value => Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);

const springFlightNumber = fields => {
  const value = firstSpringField(fields, /(?:^|\.)(?:flightno|flightnumber|flight_code|flightcode)$/);
  return value ? String(value).trim().toUpperCase() : '';
};

const springItemSchedule = item => {
  const fields = collectSpringSegmentFields(item);
  // Spring has used several response schemas over time.  Limit the candidates
  // to flight/segment fields so passenger birth/passport dates are never used.
  const departureDateValue = firstSpringField(fields, /(?:ori|departure|depart|start).*(?:time|date)|(?:time|date).*(?:ori|departure|depart|start)|(?:^|\.)(?:flightdate|flightday|departdate)$/);
  const arrivalDateValue = firstSpringField(fields, /(?:dest|arrival|arrive|end).*(?:time|date)|(?:time|date).*(?:dest|arrival|arrive|end)/);
  const departureCode = firstSpringField(fields, /(?:ori|departure|depart).*(?:airport|city)?code$/);
  const arrivalCode = firstSpringField(fields, /(?:dest|arrival|arrive).*(?:airport|city)?code$/);
  const travelDate = springDateOnly(departureDateValue);
  return travelDate ? {
    travelDate,
    flightNumber: springFlightNumber(fields),
    departureTime: springClock(departureDateValue),
    arrivalTime: springClock(arrivalDateValue),
    departureCode: departureCode ? portalAirportCode(departureCode) : '',
    arrivalCode: arrivalCode ? portalAirportCode(arrivalCode) : ''
  } : null;
};

const springOrderSummary = result => {
  const order = springCollection(result?.response?.order)[0] || null;
  if (!order) throw new Error('Spring order query returned no order data.');
  const orderItems = springCollection(order.orderItem);
  const status = String(order.statusCode || '').toUpperCase();
  const ticketNumbers = [];
  const collectTickets = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(collectTickets);
    for (const [key, item] of Object.entries(value)) {
      if (/ticket(number|document|doc)/i.test(key) && typeof item === 'string' && item.trim()) ticketNumbers.push(item.trim());
      else collectTickets(item);
    }
  };
  collectTickets(result?.response?.ticketDocInfo);
  const itemDetails = orderItems.map((item, index) => {
    const statusCode = String(item.statusCode || item.status || '').trim().toUpperCase();
    const schedule = springItemSchedule(item);
    // Spring's order-retrieve service is the authority for whether a segment
    // has been used. Keep its raw code too: the precise codes vary by product.
    const segmentStatus = /NO[ _-]?SHOW/.test(statusCode) ? 'no-show'
      : /FLOWN|USED|BOARDED/.test(statusCode) ? 'flown'
        : /CANCEL|REFUND|VOID/.test(statusCode) ? 'cancelled'
          : statusCode === 'SOLDTICKET' ? 'ticketed' : 'reserved';
    return {
      index,
      orderItemId: String(item.orderItemID || item.orderItemId || ''),
      statusCode,
      segmentStatus,
      ...(schedule || {})
    };
  });
  const schedules = itemDetails.filter(item => item.travelDate);
  return {
    status,
    ticketed: status === 'PAID' && orderItems.length > 0 && orderItems.every(item => String(item.statusCode || '').toUpperCase() === 'SOLDTICKET'),
    orderItemIds: orderItems.map(item => String(item.orderItemID || '')).filter(Boolean),
    ticketNumbers: [...new Set(ticketNumbers)],
    schedules,
    itemDetails
  };
};

async function syncSpringOrder(profile, pnr) {
  if (!getSpringStatus().httpJsonReady) throw new Error('Spring HTTP JSON API is not configured on this server.');
  const client = createSpringClient();
  const token = await client.getAccessToken();
  const result = await client.orderRetrieve({ request: { orderFilterCriteria: { order: { orderID: pnr, ownerCode: '' } } } }, token.accessToken);
  return syncPortalBookingFromSpring(profile, pnr, springOrderSummary(result));
}

// Spring's change-availability endpoint works one requested date at a time.
// Keep this server-side: the browser must not receive an OAuth token and we
// also verify that the requested order item belongs to the signed-in agency.
const changeCalendarCache = new Map();
const changeCalendarKey = (pnr, orderItemId, month) => `${pnr}:${orderItemId}:${month}`;
const calendarDate = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const changeFlightSummary = flight => ({
  segmentHeadId: Number(flight.segmentHeadId),
  flightNo: String(flight.flightNo || ''),
  departure: {
    code: portalAirportCode(flight.oriAirportCode || flight.oriCityCode),
    name: springText(flight.oriAirportName || flight.oriCityName || ''),
    time: springTime(flight.oriTimeBJ)
  },
  arrival: {
    code: portalAirportCode(flight.destAirportCode || flight.destCityCode),
    name: springText(flight.destAirportName || flight.destCityName || ''),
    time: springTime(flight.destTimeBJ)
  },
  aircraft: springText(flight.acType || ''),
  bookingClass: springText(flight.bgSeatName || ''),
  // `bgShengcangMoney` is the fare difference returned by Spring for this
  // replacement option. The final change fee is calculated separately.
  fareDifferenceCny: Number(flight.bgShengcangMoney || 0)
});

async function getLiveChangeCalendar(profile, pnr, orderItemId, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Month must use YYYY-MM format.');
  const booking = (await listPortalBookings(profile)).find(item => item.pnr === pnr);
  if (!booking) throw new Error('Booking not found or you do not have access to it.');
  if (booking.status !== 'Ticketed') throw new Error('Only a ticketed booking can be changed.');
  const allowedIds = (booking.itinerary?.springOrder?.orderItemIds || []).map(String);
  if (!allowedIds.includes(String(orderItemId))) throw new Error('This order item does not belong to the selected booking.');
  if (!getSpringStatus().httpJsonReady) throw new Error('Spring HTTP JSON API is not configured on this server.');

  const key = changeCalendarKey(pnr, orderItemId, month);
  const cached = changeCalendarCache.get(key);
  // A change calendar is pre-warmed while the booking detail is open. Keep it
  // briefly so opening the Change dialog is immediate, while still refreshing
  // frequently enough for live availability and fare differences.
  if (cached && Date.now() - cached.createdAt < 5 * 60_000) return cached.value;

  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);
  const client = createSpringClient();
  const token = await client.getAccessToken();
  const dates = Array.from({ length: daysInMonth }, (_, index) => calendarDate(year, monthNumber, index + 1));
  const items = new Array(dates.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < dates.length) {
      const index = cursor++;
      const date = dates[index];
      if (date < today) { items[index] = { date, available: false, past: true, flights: [] }; continue; }
      try {
        const newTimeLBegin = Date.parse(`${date}T00:00:00+08:00`);
        const result = await client.getChangeInfo({ lang: 'zh_cn', newTimeLBegin, orderHeadId: Number(orderItemId) }, token.accessToken);
        const flights = (result.bgFlightInfoList || []).map(changeFlightSummary).filter(flight => Number.isFinite(flight.segmentHeadId) && flight.flightNo);
        const differences = flights.map(flight => flight.fareDifferenceCny).filter(Number.isFinite);
        items[index] = { date, available: flights.length > 0, past: false, fareDifferenceCny: differences.length ? Math.min(...differences) : null, flights };
      } catch (error) {
        // A date without an eligible replacement is shown as unavailable. Do
        // not expose opaque upstream errors for every individual calendar day.
        items[index] = { date, available: false, past: false, flights: [] };
      }
    }
  };
  // Spring handles the calls independently. Eight workers keep a full month
  // responsive without sending all 28–31 requests at once.
  await Promise.all(Array.from({ length: Math.min(8, dates.length) }, worker));
  const value = { source: 'Spring Airlines', pnr, orderItemId: String(orderItemId), month, items };
  changeCalendarCache.set(key, { createdAt: Date.now(), value });
  return value;
}

createServer(async (req, res) => { const url = new URL(req.url, `http://${req.headers.host}`);
if (url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'flight-b2b-backend' });
if (url.pathname === '/api/backend/status') return send(res, 200, { spring: getSpringStatus(), supabase: getSupabaseStatus() });
if (url.pathname === '/api/fx/cny-mnt') { try { return send(res, 200, await getCnyMntRate()); } catch (error) { return send(res, 503, { error: error.message }); } }
if (url.pathname.startsWith('/api/office/users')) return handleOfficeUsers(req, res, url);
if (url.pathname.startsWith('/api/bookings')) { try {
  const profile = await profileForAccessToken(bearer(req));
  if (url.pathname === '/api/bookings' && req.method === 'GET') {
    await expireTicketingDeadlineBookings();
    return send(res, 200, await listPortalBookings(profile));
  }
  if (url.pathname === '/api/bookings' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.itinerary || !body.passengers) throw new Error('Itinerary and passenger details are required.');
    validateBookingPassengers(body);
    return send(res, 201, { booking: await createLiveSpringBooking(profile, body) });
  }
  const documentMatch = url.pathname.match(/^\/api\/bookings\/([A-Za-z0-9-]+)\/(ticket|receipt)\.pdf$/);
  if (documentMatch && req.method === 'GET') {
    const [, pnr, documentType] = documentMatch;
    const booking = (await listPortalBookings(profile)).find(item => item.pnr === pnr);
    if (!booking) throw new Error('Booking not found or you do not have access to it.');
    if (booking.status !== 'Ticketed') throw new Error('Ticket and receipt PDFs are available after the ticket is issued.');
    const content = documentType === 'ticket'
      ? await ticketPdf(booking)
      : simplePdf(await bookingDocumentLines(booking, documentType));
    return sendPdf(res, `${pnr}-${documentType}.pdf`, content);
  }
  const refundQuoteMatch = url.pathname.match(/^\/api\/bookings\/([A-Za-z0-9-]+)\/refund-quote$/);
  if (refundQuoteMatch && req.method === 'POST') {
    return send(res, 200, { quote: await calculateLiveSpringRefund(profile, refundQuoteMatch[1]) });
  }
  const changeCalendarMatch = url.pathname.match(/^\/api\/bookings\/([A-Za-z0-9-]+)\/change-calendar$/);
  if (changeCalendarMatch && req.method === 'GET') {
    const orderItemId = url.searchParams.get('orderItemId');
    const month = url.searchParams.get('month');
    if (!/^\d+$/.test(String(orderItemId || ''))) throw new Error('A valid Spring order item is required.');
    return send(res, 200, await getLiveChangeCalendar(profile, changeCalendarMatch[1], orderItemId, month));
  }
  const syncMatch = url.pathname.match(/^\/api\/bookings\/([A-Za-z0-9-]+)\/sync$/);
  if (syncMatch && req.method === 'POST') return send(res, 200, { booking: await syncSpringOrder(profile, syncMatch[1]) });
  const changeWalletMatch = url.pathname.match(/^\/api\/bookings\/([A-Za-z0-9-]+)\/change-wallet-check$/);
  if (changeWalletMatch && req.method === 'POST') {
    const body = await readJson(req);
    const booking = (await listPortalBookings(profile)).find(item => item.pnr === changeWalletMatch[1]);
    if (!booking) throw new Error('Booking not found or you do not have access to it.');
    const amountCny = Number(body.amountCny);
    if (!Number.isFinite(amountCny) || amountCny < 0) throw new Error('A valid additional payment amount is required.');
    return send(res, 200, { wallet: await assertWalletFunds({ agencyId: booking.agency_id, amountCny, actorId: profile.id }) });
  }
  const match = url.pathname.match(/^\/api\/bookings\/([A-Za-z0-9-]+)\/(issue|cancel)$/);
  if (match && req.method === 'POST') {
    const status = match[2] === 'issue' ? 'Ticketed' : 'Cancelled';
    return send(res, 200, { booking: await updatePortalBooking(profile, match[1], status) });
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
const amountMnt = Number(body.amountMnt);
if (!Number.isFinite(amountMnt) || amountMnt <= 0) throw new Error('Top-up amount must be greater than zero.');
const invoice = await createTopupRequest({ profile, amountMnt, paymentReference: body.paymentReference, note: body.note }); return send(res, 201, { invoice, downloadUrl: `/api/invoices/${invoice.id}` }); } const topupMatch = url.pathname.match(/^\/api\/topups\/([\w-]+)$/);
if (topupMatch && req.method === 'DELETE') { await deleteTopupRequest(profile, topupMatch[1]); return send(res, 200, { ok: true }); } const invoiceMatch = url.pathname.match(/^\/api\/invoices\/([\w-]+)$/);
if (invoiceMatch && req.method === 'GET') { const invoice = await getTopupInvoice(profile, invoiceMatch[1]); return send(res, 200, invoiceDocument(invoice), 'text/html; charset=utf-8'); } return send(res, 404, { error: 'Invoice endpoint not found.' }); } catch (error) { return send(res, 403, { error: error.message || 'Request not allowed.' }); } } if (url.pathname.startsWith('/api/admin/')) { try { const admin = await requirePlatformAdmin(bearer(req));
if (url.pathname === '/api/admin/overview' && req.method === 'GET') return send(res, 200, await getAdminOverview());
if (url.pathname === '/api/admin/wallet-reset' && req.method === 'POST') { const body = await readJson(req);
if (body.confirmation !== 'RESET WALLETS') throw new Error('Confirmation text must be RESET WALLETS.');
await clearAllWalletBalancesAndHistory({ createdBy: admin.id }); return send(res, 200, { ok: true }); }
const approveMatch = url.pathname.match(/^\/api\/admin\/topups\/([\w-]+)\/approve$/);
if (approveMatch && req.method === 'POST') { await approveTopupRequest(approveMatch[1], admin.id); return send(res, 200, { ok: true }); } const agencyMatch = url.pathname.match(/^\/api\/admin\/agencies\/([\w-]+)$/);
const userMatch = url.pathname.match(/^\/api\/admin\/users\/([\w-]+)$/);
if (agencyMatch && req.method === 'PATCH') { const body = await readJson(req); return send(res, 200, await updateAgency(agencyMatch[1], { name: requiredText(body.name, 'Agency name'), active: Boolean(body.active) })); } if (agencyMatch && req.method === 'DELETE') { await deleteAgency(agencyMatch[1]); return send(res, 200, { ok: true }); } if (userMatch && req.method === 'PATCH') { const body = await readJson(req);
if (userMatch[1] === admin.id && body.active === false) throw new Error('You cannot deactivate your own administrator account.');
const role = ['agent', 'office_manager', 'platform_admin'].includes(body.role) ? body.role : null;
if (!role) throw new Error('Valid role is required.'); return send(res, 200, await updateUser(userMatch[1], { fullName: requiredText(body.fullName, 'Full name'), agencyId: body.agencyId, branchId: body.branchId, role, active: Boolean(body.active) })); } if (userMatch && req.method === 'DELETE') { if (userMatch[1] === admin.id) throw new Error('You cannot delete your own administrator account.'); await deleteUser(userMatch[1]); return send(res, 200, { ok: true }); } const body = await readJson(req);
if (url.pathname === '/api/admin/agencies' && req.method === 'POST') { const name = requiredText(body.name, 'Agency name'); const initialBalanceMnt = Number(body.initialBalanceMnt || 0); if (!Number.isFinite(initialBalanceMnt) || initialBalanceMnt < 0) throw new Error('Opening balance must be a valid MNT amount.'); const rate = await getCnyMntRate(); const initialBalance = initialBalanceMnt / Number(rate.effectiveRateMnt); return send(res, 201, await createAgency({ name, branchName: body.branchName, initialBalance })); } if (url.pathname === '/api/admin/users' && req.method === 'POST') { const email = requiredText(body.email, 'Email');
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
if (!file.startsWith(normalize(ROOT))) return send(res, 403, 'Forbidden', 'text/plain'); try { send(res, 200, await readFile(file), MIME[extname(file)] || 'application/octet-stream'); } catch { send(res, 404, 'Not found', 'text/plain'); } }).listen(PORT, '127.0.0.1', () => {
  console.log(`Flight B2B Portal listening on http://127.0.0.1:${PORT}`);
  const reconcileExpiredReservations = async () => {
    try { await expireTicketingDeadlineBookings(); }
    catch (error) { console.error('Ticketing deadline reconciliation failed:', error.message); }
  };
  void reconcileExpiredReservations();
  setInterval(reconcileExpiredReservations, 60_000).unref();
});
