# NEXAHUB work ledger — 2026-10-06

## New feedback follow-up — 9 October 2026, LOCAL / NOT deployed

- Soften search/fare prices20/18px semibold600; make top-up secondary MNT
  13px and total14px readable in ink color. No financial calculation changes.
- TOPUP_CONFIRM_REQUIRED root cause identified: admin SELECT omitted invoice
  model/quote; UI took legacy path with empty receipt. Explicit fields added,
  missing model fails closed; actual HTTP SELECT-projection regression added.
- Release-scoped tests288/288 PASS. Browser update pending ordinary PowerShell;
  Node publisher and same VPS block can release after browser gate. No SQL,
  manual wallet changes or live test approval. Deployed revision remains65ad15b.

## Price/top-up follow-up — 9 October 2026, production rollout accepted

- User supplies commit65ad15b13ded0c30461a88ca2651258f62f6c18a and Git push
  verified READY; local HEAD matches. VPS final Production UI/approval update
  complete READY also supplied. Earlier prepared/not-executed notes below are
  superseded for this payload. No SQL activation/manual wallet update.
- Real invoice approval and production visual acceptance remain separate,
  unverified items; do not infer them from mock tests or service health.

- User updated mock-browser PASS at1280/390 covers clear prices in both
  themes/currencies, grouped input, fee breakdown, preserved passengers and
  safe mock approvals; local generated screenshots visually reviewed.
- Release-scoped Node24 tests287/287 PASS; PowerShell syntax PASS. User asks
  for Git/VPS commands: publish-topup-ui.ps1 and deploy-topup-ui.sh prepared,
  NOT executed. VPS must bash -n first (local Git Bash sandbox denied launch).
- No new SQL, balance reset, extra rate spread or FX cron deployment. Live
  approval cause still unknown; inspect safe TOPUP_* code if it persists after
  deployment. Do not approve unpaid test invoices or claim a real credit PASS.

## FX collector deployed — 9 October 2026

- User supplies full deployment PASS/READY: one three-hour scheduler in source
  and rebuilt image, offline and running-container checks pass; cron recreated
  only. API/DB ID guards pass, bank API and NEXAHUB HTTP200. Buildx/Bake warning
  did not prevent build. Earlier discovery/prepared/pending rollout notes are
  superseded for schedule deployment (not for actual bank fetch acceptance).
- Private source backup /var/backups/nexahub-fx-3h-pUQofc/cron.py.before. New
  source SHA256 3684d0ab76412d13f3c0fbba7635a16a1a3dbe9ec7dbd09ed745e577c8dc503f.
- Actual next scheduled collection and feed timestamp still pending evidence;
  no manual crawl performed. Bank may not publish a new quote every three hours.
- NEXAHUB UI/approval follow-up remains local, browser acceptance unpublished.
  No financial write or existing invoice repricing performed.

## Top-up follow-up — 8 October 2026, local only

- User requests upstream FX collection every 3 hours. Pending identification of
  port8000 collector entry point/current timer; do not pretend repeated API reads
  refresh bank data. Portal cache need not become 3 hours; old invoice FX stays
  frozen. No VPS schedule has been changed in this chat yet.
  VPS discovery: port8000 bound by docker-proxy; container identity and collector
  update command/API remain unknown. No collector systemd unit found by filter.
  Later Docker evidence identifies mongolian-bank-cron alongside API and DB;
  inspect existing cron schedule and persistent compose source next. Public
  OpenAPI lists admin crawl/backfill paths; no update endpoint has been called.
  Compose source is /opt/mongolbank-rates/docker-compose.yml; cron container has
  no returned mounts, timezone UTC, no ordinary crontab schedule found. Need
  inspect application scheduler source before persistent three-hour change.
  Scheduler now located: scripts/cron.py:42 schedule.every, :51 time.sleep.
  Read exact schedule chain and compose service label; preserve crawler callback,
  rebuild/recreate cron only. No schedule change performed yet.
  Final evidence: schedule.every().day.at(run_at).do(...), service cron. Guarded
  updater/deploy scripts prepared; callbacks preserved, private backup, offline
  image validation, cron-only no-deps rollout and unchanged API/DB ID guards.
  Local full suite295/295 PASS including actual Python AST; VPS deployment/result
  still pending. No manual crawl or immediate rate update has been claimed.

