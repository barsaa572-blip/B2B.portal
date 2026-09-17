# Live Spring pricing verification

This change is locally tested against mocks, not certified against production.
No real bookings, ticket issues, wallet changes or refunds are part of these tests.

## Contract gate before production rollout

The adapter calls the existing configured `getSpecificPriceNew` JSON endpoint.
Its payload/response schema follows the supplied legacy `getSpecificPrice`
contract: `segType`, ordered `segHeadIds`, `cabinNames`, `cabinTypes`, and
`adultTravPriceForSeg`, `childTravPriceForSeg`, `infantTravPriceForSeg` arrays.
Confirm that the JSON endpoint uses this same schema. An unknown wrapper or
missing passenger/fee field fails closed. Do not replace missing values with zero
or remove the booking guard to make an incompatible response pass.

On a staging deployment, sign in and search a route/date with known availability.
Select a fare with 1 adult, 1 child and 1 infant. Inspect the authenticated
`POST /api/flights/price` response in browser Network. It must contain CNY
breakdown rows for all three types, a quoteId, expiry and a combined total.
Compare those amounts with the supplier response, then repeat for a round trip
and an adult-only itinerary. Do not click Book for this check.

If verification fails, obtain the supplier pricing response's field names and
redacted amount structure for the same segment/cabin. Never share access tokens,
APPKEY/SECRET or passenger details. Adapt the parser only to a confirmed contract.

## Expected controls

- Price loading/failure disables Book. Changing the selected fare triggers a new check.
- Quotes bind actor, fare combination, passenger counts and currency, expire after
  ten minutes, and are revalidated before reservation. Browser totals are ignored.
- A quote is consumed before the supplier booking call, including uncertain failures.
  Investigate uncertain reservation results before creating another quote/booking.
- Quote storage is in-process. Restarting the server invalidates outstanding quotes.
  Multiple backend workers need a shared quote store or sticky routing before rollout.
- MNT display is a conversion; the verified source amount is CNY.

## ULN/UBN to PVG

Spring support subsequently confirmed that production requires UBN. The backend
now sends UBN for both ULN and UBN selections, including the return leg. New search
results and airport suggestions display UBN; saved records are not rewritten. Real availability must still be
checked against the supplier; this mapping does not invent flights.
`/api/flights` now includes non-secret `searchContext` containing the actual supplier
request and returned counts. A malformed response is an error, not an empty list.
Send a successful empty response and its searchContext to Spring to confirm route,
date, account inventory permissions and the correct airport code.

## Local checks

From the repository directory:

```sh
node --check app.js
node --check server.mjs
node --test tests/*.test.*
```
