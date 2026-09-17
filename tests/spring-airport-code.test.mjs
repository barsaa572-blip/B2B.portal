import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { flightList } from '../backend/spring-pricing.mjs';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

for (const [departure, arrival, expectedOrigin, expectedDestination] of [
  ['ULN', 'PVG', 'UBN', 'PVG'],
  ['UBN', 'PVG', 'UBN', 'PVG'],
  ['PVG', 'ULN', 'PVG', 'UBN'],
  ['BKK', 'ICN', 'BKK', 'ICN']
]) {
  test(`Spring search ${departure}-${arrival} sends confirmed codes in both directions`, async () => {
    const requests = [];
    const context = {
      flightList,
      normaliseSpring: async value => value,
      createSpringClient: () => ({
        getAccessToken: async () => ({ accessToken: 'local-test' }),
        searchFlights: async (payload, token) => {
          assert.equal(token, 'local-test');
          requests.push(JSON.parse(JSON.stringify(payload)));
          return { ifSuccess: 'Y', flightsList: [] };
        }
      })
    };
    vm.createContext(context);
    vm.runInContext(extract('const springAirportCode =', 'const portalAirportCode ='), context);
    vm.runInContext(extract('async function searchSpringFlights(', 'async function searchFlights('), context);
    const result = await context.searchSpringFlights({ departure, arrival, date: '2026-09-24', returnDate: '2026-09-30', trip: 'round', passengers: { adults: 1, children: 0, infants: 0 } });
    assert.deepEqual(requests, [
      { codeType: 1, oriCode: expectedOrigin, destCode: expectedDestination, flightDay: '2026-09-24', lang: 'zh_cn', moneyClassId: 0 },
      { codeType: 1, oriCode: expectedDestination, destCode: expectedOrigin, flightDay: '2026-09-30', lang: 'zh_cn', moneyClassId: 0 }
    ]);
    assert.equal(result.searchContext.outbound.oriCode, expectedOrigin);
    assert.equal(result.searchContext.inbound.destCode, expectedOrigin);
    assert.equal(result.results.length, 0);
    requests.length = 0;
    await context.searchSpringFlights({ departure, arrival, date: '2026-09-24', trip: 'oneway', passengers: { adults: 1, children: 0, infants: 0 } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].oriCode, expectedOrigin);
    assert.equal(requests[0].destCode, expectedDestination);
  });
}
