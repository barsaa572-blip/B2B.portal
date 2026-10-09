# Flight B2B Portal — Codex handover

## Proportional prices / approval metadata fix — 9 October 2026, LOCAL / NOT deployed

- User production feedback: 24/22px weight800 prices too heavy; secondary
  top-up MNT figures too small/faint. New styling uses 20px desktop /18px
  mobile, weight600; MNT rows13px/500 in ink color, total MNT14px. No arithmetic,
  frozen invoice, markup, fee, rounding, bank rate or wallet rule changes.
- User now provides TOPUP_CONFIRM_REQUIRED on pending invoice. Root cause
  found: getAdminOverview selected neither pricing_model nor funding_quote.
  Frontend skipped CNY receipt prompts and sent {}; backend reread stored
  cny-funding-v1 model and correctly rejected missing confirmed=true.
- Explicit admin SELECT now includes those two fields. UI refuses unknown/
  missing model instead of silently taking legacy path. Genuine legacy models
  remain legacy; no saved invoice conversion/repricing, no auto confirmation.
- Isolated HTTP regression exercises actual admin overview route with a mock
  PostgREST that obeys SELECT columns: model + frozen quote must survive, agent
  denied, legacy preserved, internal data omitted. Previous all-fields browser
  fixture hid the production contract gap. Browser now covers missing model
  causing zero approval POSTs, restrained typography and readable MNT themes.
- Node24 release-scoped tests288/288 PASS, zero skipped. Updated browser run
  still required on ordinary user PowerShell (sandbox browser launch remains
  blocked). Existing node scripts/publish-topup-ui.mjs gates on browser before
  Git writes; existing VPS code-only block remains valid. No new SQL required,
  no publication/deployment/real approval performed this turn. Production still
  65ad15b13ded0c30461a88ca2651258f62f6c18a until user deploys follow-up.

## Price typography and top-up follow-up — 9 October 2026, DEPLOYED per user evidence

- User supplies publisher commit 65ad15b13ded0c30461a88ca2651258f62f6c18a
  and READY: Git push verified. Local HEAD matches this full revision.
  User then supplies VPS READY: Production UI/approval update complete. This
  follows the helper's preflight, service-user import, tests, restart, loopback
  health and public HTTP200 guards. No independent VPS inspection performed.
- This supersedes all local/unpublished/pending release notes below for this
  payload. No SQL activation or manual wallet update performed by the helper.
  Live invoice approval success and production visual acceptance are NOT yet
  supplied; inspect safe TOPUP_* code on failure, never approve unpaid tests.
  Unrelated untracked typo/superseded proposal files remain untouched. Only
  these deployment-status notes changed locally after publication.

- User's .ps1 publisher failed at load: running scripts disabled by Windows
  policy. Git push did NOT begin. Added equivalent publish-topup-ui.mjs for
  direct Node CLI, same explicit file list/test+browser gates/remote verification.
  No ExecutionPolicy change, Invoke-Expression or PowerShell child process.
  New helper not run to commit/push by agent; user command is now node publisher.
- User now requests Git/VPS commands. Prepared scripts/publish-topup-ui.ps1
  (explicit owned file list, excludes superseded drafts/typo files, unit + real
  mock-browser gates, main-only push and remote SHA verification) and
  scripts/deploy-topup-ui.sh (code-only pinned fast-forward, clean checkout,
  unchanged manifests/SQL/env template, private backup, umask022 restoration,
  runtime group-read/import gate, tests/preflight/restart/health). No npm ci,
  SQL activation, env edit, FX cron rollout or manual wallet writes. Supabase
  migration must NOT be rerun. See current commands at top of release doc.
- Release-scoped Node24 suite 287/287 PASS, zero skipped. Earlier whole-folder
  counts include 12 unrelated/superseded draft tests; the published test set
  excludes them. PowerShell helper syntax PASS. Git Bash sandbox launch denied;
  command block requires VPS bash -n before executing. No helper was run to
  publish/deploy here; user asked for copy/paste commands. Production failure
  cause remains unconfirmed until safe code is observed, not assumed resolved.
