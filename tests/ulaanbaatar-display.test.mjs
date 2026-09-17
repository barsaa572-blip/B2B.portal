import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('directory offers UBN once and accepts legacy ULN queries', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => ({ ok: true, text: async () => [
    'iata_code,type,scheduled_service,municipality,name,iso_country',
    'UBN,large_airport,yes,Ulaanbaatar,Chinggis Khaan International Airport,MN',
    'ULN,medium_airport,yes,Ulaanbaatar,Old airport,MN',
    'PVG,large_airport,yes,Shanghai,Pudong,CN'
  ].join('\n') });
  const { searchAirports, airportByCode } = await import('../backend/airport-directory.mjs');
  for (const query of ['Ulaanbaatar', 'UBN', 'ULN']) {
    const results = await searchAirports(query);
    assert.deepEqual(results.map(row => row.code), ['UBN']);
  }
  assert.equal((await airportByCode('ULN')).code, 'UBN');
  assert.equal((await airportByCode('UBN')).airport, 'Chinggis Khaan International Airport');
  assert.equal((await airportByCode('PVG')).code, 'PVG');
});

test('new flight results display UBN and autocomplete chooses UBN even from a legacy option', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const declarations = server.slice(server.indexOf('const springAirportCode ='), server.indexOf('\n', server.indexOf('const portalAirportCode =')));
  const context = vm.createContext({});
  vm.runInContext(declarations, context);
  for (const code of ['ULN', 'UBN']) assert.equal(vm.runInContext(`portalAirportCode('${code}')`, context), 'UBN');
  assert.equal(vm.runInContext("portalAirportCode('PVG')", context), 'PVG');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  vm.runInContext(app.slice(app.indexOf('const commonAirports ='), app.indexOf('const setupAirportAutocomplete =')), context);
  assert.equal(vm.runInContext("offlineLocations.find(row => row.city === 'Ulaanbaatar').code", context), 'UBN');
  const input = { value: '' };
  const ui = vm.createContext({ input, clear() {} });
  const choose = app.slice(app.indexOf('  const choose = option =>'), app.indexOf('\n', app.indexOf('  const choose = option =>')));
  vm.runInContext(choose + "\nchoose({city: 'Ulaanbaatar', code: 'ULN'});", ui);
  assert.equal(input.value, 'Ulaanbaatar (UBN)');
});