- Implemented clean quote rows/spacing, grouped CNY entry preserving cents,
  safe receipt input and coded admin approval errors without exposing SQL/raw
  provider messages. Financial RPC and nonrefundable 3% policy unchanged.
- 289 isolated Node24 tests pass. Updated desktop/mobile browser runner awaits
  ordinary PowerShell acceptance (sandbox Edge blocked; local IAB timed out).
- VPS GolomtBank feed received: dated2026-10-07, CNY noncash sell538.0,
  buy533.9 and cash sell539.9. Portal matches feed, not truncation. Identify
  separate port8000 collector/refresh schedule next; user's site538.3 remains
  unverified. No unverified 0.5 spread was added; frozen invoices unchanged.
- Live approval cause unconfirmed. New screenshot implies 929.35 CNY principal
  versus 1016.53 CNY receipt incl fees; do not approve without actual bank proof.
- No new push/deployment/SQL/production approval in this follow-up.

## CNY funding production restored — 8 October 2026

- User supplies non-root runtime import PASS, CNY preflight ready, backend health
  ok, service active and Website HTTP 200 after scoped permission repair. Earlier
  startup-failed notes are superseded. Main release 9e66a74 verified via GitHub.
- Model is nonrefundable 3% at funding only, exact CNY wallet, no ticket/change
  markup, net-only airline refund; official MNT display rounded to 10 and frozen
  Golomt SELL invoice. No reset, history deletion or fabricated receipt approval.
- Still pending: production UI/preview acceptance and authorized real finance
  reconciliation. Isolated unit/browser/concurrency tests do not certify live
  bank/Spring transfers. Local release docs now prevent backup umask leak.
- Supplier integration questions, Yeeflightlink and paused test-site plan unchanged.

## CNY funding activation progress — 8 October 2026

- User confirms complete Supabase migration success. Activation guard found one
  unpaid test pending invoice (AIR SALES, 929.37 CNY); targeted rejection returned
  rejected, preserving history and wallets. User now supplies cny_funding_ready
  true. DB activation is accepted from this evidence; previous pending SQL notes
  are superseded.
- Local release commit 9e66a74f6f7406d623e476f27fbcd6efc7fbefab. VPS pinned
  revision, env activation, preflight, service restart and HTTP/UI acceptance
  remain unconfirmed. No real bank/Spring payment acceptance claimed.
- GitHub main independently verified at this exact commit through read-only
  branch API. User subsequently reports the VPS final guard says new commit
  missing: prepare/update block was not completed. SQL already active; next
  fixed-SHA backup/update/tests/preflight/restart, no repeated SQL activation.
- Later VPS evidence: 272 tests pass, CNY preflight schema/rates ready, but final
  local 4173 connection refused. Service/runtime is not accepted. Diagnose User,
  status and public code/dependency readability. Backup umask 077 carried into
  checkout/install is a possible cause if service non-root; do not weaken private
  file permissions or roll back the activated financial model blindly.
- Confirmed cause: service flightb2b cannot read new 600 root:root runtime and
  package files; EACCES reproduced as the service user, auto-restart loop. Only
  staging 4174 listens. Restore service-group read/traverse ONLY for tracked
  runtime/public files and node_modules, not private env/backups/artwork/.git.
  Release docs fixed to reset backup umask and probe non-root imports. Repair
  and production health acceptance remain pending.

## Pricing update — 8 October 2026, local only

- Supersedes per-ticket proposal: exact CNY funding, 3% at top-up only,
  non-refundable funding fee; net airline refund 1,800 credits 1,800 CNY.
- New Golomt CNY account MN940015001605336659; saved invoice SELL FX, MNT
  primary / small CNY. Portal official FX + display-only currency switch,
  MNT-10 up/down, exact wallet/supplier CNY. Admin fee/receipt breakdown.