- ACCEPTANCE UPDATE: User now supplies both updated browser PASS lines at
  1280px and 390px: clear prices in both themes/currencies, grouped input,
  fee hierarchy, preserved passengers and safe MOCK approvals. Locally viewed
  generated prices-390, topup-390 and topup-1280 screenshots: prominent prices,
  100,000 input and separate principal/fees/transfer total, no clipping seen.
  This supersedes browser-rerun-pending notes below. No real approval or bank
  rate-feed acceptance inferred; no new Git push or production deployment.
- Follow-up user browser run failed at computed amount color: actual muted
  rgb(177,191,210), parent rgb(234,243,255). The dark theme's large :is() label
  group had greater specificity than the generic numeric inheritance rule.
  Fixed the source label selector to exclude [data-money-cny], not the test
  expectation. Added a regression test and context-rich browser assertions.
  Targeted theme/money suite 5/5 PASS; browser rerun still required. Full suite
  296/296 below predates this extra regression (not rerun this turn).
- Latest screenshots: one-way/return/fare-choice prices tiny/faint and top-up
  100000 lacked grouping. Root cause: currency spans inherited generic muted
  11px label selectors. Money wrappers now have a typography-inheriting class;
  last-loaded money-display.css restores 24px desktop / 22px mobile bold prices
  in light/dark and both currencies. No monetary arithmetic changed.
- Top-up principal is highlighted separately from fees and transfer total.
  Input groups 100000 -> 100,000, preserves cents/caret; authoritative server
  quote and frozen invoice remain unchanged. Fee/refund policy unchanged.
- User again reports generic production Approve failure. Exact live cause is
  NOT established. Local approval validates formatted bank receipt against
  frozen total (not principal), guards missing quote, shows safe TOPUP_* failure
  codes. No automatic retry, actual approval, wallet write or SQL bypass.
- Node24 suite: 296/296 PASS, zero skipped, including isolated HTTP approval
  and secret-redaction tests. Browser runner expanded to computed font/color
  checks in all three contexts, both themes/currencies and 1280/390px, grouped
  100,000 preview, mismatch/known-failure/success MOCK approvals. Edge launch
  still denied in sandbox; new browser assertions/visual acceptance NOT run.
  User must run scripts/check-cny-currency-browser.cjs in normal PowerShell;
  screenshots saved under ignored tmp/security/price-topup-20261009.
- No new Git push, NEXAHUB deployment or SQL execution. Prior three-hour FX
  collector rollout remains accepted; do not redeploy it for these UI fixes.

## FX collector deployed — 9 October 2026, user-supplied VPS evidence

- SHA256 transfer checks and compose/build scope PASS; source changed to one
  schedule.every(3).hours job, preserving callback/arguments and owner/mode.
  Backup /var/backups/nexahub-fx-3h-pUQofc/cron.py.before; deployed source SHA256
  3684d0ab76412d13f3c0fbba7635a16a1a3dbe9ec7dbd09ed745e577c8dc503f.
- Cron image built successfully (Python3.14-slim per supplied build output),
  offline image/source/syntax check PASS, cron recreated, runtime source check
  PASS, restart guard and unchanged API/DB ID guards reached final READY.
  Bank API HTTP200, NEXAHUB HTTP200. Bake/buildx warning did not block build.
- Three-hour schedule/runtime rollout accepted; older pending-collector discovery
  notes below are historical and superseded. No manual crawl executed by helper;
  actual next bank collection/rate timestamp update remains unverified. Do not
  guarantee bank site538.3 matches automatically or claim current feed refreshed.
- This rollout changes /opt/mongolbank-rates only. NEXAHUB top-up spacing/grouped
  input and safe approval errors still local/unpublished; updated actual browser
  acceptance pending. No wallet approval, SQL rerun, markup/spread or data reset.

## Local top-up UI / approval follow-up — 8 October 2026, NOT deployed

