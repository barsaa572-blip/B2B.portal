# Flight B2B Portal — Codex handover

Read this file before making changes. It is a short, safe replacement for the
local Windows Codex conversation history. Do not commit credentials or tokens.

## Product

This is a B2B Spring Airlines ticketing portal for Mongolian agencies.

- Roles: ticketing agent, office manager, platform administrator.
- Agents see their own bookings; office managers see their agency bookings;
  platform admins manage agencies, users, invoices and wallet approval.
- The customer-facing amounts are displayed in MNT. Spring amounts are CNY and
  are converted using the MongolBank rate service plus the configured markup.
- Wallet credit is CNY; top-up invoices are issued and paid in MNT.

## Repositories and deployment

- GitHub: `https://github.com/barsaa572-blip/B2B.portal`
- Production VPS: `202.131.1.50`
- App directory on VPS: `/opt/flightb2b`
- systemd service: `flightb2b`
- Nginx proxies public HTTP traffic to `127.0.0.1:4173`.

Deploy after a reviewed Git commit:

```bash
cd /opt/flightb2b
git pull origin main
systemctl restart flightb2b
systemctl status flightb2b --no-pager
```

Health check:

```bash
curl http://127.0.0.1:4173/api/health
```

## Local development

```bash
git clone https://github.com/barsaa572-blip/B2B.portal.git
cd B2B.portal
node server.mjs
```

Open `http://127.0.0.1:4173`. For any change run:

```bash
node --check app.js
node --check server.mjs
git diff --check
```

## Secrets and environment

The production environment file is `/etc/flightb2b/flightb2b.env`. Never put
its values in Git, browser JavaScript, screenshots, or chat.

It contains Spring OAuth credentials and endpoint variables such as:

- `SPRING_TOKEN_URL`
- `SPRING_HTTP_BASE_URL`
- `SPRING_FLIGHT_SEARCH_URL`
- `SPRING_PRICE_CHECK_URL`
- `SPRING_OAUTH_CLIENT_ID`
- `SPRING_OAUTH_CLIENT_SECRET`
- Supabase server credentials

The backend alone contacts Spring. The browser must never receive the Spring
app secret, access token, Supabase service key, or server environment values.

## Spring integration

HTTP JSON base: `http://101.230.218.71:8001/gdsgatewayota`

- OAuth: `/auth/oauth2/accessToken`
- Flight search: `/weekApiFlightSearch/ota/flights/searchFlightsOtaDayKegui`
- Specific price: `/apiFlightSearch/ota/normalFlightSearch/getSpecificPriceNew`
- Fare rules: `/apiFlightSearch/ota/flights/searchKeguiBySegId`
- Order creation: `/apiOrder/ota/orderOtaCtr/bookOrderC`
- Refund calculation: `/apiOrder/ota/orderOtaCtr/calcRetTktFeeOTA`
- Refund: `/apiOrder/ota/orderOtaCtr/refundTicketB2cAgentOTA`
- Change information: `/apiOrder/ota/orderOtaCtr/getFlightBgInfo`
- Change availability: `/apiOrder/ota/orderOtaCtr/getFlightBgApp`
- Submit change: `/apiOrder/ota/orderOtaCtr/submitFlightBgOTA`

The legacy SOAP/WSDL order-detail endpoint (`getOrderDetailInfoC2`) is separate
and not yet connected. Spring's Ulaanbaatar search code is `ULN` in the test
environment.

## Current functional status

### Live

- Spring OAuth token request works from the VPS.
- Spring availability search is server-side and live for routes provided by the
  test environment.
- Search uses the lowest available adult fare in result cards.
- Flights may contain multiple Spring `normSeatPriceList` entries. The backend
  normalises these as `fareOptions` and the UI shows fare-family selection only
  after the user clicks **Select**.
- One way: select a flight → select a fare family (if more than one) → passenger
  booking page.
- Round trip: select outbound flight/fare → select return flight/fare →
  passenger booking page.

### Test-only / not yet Spring live

- Creating a portal PNR, issue-ticket state, cancel state, change calculations,
  and booking records are portal/Supabase workflow tests only.
- Do not state that a Spring ticket is issued until `bookOrderC`, specific-price
  verification and successful Spring order responses are wired and verified.
- Child and infant prices are not guessed by availability search. They require
  Spring price verification before issue.

## Important UI decisions

- Airport autocomplete should show city plus IATA code, but Spring requests use
  IATA code only.
- Passenger counters require a new search before selecting a flight; old results
  stay visible with a "search again" notice.
- On the selected-itinerary page, show detailed flights above, price/fare/tax
  and baggage summary on the right, then passenger form below.
- DOB validation uses departure date: ADT 12+, CHD from 2nd birthday until the
  day before 12th birthday, INF below 2. Passport expiry must be at least six
  calendar months after departure.

## Database

Supabase schema and policies are in `supabase/schema.sql`. The project has
tables for agencies, branches, profiles, wallets, wallet_transactions, bookings,
and top-up requests/invoices. Row Level Security is required. Wallet credit,
agency management and Spring calls must remain server-side.

## Current code landmarks

- `server.mjs`: HTTP routes, Spring search normalisation and browser-safe API
  responses.
- `backend/spring-client.mjs`: server-only Spring OAuth/HTTP JSON client.
- `app.js`: browser UI, search, fare selection, checkout and booking views.
- `auth.js`, `admin.js`, `team.js`: session/role and management UI.
- `booking-review.css`, `fare-options.css`: checkout and fare-family UI.

## Suggested first prompt for a new Codex session

> Read `CODEX_HANDOVER.md` and inspect the current repository before changing
> anything. This is a Spring Airlines B2B portal. Keep credentials server-only,
> preserve role isolation and do not claim test portal PNRs are real Spring
> tickets. Explain the exact files you will change, then implement and run node
> syntax checks.
