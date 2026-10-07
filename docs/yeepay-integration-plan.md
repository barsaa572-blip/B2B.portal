# YeeFlightLink / NEXAHUB integration assessment

Reviewed 2026-10-06. **Research and proposed architecture only. No YeePay API
request, credentials, booking, payment or production connection was made.**

## Conclusion

Add YeeFlightLink as a **second supplier**, alongside Spring, not by replacing
Spring URLs. Shared checkout, agency permissions, MNT display, invoice design and
ledger controls are reusable. Authentication, offer identifiers, passenger
contracts, settlement currencies and after-sales state machines need adapters.
MU / China Eastern inventory for this merchant is **not confirmed** by these docs.

User decision on 2026-10-06: implement and accept this integration first on the
isolated portal test site, requested as `test.nexahub.ub.mn`, then promote the
accepted release to production. Follow [the test-first policy](testing-release-policy.md).
Our test website is not a YeeFlightLink supplier sandbox; the reviewed FAQ's
production-only limitation still applies. Existing staging configuration uses
`test.nexahub.airsales.ub.mn` and must be reconciled before deployment.

## Evidence and limits

Public documents read through the browser:

- [User Guide](https://yeepay.feishu.cn/docx/LWJHdnOggo2iV5xP5MfcpiXYnj1):
  describes aggregated GDS/NDC/LCC inventory. Embedded whiteboards did not load;
  no findings are claimed from those images.
- [Gateway v1.6.8](https://yeepay.feishu.cn/docx/WEJgdLGu2oUyaMxkywicoZnUnvd):
  RSA2048 signatures plus RSA-wrapped AES-CBC encryption. Responses need signature
  verification before trust. Signature-only mode is limited to search/fare rules.
  Java crypto attachments were not downloaded/read; exact padding/hash/encoding
  and full gateway envelope/base URL are still contract gates, not guessed code.
- [API English v1.6.10](https://yeepay.feishu.cn/docx/F0cEdVJ3SoQixBx3H6vcNP0anWf):
  channel-specific search, price, order/pay/query, cancel, change, refund and
  ancillary contracts. Key sections inspected; large repeated JSON examples were
  sampled, not treated as complete test coverage or certification.
- [FAQ](https://yeepay.feishu.cn/docx/J0o2dmExCovM8xx3RzEc6ocdnoe):
  **production only, no test environment**; 15-minute offers; passenger count must
  match search. Merchant ID omits YP prefix. Channels need account enablement;
  search/booking ratios apply. A generous supplier timeout is suggested, so an
  asynchronous job/query flow is preferable to holding a browser request open.

## Proposed changes to our system (not vendor claims)

| Concern | Portal change |
| --- | --- |
| Two suppliers | Server-side registry and separate Spring / YeeFlightLink adapters; never choose supplier from an arbitrary browser URL |
| Offers | Persist supplier, source/channel, opaque offerId/metaData, search passenger counts, expiry and actor binding; browser receives an opaque portal quote ID |
| Passengers | Add passenger title, adult–infant association, middle-name support where needed, separate contact given/surname/title and per-passenger phone rules |
| Airports | Map city vs airport codes per channel, not using Spring's UBN mapping everywhere; retain marketing and operating carriers / connections |
| Currency | Keep source quote/payment currency separate from CNY wallet currency; snapshot approved conversion and MNT rounding; never relabel HKD as CNY |
| Booking | Revalidate where channel supports/requires it; fixed min/max agreed supplier amount; price change requires agent review, never auto-book/pay |
| Financial safety | Persistent operation ID/requestNo, wallet reservation and reconciliation; query uncertain outcome before any retry or release |
| Ticketing | Separate order, payment and ticket states; paid does not mean ticketed; keep no-ticket-number and paid/ticket-failed exception queues |
| Notifications | Verify/decrypt callback, deduplicate and persist before responding; poll as fallback with leases/backoff; tenant-authorized change history/unread badge/email outbox |
| Refund/change | Passenger + segment scope, original/target history, channel capability gates and independent money/ticket/refund states |
| Secrets | Private key, vendor public key and merchant/channel configuration only in server files; signature/tamper tests; no raw provider payloads/PII in logs |

Starting methods listed in the API documentation include:
`flight/queryFlight`, `flight/offerPrice`, `flight/fareRule`,
`order/createOrder`, `order/payOrder`, `order/queryOrder`, `order/cancelOrder`
under `/yee_flight_link/`. Change/refund have their own submit/query/pay methods;
they are not aliases for the Spring implementations.

## Channel / status traps to test

- CHANNEL_A does not support offerPrice; CHANNEL_C price validation needs
  passengers and does not support order cancellation; CHANNEL_D requires a price
  check before create. Cancellation capability must not be inferred globally.
- Payment routes differ: WITHHOLD, CBP_ACCOUNT, CBP_CASHIER, DIRECT_PAY.
  CHANNEL_C confirmed payment failure needs a new order, but **unknown** payment
  outcome must first be queried. Never blindly repeat either mutation.
- Only business code/status establishes success; gateway success alone does not.
  `TICKET_SUCCESS_NO_NUMBER`, `PAYSUCCESS_TICKETFAIL` and processing states require
  specific handling. Payment SUCCESS is not proof of ticket issuance/change.
- Channel C infant/involuntary changes have restrictions. Issuing-country wording
  differs between revision notes and field tables; ask for current channel rules.
- `NOSHOW` appears in fare-rule categories, **not evidence of a passenger No-show
  status**. Booking cancellation is also not proof the airline cancelled a flight.
- Order notifyUrl and changeNotifyUrl are documented. Whether airline schedule /
  flight-number / flight-cancellation changes generate notifications is unverified.

## Delivery phases / acceptance gates

1. **Contract & account gate:** confirm MU and other airlines, channel accounts,
   POS/currency, merchant settlement route, quotas, HTTPS base URL, signing details,
   callback auth/ACK/retry policy, refund/change support and approved test procedure.
   Do not generate/share live keys or place a booking merely to discover these.
2. **Offline adapter:** vendor-approved redacted fixtures + crypto interoperability
   vectors. Tampered signature/body fails closed. Zero vendor calls in tests.
3. **Read-only pilot on the portal test site:** disabled feature flag → selected admin pilot, approved
   routes/quotas, search/rules/price only. No automatic background search fan-out.
   Existing Spring bookings continue through Spring.
4. **Booking/ticketing pilot from the portal test site:** one approved route/channel/account. Only an explicitly
   approved disposable/controlled production transaction, with spend limit and
   supplier support. Test concurrency, expiry, duplicate requests and uncertain
   pay/ticket outcomes before agent rollout. No real test environment is assumed.
5. **After-sales & notifications:** callbacks + query reconciliation, cancellation,
   segment/passenger change/refund and settlement. Ancillary seats/food/baggage
   later, after core money flow is accepted.
6. **Production promotion:** complete test-site/browser/financial acceptance, then
   release only the exact reviewed code and migrations. Provision production
   configuration independently; never copy test database rows, env secrets or
   test wallet balances into production. Retest the final merge revision if it
   differs from the accepted test revision. Subsequent changes use this same flow.

## Questions for YeePay (no keys/passwords in chat)

1. Is MU international inventory enabled for our merchant? Which channels, routes,
   passenger categories, POS and currencies are permitted? Send capability list.
2. Confirm production-only policy and the approved integration test procedure.
   Are there fixtures/simulators or explicitly refundable controlled test orders?
3. Supply HTTPS gateway address, envelope/headers, RSA signature hash + padding,
   AES padding/encoding and key-rotation/public-key registration procedure.
4. Confirm requestNo idempotency and recovery/query behavior after create/pay
   timeouts; merchant payment/settlement account and fees, FX and refund timing.
5. Confirm callback verification, event coverage (schedule/number/cancellation),
   retries/order/ACK, polling limits, flown/check-in/coupon status availability.
6. Resolve issuingCountry and per-channel passenger/contact field discrepancies;
   confirm current documentation and channel capabilities for our account.