- New user requirement: collect fresh bank/official FX every 3 hours. This means
  the separate port8000 upstream collector, not merely fetching its cached API
  response or extending NEXAHUB's ten-minute cache. NOT implemented yet: collector
  service/entry point and current schedule are absent from this workspace and
  VPS read-only service/timer discovery output is required. Use Ulaanbaatar time
  for user-facing schedule; keep frozen invoice FX and failed-fetch validation.
  User now supplies port8000 listener docker-proxy (pid2693); filtered systemd
  list only sysstat-summary, no collector identified. Next inspect Docker name,
  image/ports and public OpenAPI paths only, not environment or raw credentials.
  Next evidence: containers mongolian-bank-api (mongolbank-rates-api, loopback
  8000), mongolian-bank-db (postgres:15-alpine, loopback5432), mongolian-bank-cron
  (mongolbank-rates-cron). OpenAPI includes /api/admin/crawl, crawl/{bank_name},
  backfill/status, but methods/auth not inspected; do not trigger them blindly.
  Existing cron container should be inspected/reconfigured persistently rather
  than adding a second competing scheduler. Need compose source/mount metadata
  and schedule-only sanitized cron output. Never dump Docker .Config.Env.
  User inspected compose labels: /opt/mongolbank-rates/docker-compose.yml,
  project directory /opt/mongolbank-rates, no cron container mounts returned.
  Cron container reports UTC +0000; sanitized /etc cron/crontab scan returns no
  schedules. Likely application scheduler/entrypoint, not confirmed. Inspect
  scheduler source filenames and schedule-only matches next; do not install a
  cron daemon, blindly modify /etc/crontab or restart API/DB. Schedule unchanged.
  Next source-only match identifies /opt/mongolbank-rates/scripts/cron.py:42
  schedule.every and :51 time.sleep. Application Python schedule, not crontab.
  Need exact chain before .do and compose service label before guarded source
  update/rebuild of cron ONLY; callbacks/secrets need not be printed or changed.
  Final inspected chain is schedule.every().day.at(run_at).do(...); compose
  service label cron. Prepared scripts/set-bank-crawl-interval.mjs and
  scripts/deploy-bank-crawl-interval.sh; user uploads both to /tmp and checks
  SHA256, bash -n then runs deployment script. Not executed on VPS yet. Helper
  preserves callback/owner/mode and backs up outside build context, checks Python
  AST/poll within60s; rollout builds cron only, verifies image offline/no-network,
  recreates cron --no-deps and checks API/DB IDs unchanged. Source/image backups
  retained; no automatic rollback. See docs/bank-crawl-three-hour-release.md.
  6 targeted tests + full Node24/Python AST suite295/295 PASS. Git Bash syntax
  check locally denied by sandbox; VPS bash -n is required. Three-hour interval
  begins after registration, not fixed UTC/UB clock times; no manual crawl called.

- User reports crowded top-up preview, missing input grouping, Golomt site 538.3
  versus dated local feed 538, and generic admin approval error. Local changes:
  spaced responsive quote rows (no duplicate principal), 10000 -> 10,000 input
  with cents/caret preserved, strict grouped receipt normalization, safe coded
  approval validation/business errors. RPC financial locks/receipt uniqueness,
  exact NET invoice match and principal-only credit remain unchanged. No SQL
  migration or actual financial approval performed.
- Node24 full isolated suite: 289/289 PASS, including HTTP safe error mapping,
  admin authorization and no provider payload disclosure. Fractional SELL 538.3
  survives rate parsing and quote math without rounding or adding a spread.
- Actual updated browser acceptance still pending: sandbox Edge crashed;
  in-app browser timed out on localhost fixture. Own fixture server stopped.
  Ordinary PowerShell scripts/check-cny-currency-browser.cjs needs a rerun.
- User supplies VPS GolomtBank feed: id816, date2026-10-07, timestamp
  2026-10-07T09:01:55.710998; CNY noncash buy533.9, sell538.0, cash sell539.9.
  Portal 538 exactly matches this feed; no portal integer truncation demonstrated.
  Need identify separate port8000 collector/service and its refresh schedule to
  reconcile reported bank site538.3 (not independently verified). Feed/approval
  cause still pending; no arbitrary +0.5 applied. Do not reprice frozen invoices
  or call 538.5 an official bank quote. Browser acceptance also still pending.
