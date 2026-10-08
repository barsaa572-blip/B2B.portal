# CNY funding / display-only MNT — 8 October 2026

Implemented locally, NOT pushed, activated in Supabase or deployed. This
supersedes per-ticket 3%. On 8 October the user ran the actual portal mock-browser
check in ordinary PowerShell: PASS at 1280px and 390px. This verifies isolated
UI behavior, not a live bank receipt or production settlement.

## Confirmed policy

- Exact CNY wallet / supplier settlement. Agent enters desired principal CNY;
  transfer principal + 3% + existing fees to Golomt CNY account
  **MN940015001605336659**, name **ЭЙР СЭЛС**.
- 3% collected at funding, NOT on tickets/changes. Funding 3% is
  **NON-REFUNDABLE**, explicitly confirmed 8 October. Airline net refund 1,800
  credits 1,800 CNY, NOT 1,854 or 1,860.
- Currency selector is display only; changes money text, retains passenger input
  nodes and sends no booking/payment. Only a currency preference is persisted.
- MNT uses dated Mongolbank official FX except funding/invoice: dated Golomt
  non-cash SELL. No FX markup. Max age four calendar days, Ulaanbaatar date;
  stale/missing/future/wrong-bank rates fail closed. Cache up to ten minutes.
- MNT display rounds charges UP / refunds DOWN to 10. CNY settles unchanged.
  Fare/tax round per passenger then sum, so total may differ slightly from
  rounding the entire raw amount once. CNY components/totals stay exact.
- Invoice MNT PRIMARY, small CNY rows, frozen SELL rate/date, explicit total CNY
  transfer instruction. Old invoice/account/history is not repriced.
- Admin: principal to credit/remit, 3%, correspondent fee, bank allowance and
  actual MNT tariff, total receivable and saved SELL. Pending quotes are not
  income. Verify actual NET CNY and bank reference; mismatch requires review.

## Example (NOT a live quote)

Principal 10,000 CNY, illustrative Golomt SELL 538 / official 536.29:

| Item | CNY | Saved invoice MNT |
| --- | ---: | ---: |
| Principal / wallet credit | 10,000.00 | 5,380,000 |
| Service 3% | 300.00 | 161,400 |
| Correspondent OUR allowance | 50.00 | 26,900 |
| Bank allowance | 9.30 | 5,010 |
| Total transfer | 10,359.30 | 5,573,310 |

Wallet credit is 10,000, not 10,359.30. Official MNT balance display: 5,362,900.
A 2,000 CNY ticket debits 2,000; a net refund 1,800 credits 1,800.

Service fee rounds nearest CNY cent. Existing correspondent allowance: 50 CNY
through 100,000 principal, 150 above. Bank tariff: 5,000 MNT through 50,000,
10,000 through 100,000, 20,000 above. Bank's CNY allowance rounds UP to one cent
to cover the MNT tariff, then its displayed MNT rounds up to ten. An allowance
is NOT evidence of a paid bank expense. Actual remittance/intermediary deductions
must be reconciled by finance; no bank/Spring transfer is automated by this work.

## Safety / implementation

- PRICING_MODEL defaults legacy. New mode cny-funding-v1 only; per-ticket-v2
  is rejected. Offline old proposal helpers are not imported by runtime.
- money-display.js: exact decimal arithmetic / reactive spans / currency toggle.
- backend/fx-rate.mjs + pricing-model-two-fx.mjs: independent dated official/bank
  feeds. The latter filename is historical; it implements FX, not ticket markup.
- backend/cny-funding.mjs: authoritative quote; top-up POST recomputes server fees
  and bank rate. Client agency/rate/fee/total cannot override it.
- backend/retail-pricing.mjs: v3 exact CNY, zero rounding income; historical v1
  snapshots retain original totals. Private accounting is not exposed to agents.
- supabase/cny-funding.sql: additive, idempotent, NO resets/history deletion.
  Explicit activation refuses nonzero wallets, pending invoices/unresolved
  financial operations. Do not delete data to force activation.
- approve_cny_topup atomically records a unique normalized bank reference and
  credits principal once, not fees. Internal legacy approval is not exposed.
  Receipt writes cannot be updated/deleted directly by service_role.
- Readiness checks schema/config/security and exact-CNY store function.
  Failed readiness blocks funding/booking before a supplier mutation.
- scripts/cny-funding-preflight.mjs: read-only flags/dates; no secrets/Spring calls.

## Verification / remaining gates

Unit + actual mock HTTP: forged totals, tenancy/admin/CSRF, required receipt,
missing readiness, bank vs official rates, exact CNY/refund policy. Local
PostgreSQL/WASM: migration repeat, activation guard, immutable invoice, receipt
uniqueness/idempotence, principal credit, exact issue/change, net refund after
settlement, privileged RPCs. Lock statements are included; WASM is NOT a live
multi-session PostgreSQL concurrency certification.

New PDF rendered/visually checked with company artwork, normal sample one A4
page. Long notes can paginate. No real invoice, receipt or supplier mutation.

Browser acceptance: user supplied both desktop/mobile PASS results, including
passenger preservation, no payment side effects, funding SELL preview and admin
breakdown. Latest local Node 24 full suite passed 284/284, including isolated
container-runner safety guards. No actual Docker concurrency test ran here.

scripts/check-cny-concurrency.mjs now prepares an official PostgreSQL container
with no external network or host mounts, only temporary mock data. It observes
actual lock waits from independent sessions for same-invoice approvals, duplicate
bank references across agencies, repeated net-only refunds and funding versus an
unresolved supplier payment. It refuses missing Docker/image, never installs
Docker or opens a production database URL. Only its verified own disposable
container is stopped/removed. On 8 October the user supplied all four actual
independent-session PASS lines and final real isolated PostgreSQL concurrency
PASS from the SHA256-verified VPS archive. Docker image digest reported:
sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4.
The mock container was removed automatically. This certifies these isolated
locking cases, not a real bank transfer, supplier payment or production deployment.
Earlier pending concurrency statements are superseded by this evidence.

Remaining: verified bank/account/receipt acceptance for actual financial use;
production backup, SQL activation, env flag and exact-revision deployment.
See cny-funding-release.md. Health 200 alone is not financial acceptance.
