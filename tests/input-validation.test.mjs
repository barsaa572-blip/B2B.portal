import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textField, emailField, cleanPassengers
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