- User's new invoice screenshot INV-20261008-6DDE41AECB: principal 929.35 CNY,
  service 27.88, correspondent 50, bank 9.30; total NET receipt 1016.53 CNY.
  This illustrates principal versus receipt only; do not invent/approve receipt.
  Exact production failure cause remains unconfirmed until coded error/context.

**CNY funding production restored, 8 October 2026 — user evidence:** permission
repair returned PASS for runtime imports as flightb2b, CNY preflight schema and
both dated FX sources ready (2026-10-07), health ok, service active, website HTTP
200 and READY. The earlier startup EACCES/failed deployment status is superseded.
Release main verified at 9e66a74f6f7406d623e476f27fbcd6efc7fbefab. Repair granted
service-group read/traverse to tracked runtime/public assets/dependencies only;
private env/backups/artwork/.git and staging service were not part of the block.
No wallet reset or fabricated financial approval occurred. Policy: exact CNY;
nonrefundable top-up 3%; ticket/change markup 0%; airline net refund only; official
MNT display step 10; invoices frozen Golomt SELL. Next production UI acceptance
via fresh login/refresh, currency toggle retaining passenger input and top-up
preview without creating/approving a payment. Real bank receipt, supplier issue,
change and refund reconciliation remain NOT certified by health or isolated tests.
Local release docs fix backup umask and service-user import gate; those doc edits
are not separately pushed. No new runtime code commit needed for chmod/chgrp.
Spring/Yeeflightlink and paused test-site work remain pending as before.

**CNY funding activation progress, 8 October 2026:** user supplied full migration
Success and then activation blocked on one pending AIR SALES test invoice,
929.37 CNY, id 02253eb5-36fe-4c73-99d0-75a3712c8a9b. User confirms unpaid test;
targeted guarded rejection preserved history (no wallet reset/deletion), with
returned rejected status. User now supplies cny_funding_ready=true from Supabase:
DB migration/activation confirmed by user evidence. Local release commit is
9e66a74f6f7406d623e476f27fbcd6efc7fbefab. VPS revision/env flag/preflight/restart
and production HTTP/UI acceptance are NOT yet confirmed. Next set exactly one
PRICING_MODEL=cny-funding-v1 without touching secrets/endpoints, require pinned
revision and preflight before restart. Earlier pending SQL statements below are
superseded; do not claim production online from a DB readiness screenshot alone.

**Publication verified / VPS mismatch, 8 October 2026:** read-only GitHub branch
API confirms main at 9e66a74f6f7406d623e476f27fbcd6efc7fbefab. User ran final
restart guard and received STOP: VPS new commit missing; the earlier prepare
block had waited for commit input. Thus code rollout is NOT complete. SQL is
already active; do not repeat migration/activation or rollback the model blindly.
Next provide fixed-SHA VPS fetch/backup/ff-only install/test/preflight/restart
without another commit prompt. Keep env secrets and supplier endpoints unchanged.

**CNY runtime failure after rollout, 8 October 2026:** user subsequently reports
VPS tests 272/272 pass and preflight all true (model cny-funding-v1, schema,
official/funding FX dates 2026-10-07, nonrefundable funding 3%, ticket 0%). Final
curl to 127.0.0.1:4173 fails; no service-active/website-200/READY evidence. Do
NOT declare deployed successfully. Check service User/Group/status and code/deps
readability first: rollout block set umask 077 for a private backup but did not
restore it before Git checkout/npm ci. Root-run tests can conceal unreadable
files for a non-root service. This is a hypothesis pending VPS diagnostics, not
a confirmed cause. Never chmod the whole checkout/private env/artwork recursively
or disable auth/SQL to make startup pass. SQL remains active; no reset/rollback.