- Unit/mock HTTP + PostgreSQL/WASM guards and rendered PDF tested. User reports
  actual browser PASS at 1280px and 390px on 8 October in normal PowerShell.
  Real multi-session concurrency remains pending; user has no Docker Desktop.
  The new disposable PostgreSQL runner is prepared, not actually accepted.
  VPS Docker 29.1.3 subsequently confirmed, host psql absent. Secret-free test
  bundle plus isolated VPS commands prepared in cny-concurrency-vps.md;
  User subsequently supplied all four independent-session PASS results and final
  PostgreSQL concurrency PASS on 8 October. The isolated mock container was
  removed automatically; no real financial data was changed. No host psql install
  needed. Publication and production migration/activation/deployment still pending.
  Production
  SQL/flags/deployment/financial acceptance not performed. See pricing-cny-
  funding.md and cny-funding-release.md. Never reset funds to force activation.
  Spring/Yeeflightlink/test-site pending tasks remain unchanged.

This is the persistent record requested by the user: do Spring-independent work
first, retain supplier questions, do not silently invent airline behavior.
Local implementation does **not** imply VPS deployment or production acceptance.

## Latest user decisions and reported deployment

- Idle fix deployment subsequently reported complete: user supplied Website HTTP
  200 and Idle logout deployment READY after the pinned 07417e2 block. This is
  user-provided deployment evidence. Next leave a single tab untouched for 21
  minutes and confirm sign-in UI plus denied restoration after reload. Actual
  production inactivity acceptance is still pending.
- Idle follow-up: user confirms no other tab and reload still shows signed-in
  UI. Supplied Nginx activity timestamps include 04:11:05, 04:22:28, 04:22:30 and
  04:23:31 UTC, all 200: no 20-minute inactivity gap is demonstrated, but event
  provenance is unavailable. Regressions reproduced trusted scroll/hover and
  delayed input problems. Local fixes remove raw scroll/hover, carry bounded
  input age to the server, suppress page-load touches, and validate restored
  cookies with an authenticated, same-origin read-only session snapshot.
  Node 24 full suite: 259 pass, zero fail. No secret audit findings. Actual
  production idle acceptance remains pending; no claim of a deployed fix yet.
- Production auth acceptance is partially confirmed by the user: email OTP
  arrived, first password renewal succeeded, and a fresh OTP/password login
  succeeded afterward. That second OTP is expected because renewal invalidates
  the prior password revision. However, the user reported the UI remained signed
  in after 20 minutes without interaction: idle logout is NOT accepted yet.
  Read-only public production assets match the current local auth/activity/index
  sources after CRLF normalization; 10 focused idle/session tests passed. Actual
  browser state/server expiry and other-tab activity still need distinguishing;
  no guessed fix or new production deployment was made for this report.
- The user subsequently supplied a production SQL Editor screenshot showing
  portal_auth_security_ready = true after the matching migration. Backend
  service-role preflight must still be rechecked before activation. Required
  email/password policies and device signing key are not yet enabled. Next
  configure only the Magic Link email template with .Token, preserve Invite
  User, verify SMTP/code delivery, then perform guarded activation/acceptance.
- Production read-only preflight supplied after deployment: isolated Node
  24.21.0 is confirmed; AUTH email/password policies, device signing key and
  trusted-loopback proxy flag are all false/not-ready; portalAuthSchemaReady is
  false. This result alone does not distinguish a missing RPC from missing
  permissions or a failing readiness predicate. All supplied Spring endpoints
  remain HTTP (JSON 7003, SOAP 7001). Do not claim supplier transport encrypted
  or required email/password policies active. Next apply/review the matching
  portal auth migration and verify readiness, then template/SMTP acceptance;
  proxy-IP rate-limit configuration also remains pending.
- Production rollout subsequently reported complete on 2026-10-07: the user ran
  the pinned `16dd7545bc4ca69fbd005423e500c1462f6a6490` block and supplied active,
  Website HTTP 200 and deployment READY. Direct SSH remains unavailable. This
  supersedes earlier pending-promotion entries, not SQL/SMTP acceptance. The
  deployment does not newly activate email/password policies or modify Spring
  endpoints. Next inspect production auth flags/schema read-only. Test backend
  remains active with Spring disabled; DNS/HTTPS work stays paused.
- Latest override, 2026-10-07: the user explicitly paused test-site setup and
  requested direct production promotion of the current code. Test backend on
  4174 and production were reported active; test DNS remains absent and Spring
  is disabled only in test. Full remote acceptance is incomplete. Local Node 24
  tests passed 250/250 again. Prepare main without copying test secrets/settings;
  SQL/SMTP-dependent login policy activation remains separately gated. This is
  an exception for this release, not evidence of a production deployment.
