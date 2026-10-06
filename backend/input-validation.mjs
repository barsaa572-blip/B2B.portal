import { HttpError } from './request-security.mjs';
export function textField(value, label, { max = 200, optional = false } = {}) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[<>\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, `${label} is invalid or too long.`);
  return value.trim();
}
export function emailField(value) {
  const email = textField(value, 'Email address', { max:254 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email address is invalid.');
  return email;
}
// Lap infants do not occupy a seat: 9 seated passengers plus at most 1 infant/adult.
export function cleanPassengerCounts(value) {
  const counts = Object.fromEntries(['adults', 'children', 'infants'].map(key => {
    const raw = value?.[key];
    if (!['number', 'string'].includes(typeof raw) || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) throw new HttpError(400, 'Passenger counts must be whole numbers.');
    return [key, Number(raw)];
  }));
  if (counts.adults < 1 || counts.adults + counts.children > 9 || counts.infants > counts.adults) throw new HttpError(400, 'Maximum 9 adults and children combined; each lap infant requires an adult.');
  return counts;
}
export function cleanPassengers(value) {
  if (!value || !Array.isArray(value.travellers) || !value.travellers.length || value.travellers.length > 18) throw new HttpError(400, 'Supply at most 9 seated passengers and one lap infant per adult.');
  const counts = { adults: 0, children: 0, infants: 0 };
  for (const passenger of value.travellers) {
    const key = { ADT: 'adults', CHD: 'children', INF: 'infants' }[passenger?.type];
    if (!key || !Object.hasOwn(counts, key)) throw new HttpError(400, 'Passenger type is invalid.');
    counts[key]++;
  }
  cleanPassengerCounts(counts);
  const date = (v, label) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `${label} is invalid.`);
    const d = new Date(v + 'T00:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== v) throw new HttpError(400, `${label} is invalid.`);
    return v;
  };
  const pick = (v, values, label) => { if (!values.includes(v)) throw new HttpError(400, `${label} is invalid.`); return v; };
  const contact = value.contact || {};
  const phone = textField(contact.phone, 'Contact phone', {max:30});
  const areaCode = textField(contact.areaCode, 'Calling code', {max:6});
  if (!/^[+\d ()-]{5,30}$/.test(phone) || !/\d/.test(phone) || !/^\+?\d{1,5}$/.test(areaCode)) throw new HttpError(400, 'Contact phone or calling code is invalid.');
  return { contact: { name:textField(contact.name,'Contact name'), email:emailField(contact.email), phone, areaCode }, travellers:value.travellers.map(p => ({
    type:pick(p?.type,['ADT','CHD','INF'],'Passenger type'),
    firstName:textField(p.firstName,'First name',{max:100}), lastName:textField(p.lastName,'Last name',{max:100}),
    gender:pick(p.gender,['male','female'],'Gender'),
    dateOfBirth:date(p.dateOfBirth,'Date of birth'), documentExpiry:date(p.documentExpiry,'Document expiry'),
    documentType:pick(p.documentType,['passport','national id'],'Document type'),
    documentNumber:textField(p.documentNumber,'Document number',{max:40}),
    nationality:textField(p.nationality,'Nationality',{max:80}),
    ...(p.issuingCountry ? {issuingCountry:textField(p.issuingCountry,'Issuing country',{max:80})} : {})
  })) };
}