**Runtime cause confirmed, 8 October 2026:** user diagnostics show service User
flightb2b, Result=exit-code, restart loop, code and pdf-lib package.json 600
root:root; service-user import fails EACCES for backend/cny-funding.mjs. Only
4174 staging listens. Backup umask leak is confirmed; root tests concealed it.
Release docs now restore umask 022 after private backup and test imports as the
service user. Repair only Git-tracked runtime/public code plus normal dependency
files/dirs by giving actual service group read/traverse, never group write.
Private env, .git, backup dirs, private invoice artwork and test service stay
unchanged. Ownership stays root. Service stop/repair/probe/start/health pending;
do not claim restored until active and HTTP 200 evidence.


**Latest pricing implementation, 8 October 2026 (NOT DEPLOYED):** user cancelled
per-ticket 3%. Exact CNY funding principal + upfront non-refundable 3% and bank
fees; no ticket/change markup; airline net refund only (1,800 credits 1,800).
Golomt CNY account MN940015001605336659. Official Mongolbank MNT display with
charge-up/refund-down 10 MNT; display-only selector retains passenger inputs.
Invoice MNT primary / small CNY at frozen Golomt SELL. Local additive SQL and
verified-receipt approval; activation refuses nonzero funds/pending operations.
See docs/pricing-cny-funding.md and docs/cny-funding-release.md. User supplied
browser PASS at 1280px and 390px in ordinary PowerShell on 8 October (isolated
mock UI, not a live payment). Latest Node 24 suite 284/284 and local
SQL financial checks pass. Real multi-session concurrency remains pending;
user has no Docker Desktop. A safe network-isolated disposable PostgreSQL runner
was added, NOT executed successfully. Do not auto-install Docker or bypass this
gate with production payments. User subsequently confirms Docker 29.1.3 on VPS,
host psql absent. Prepared secret-free 22-file test archive with SHA256 and
transfer/run instructions in docs/cny-concurrency-vps.md; no Git push needed
for the isolated test. On 8 October the user supplied all four independent-session
PostgreSQL PASS results and final concurrency PASS from that verified archive on
the VPS: same-invoice once, bank-reference isolation, net-only refund once,
funding refuses unresolved supplier operation. Output confirms only this run's
disposable mock container/data removed; image remains cached. This supersedes
earlier pending concurrency statements. No real bank/Spring/Supabase payment
was used. Publication, production backup/migration/activation/env/deployment
remain pending. No Git push,
production SQL/env change or real supplier/bank mutation was performed.

**Current work ledger: 6 October 2026.**

**Idle-fix deployment reported complete, 7 October 2026:** after the pinned
`07417e2b49415bfdaa9b0fedc81f77415d1ca4f6` block, the user supplied Website HTTP
200 and `READY: Idle logout засвар орлоо.` This supersedes the pending-deployment
statement below. Real 20-minute unattended logout/reload acceptance is still
pending; do not declare that behavior certified based on deployment health alone.

**Idle logout follow-up, 7 October 2026:** the user confirmed real email code
delivery, first password renewal and a fresh OTP login. They reported remaining
signed in after 20 minutes and reload, with no other tab. Supplied Nginx logs
show successful /api/auth/activity calls with no demonstrated 20-minute gap;
they do not identify which event emitted them. New regressions reproduce raw
trusted scroll/hover keeping sessions alive and queued input adding up to a
minute. The local fix excludes raw scroll/hover, retains deliberate dragging,
wheel/typing/click input, sends bounded elapsed input age, never auto-touches on
page restoration, and validates reload cookies through a read-only authenticated
POST /api/auth/session. Cache-busting script versions were advanced. Local Node
24 tests pass 259/259, including auth UI/controller and actual HTTP snapshots.
This fix is not yet deployed; production acceptance after deployment remains
required. Chrome read-only inspection failed at browser request-header policy
loading, and no alternative credential/browser-security bypass was used.

