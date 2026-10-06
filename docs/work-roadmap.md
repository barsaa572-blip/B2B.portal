# NEXAHUB work ledger — 2026-10-06

This is the persistent record requested by the user: do Spring-independent work
first, retain supplier questions, do not silently invent airline behavior.
Local implementation does **not** imply VPS deployment or production acceptance.

## Implemented locally in this update

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
browser could not reach localhost. No production SQL execution, policy activation,
commit, push or VPS deployment was performed. Use the guarded combined
[Windows/VPS release instructions](release-login-security.md); do not skip the
browser acceptance gate merely because the Node tests pass.

1. Production acceptance/activation of login policy: correct project SQL, Magic
   Link code template and designated users. Check SMTP quota/reliability first.
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

Next: finish auth acceptance → independent notification foundation / recovery →
YeePay contract gate and offline adapter → approved read-only pilot → explicit
booking/payment pilot → after-sales. Resume Spring notification ingestion once
support confirms the contract. No recurring automation was created.
