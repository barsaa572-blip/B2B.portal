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
export function cleanPassengers(value) {
  if (!value || !Array.isArray(value.travellers) || !value.travellers.length || value.travellers.length > 9) throw new HttpError(400, 'Supply between 1 and 9 passengers.');
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