**Production deployment reported complete, 7 October 2026:** after the pinned
`16dd7545bc4ca69fbd005423e500c1462f6a6490` deployment block, the user supplied
`active`, `Website HTTP: 200`, and `READY: Production шинэчлэлт амжилттай.`
This is user-provided confirmation, not direct SSH inspection. The block preserves
production env and the existing Node 24 service override, backs up code/dependencies,
runs isolated tests, conditionally checks already-enabled auth policies, restarts
production, and applies guarded HSTS. It does not newly enable email/password
policies or alter supplier URLs. Next: read-only production auth readiness/flags,
then SQL/template/SMTP acceptance before any required-policy activation. Test DNS
and HTTPS remain paused; the test service was left active with Spring disabled.

**Latest user override, 7 October 2026:** pause further test-site setup and promote
the current security code to production now. The user confirmed the isolated
test backend is active on 4174, production remains active, and test DNS is absent.
Spring is disabled only in the separate test env, with a private backup. Full
HTTPS/browser/SQL/SMTP staging acceptance is NOT complete. Node 24 local tests
passed 250/250 again before promotion. Preserve production env and Node override;
do not activate email/password policies without their SQL/template/SMTP checks,
and do not change supplier endpoints. Production push/deployment still requires
explicit success evidence; this entry records authorization, not completion.

**Publication confirmed, 7 October 2026:** the user pushed `develop` from normal
PowerShell. A read-only remote check verified
`fad9eee9b1dd59481ed713aabf8503ec8651296e` on develop and unchanged
`5bbc4442373c933b1f9b070408cf892a4f00b404` on main. The blocker below is the
earlier attempt, not current publication status. Test VPS deployment, SQL/SMTP
acceptance and production promotion are still pending; do not claim deployed.

**Git publication attempt, 7 October 2026:** security payload committed locally
as `36cabe8c8dac1a39f367caa0a1a2d93a57b3c0bd`; public supplier hosts were then
removed from `.env.example` in `65ab1441c23cf4a0e00966bb049d171381a0dd8d`.
Local `develop` contains both; `security-test-rollout` retains the first commit.
No push succeeded. Native Git credential helper failed; `gh auth status` reports
the saved login invalid. Codex GitHub's repo metadata reports push permission,
but its Git-blob write API returns 403/resource not accessible by integration.
The original template upload was also blocked by review; its supplier hosts were
removed before a new sanitized request, not bypassed. Reauthenticate GitHub before
retrying. Remote develop remains `e89cc9f`, main `5bbc444`; no production code
promotion or test VPS changes have been executed. Do not claim these committed
changes are already deployed. Preserve the two unrelated untracked typo files.

Read [docs/work-roadmap.md](docs/work-roadmap.md) first for current status,
deferred Spring questions, login rollout and the YeeFlightLink assessment. The
August notes below are historical and do not certify current deployment.
Current rates use the configured bank policy, not the historical markup description.
New login-security flags remain false until explicit production acceptance.

Latest security implementation: read [docs/security-fixes-2026-10-06.md](docs/security-fixes-2026-10-06.md).
Price-refresh HTML protection, 20-minute human-activity idle expiry, fixed 24-hour
signed browser email receipt, one-year HSTS and guarded VPS Node/config helpers
are local only. SSH denied direct access; no application security configuration
or SQL was changed. The user completed a runtime-only production migration:
`flightb2b` now uses `/opt/nexahub-node/bin/node` **24.21.0**, via
`/etc/systemd/system/flightb2b.service.d/90-nexahub-node24.conf`. The deployed
source passed 223 tests on that VPS runtime, and the user reported active/HTTP
200/READY after the guarded switch. `/usr/bin/node` remains unchanged. Future
deployment commands must use the service runtime, not assume `/usr/bin/node`
was upgraded; do not silently remove the service override.
The user subsequently ran both isolated browser checks in normal PowerShell:
all supplied HTML/admin/form/preview/checkout/login/mobile checks passed. The
desktop sandbox browser failure is historical; remote test-site/SQL/SMTP
acceptance and security-code promotion remain pending.
Spring encryption needs supplier-confirmed HTTPS/tunnel; current URLs remain unchanged.