- Publication subsequently confirmed on 2026-10-07: the user pushed develop
  and a remote read verified `fad9eee9b1dd59481ed713aabf8503ec8651296e`.
  Production main remains `5bbc444`; the earlier credential blocker below is
  historical for that attempt. Test VPS rollout/SQL/SMTP and production promotion
  have not yet occurred. Deploy only the exact verified test revision first.
- 2026-10-07 authorized publication attempt: local develop contains security
  commit `36cabe8` and template sanitization `65ab144`. Neither was pushed:
  native GH credentials are invalid and the Codex GitHub write API returns 403.
  Remote develop/main remain e89cc9f/5bbc444; no test-service installation or
  production code deployment occurred. Reauthenticate GitHub before retrying.
  New public template has blank Spring URLs; this does not erase older public
  endpoint-only history, and no actual provider secret was found in the audit.
- Test VPS inspection: `/opt/flightb2b-test` and `/etc/flightb2b-test` exist,
  but `flightb2b-test` is not installed (`LoadState=not-found`, inactive, no
  FragmentPath). Both DNS lookups then returned no address, and staging rejected
  a Spring client ID matching production. The user confirmed the old hostname
  `test.nexahub.airsales.ub.mn`. Preserve these directories; do not weaken guards.
- Runtime-only production migration completed by the user: deployed source
  passed **223 tests, 0 failed** with `/opt/nexahub-node/bin/node` **24.21.0**;
  guarded service restart then reported **active / Website HTTP 200 / READY**.
  Override: `/etc/systemd/system/flightb2b.service.d/90-nexahub-node24.conf`.
  System `/usr/bin/node` was not replaced, and local security source changes
  were not included in this runtime switch.
- User reported the latest VPS update completed: service `active`, backend health
  returned `ok: true`, website HTTP 200 and READY. These are user-provided results,
  not an independent verification of the exact deployed commit or every feature.
  Auth-policy activation / SQL / email-code template acceptance remains pending.
- New default: **all future changes go to the isolated test site first, then a
  tested batch is promoted to production**. Latest confirmed test hostname is
  `test.nexahub.airsales.ub.mn`, superseding the other proposed hostname; DNS A
  needs restoration. The user will obtain new Spring test access;
  YeeFlightLink is first integrated on this portal test environment as well.
- [Test-first environment and release policy](testing-release-policy.md) is the
  authoritative workflow. It does not assume YeeFlightLink offers a sandbox.

## Implemented locally in this update

Latest security patch (not production-activated): price-refresh HTML sanitization,
20-minute human-activity idle expiry, fixed 24-hour same-browser email receipt,
one-year host-only HSTS and gated Node 24.21/configuration VPS helpers. Full local
suite: 250 tests passed on Node 22 and Node 24.21 (after adding supplier-disabled
test-mode regression tests). Both browser regression
scripts subsequently passed in the user's
normal PowerShell (all supplied HTML/admin/checkout/login/mobile PASS results).
This clears the local browser gate, not remote SQL/SMTP/test-site acceptance.
The new supplier-disabled test mode was added after those browser results;
its actual HTTP boundary, banner, zero-supplier-call behavior and env guards
pass isolated tests. It is local only; fresh browser/test-site acceptance remains
required. Test-only env helper keeps a private backup, removes Spring/fallback
credentials, retains isolated Supabase and denies all supplier actions.
Read [security-fixes-2026-10-06.md](security-fixes-2026-10-06.md) for acceptance,
private key generation and exact-commit rollout. SSH access was denied; only the
user-operated runtime switch above is confirmed. Application security config/SQL
were not changed. Spring TLS handshakes were inconclusive and
current HTTP URLs stay unchanged until supplier-compatible encrypted transport.

- Password + company-email code sign-in, restricted pending cookie, replay/expiry/
  attempt/resend controls. No bearer-token bypass when the new policy is enabled.
- Six-calendar-month password renewal using service-only dates/revisions; initial
  renewal for old untracked accounts, local and provider session invalidation.
- Backend-only Supabase access migration and a readiness gate; activation flags
  default false. [Rollout steps](login-security.md) require production SQL/template
  configuration and designated-account acceptance. Not activated by this task.
- Checkout price-expiry/changed-price review: refresh on the same page without
  replacing passenger inputs, or return to search. Refresh never Books. An unknown
  post-submission result does not get a safe-to-retry marker.
