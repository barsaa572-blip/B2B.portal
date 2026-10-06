import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textField, emailField, cleanPassengers, cleanPassengerCounts
} from '../backend/input-validation.mjs';

const valid = () => ({
  contact: {
    name: 'Test Agent',
    email: 'agent@example.com',
    phone: '99112233',
    areaCode: '+976'
  },
  travellers: [{
    type: 'ADT',
    firstName: 'Bataa',
    lastName: 'Dorj',
    gender: 'male',
    dateOfBirth: '1990-01-15',
    documentExpiry: '2030-02-28',
    documentType: 'passport',
    documentNumber: 'E1234567',
    nationality: 'Mongolia'
  }]
});

const invalid = fn => assert.throws(
  fn, error => error?.status === 400
);

test('valid passenger data is accepted without mutation', () => {
  const input = valid();
  const before = structuredClone(input);
  assert.deepEqual(cleanPassengers(input), before);
  assert.deepEqual(input, before);
});

test('unsafe text and invalid email are rejected', () => {
  for (const value of ['', '<script>', 'A\nB', 'A'.repeat(201)]) {
    invalid(() => textField(value, 'Name'));
  }
  invalid(() => emailField('invalid-email'));
});

test('phone must contain digits', () => {
  const input = valid();
  input.contact.phone = '+-----';
  invalid(() => cleanPassengers(input));
});

test('invalid dates and passenger types are rejected', () => {
  for (const [field, value] of [
    ['dateOfBirth', '2025-02-29'],
    ['documentExpiry', '2030-04-31'],
    ['type', 'ADMIN'],
    ['gender', 'unknown'],
    ['documentType', 'other']
  ]) {
    const input = valid();
    input.travellers[0][field] = value;
    invalid(() => cleanPassengers(input));
  }
});

test('passenger count is restricted', () => {
  invalid(() => cleanPassengers({ ...valid(), travellers: [] }));
  invalid(() => cleanPassengers({
    ...valid(),
    travellers: Array(10).fill(valid().travellers[0])
  }));
});

test('extra role, agency and price fields are removed', () => {
  const input = valid();
  const expected = structuredClone(input);
  for (const target of [input, input.contact, input.travellers[0]]) {
    Object.assign(target, {
      role: 'platform_admin',
      agencyId: 'another-agency',
      price: 1
    });
  }
  assert.deepEqual(cleanPassengers(input), expected);
});

test('seat limit excludes lap infants and supports 9 adults with 9 infants', () => {
  const party = (adults, children, infants) => ({ ...valid(), travellers: [
    ...Array.from({ length: adults }, () => ({ ...valid().travellers[0], type: 'ADT' })),
    ...Array.from({ length: children }, () => ({ ...valid().travellers[0], type: 'CHD' })),
    ...Array.from({ length: infants }, () => ({ ...valid().travellers[0], type: 'INF' }))
  ] });
  for (const [adults, children, infants] of [[9, 0, 9], [6, 3, 6], [1, 8, 1]]) {
    const input = party(adults, children, infants), before = structuredClone(input);
    assert.deepEqual(cleanPassengers(input), before);
    assert.deepEqual(input, before);
  }
  for (const counts of [[9, 1, 0], [6, 4, 0], [6, 3, 7], [0, 1, 0], [0, 0, 1]]) invalid(() => cleanPassengers(party(...counts)));
});

test('search/pricing counts reject malformed numbers instead of silently correcting them', () => {
  assert.deepEqual(cleanPassengerCounts({ adults: '9', children: '0', infants: '9' }), { adults: 9, children: 0, infants: 9 });
  for (const key of ['adults', 'children', 'infants']) for (const raw of ['', ' ', '1.5', -1, NaN, Infinity, true, null, {}, '1e0', '0x1', '9007199254740993']) {
    invalid(() => cleanPassengerCounts({ adults: 1, children: 0, infants: 0, [key]: raw }));
  }
});