**Latest release policy (2026-10-06): test first, production after acceptance.**
Read [docs/testing-release-policy.md](docs/testing-release-policy.md). The user
confirmed `test.nexahub.airsales.ub.mn` after the earlier `test.nexahub.ub.mn`
plan, will obtain new Spring test access, and wants YeeFlightLink on test first.
DNS currently returns no address; restore A -> 202.131.1.50 before setup. The test
unit is not installed and its Spring client ID matches production. A local-only
supplier-disabled test mode is now prepared: remove supplier keys/URLs with the
guarded test-only helper, preserve separate Supabase, deny flight/booking actions
and disable status sync. Full local suite: 250 passed on Node 22 and 24.21. See
deploy/staging/README.md; none of this test code/config has been deployed yet.
All future updates go through test before production; the historical
direct-production commands below are not the current default release workflow.
YeeFlightLink upstream production calls remain real even from our portal test site.

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

Credit-payment ticket issue is SOAP/XML, not JSON:

- WSDL: `http://101.230.218.72:2001/AirSalesService/springairlines/remoteservice/airsalesLLC?wsdl`
- operation: `payInCredit4OTA`
- CNY `moneyClassId`: `0`
- Spring confirmed `ifSuccess = Y` means credit payment succeeded and the ticket
  has been issued.

The VPS can reach the WSDL endpoint. The XML username/password are stored only
in `/etc/flightb2b/flightb2b.env`; do not copy them into this repository.

The legacy SOAP/WSDL order-detail endpoint (`getOrderDetailInfoC2`) is separate
and not yet connected. Spring's Ulaanbaatar search code is `ULN` in the test
environment.

## Current functional status

### Live and verified on the Spring test environment

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
- `bookOrderC` creates real Spring test PNRs. A successful response is stored
  in Supabase together with Spring identifiers.
- Credit payment via `payInCredit4OTA` is wired. It must only be called from
  the final **Issue ticket** action after the wallet balance check. A successful
  test transaction was logged on 21 August 2026 for PNR `BAARWDE`; Supabase
  then showed the booking as `Ticketed` and added the matching wallet debit.
- Ticket deadline countdown begins when the PNR is created. An unpaid PNR is
  not a ticket and Spring cancels it after the applicable payment time limit.
- `orderRetrieve` (HTTP JSON test endpoint) is used to synchronise booking
  status and Spring order identifiers where available.

### Still to finish / verify

- Finish the cancellation flow: live `calcRetTktFeeOTA` quote exists, but the
  final `refundTicketB2cAgentOTA` submit must be connected and tested only on a
  disposable Spring test ticket. Do not set a portal booking to Cancelled before
  Spring returns success.
- Finish the change flow: calendar replacement availability is live through
  `getFlightBgInfo`; `getFlightBgApp` returns a real change calculation and
  `submitFlightBgOTA` must be connected behind a final confirmation. Preserve
  the existing PNR and sync it afterwards; do not generate a replacement portal
  PNR locally.
- Spring currently supplies `orderItemID` values through order retrieval. Each
  ticket has a unique order-item ID. Confirm which identifier each refund/change
  call needs before enabling partial-passenger or partial-segment actions.
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
- `backend/supabase-client.mjs`: all Supabase server-side reads/writes,
  including booking synchronisation and wallet ledger updates.
- `app.js`: browser UI, search, fare selection, checkout and booking views.
- `auth.js`, `admin.js`, `team.js`: session/role and management UI.
- `booking-review.css`, `fare-options.css`: checkout and fare-family UI.

## Suggested first prompt for a new Codex session

> Read `CODEX_HANDOVER.md` and inspect the current repository before changing
> anything. This is a Spring Airlines B2B portal. Keep credentials server-only,
> preserve role isolation, and do not call Spring refund/change submit APIs
> during testing unless the user explicitly approves a disposable test PNR.
> First finish live cancellation and change: inspect `server.mjs`,
> `backend/spring-client.mjs`, and `app.js`; use Spring calculations but require
> final confirmation for submissions. Explain the exact files you will change,
> then implement and run node syntax checks.