- Passenger selection: adults + children occupy at most 9 seats; lap infants
  are separate and cannot outnumber adults (9 adults + 9 infants allowed). Both
  seated plus buttons disable at the combined limit. Reduce infants before
  reducing adults below their number. The same rule validates search, quotes and
  booking passenger bodies; no supplier call is made for invalid search counts.
- Redacted, read-only current/local Git history scanner. Initial audit covered
  1,437 reachable objects / 1,018 text objects, 143 tracked + 9 non-ignored new
  files. Final rerun covered the same history plus 17 non-ignored new files.
  Reviewed flags were mock/test literals; no actionable secret found by the
  implemented patterns. This is NOT proof of absence, a remote history audit,
  rotation of previously exposed credentials or a professional penetration test.
- [YeeFlightLink assessment and phased plan](yeepay-integration-plan.md). No vendor
  connection or real booking/payment. It is a second supplier, not a Spring swap.

## Spring-independent remaining work (not falsely marked complete)

Final local verification: **223 tests passed, 0 failed** on Node 22.23.2.
Changed runtime sources also parse as ES2022; this is not a Node 18 runtime test.
The isolated mock preview was stopped after checking. Real browser acceptance
remains blocked: Edge automation could not launch in the sandbox and the in-app
browser could not reach localhost. At the initial implementation checkpoint, no
production SQL execution, policy activation, commit, push or VPS deployment was
performed by the agent. The later user-reported deployment is recorded above;
browser acceptance is not established by a health response. Future updates follow
the [test-first policy](testing-release-policy.md), not direct-main release by default.

1. Finish the isolated test environment, reconcile the requested hostname and
   obtain working Spring test access. Exercise login policy SQL, Magic Link code
   template and designated users on test before production activation. Check SMTP
   quota/reliability first; never switch production login to test credentials.
2. Notification foundation: persistent tenant-scoped events/unread state, red
   booking badges and a deduplicated email outbox. Agent actions can produce
   events without airline input; airline events wait for the supplier contract.
   App transactional mail is separate from Supabase Auth's SMTP configuration:
   sender **info@airsales.mn** was explicitly approved by the user on 2026-10-06.
   Use server-only SMTP credentials, not pasted secrets. Mail transport/outbox has
   not been implemented or configured by this update; do not claim delivery works.
3. Dedicated forgotten-password recovery, security audit-event retention/alerts,
   backup restore exercise and host/edge distributed rate protection.
4. Price-review UX is mock-tested; obtain current Spring pricing-contract evidence
   before certifying real availability rejection vs transient verification failure.
   Until then say “fare could not be confirmed”, not falsely “sold out”.
5. Previously exposed keys still require provider-side rotation if not already
   rotated. A clean Git pattern scan cannot prove external exposure was remediated.

## Deferred Spring tasks — do not discard

- Confirm API/event for airline-initiated schedule, flight-number and cancellation
  changes, exact passenger/segment identifiers, event semantics, polling quota and
  update latency. Then connect agent email + unread booking badge + before/after
  history. Agent-initiated and airline-initiated changes must be distinguishable.
- Existing automatic status queries preserve per-passenger/per-segment progress.
  Spring support identified 40 flown / 41 checked-in via getOrderDetailInfoC2;
  no No-show status was provided. **Never auto-label No-show 24 hours after flight.**
  Flight time passing and no check-in are not sufficient evidence.
- Preserve prior change history and return segment ticketed while outbound flown.
  Confirm final ticket/change/refund edge cases against an approved supplier case.
- Spring staging remains paused: test authentication returned AUTH-004 (unrecognized
  appKey). Do not bypass credential isolation or use production money endpoints as
  a substitute for an authorized test environment.
- Seek authenticated TLS/private transport for any supplier endpoints still HTTP;
  do not claim portal HTTPS protects the outbound supplier link.

## Sequence

Next: test-site readiness / new Spring test access → test-environment auth acceptance
and independent notification foundation / recovery → YeePay contract gate and
offline adapter → test-site read-only pilot → explicitly approved order/payment
pilot → after-sales → tested batch promoted to production. Every future update
repeats test acceptance before production. Resume Spring notification ingestion
once support confirms the contract. No recurring automation was created.
