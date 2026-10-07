# Test-first development and production promotion

User-approved workflow, recorded 2026-10-06. This is a plan and release policy,
not evidence that the test site, DNS, supplier credentials or pipelines are ready.

## Environments

- Confirmed test-site hostname: `test.nexahub.airsales.ub.mn` (latest explicit
  user choice). The earlier `test.nexahub.ub.mn` plan is superseded.
- Production remains `nexahub.airsales.ub.mn`.
- Existing staging files match the confirmed hostname. Both candidate domain
  lookups returned no address on the VPS. Restore DNS A -> `202.131.1.50` for
  the confirmed name; verify DNS/TLS/test Auth redirects before deployment.
  Do not bypass existing origin/credential guards to make it start.
- Reuse and inspect the previously prepared isolated staging setup before making
  another copy: `/opt/flightb2b-test`, port 4174, service `flightb2b-test`, separate
  env under `/etc/flightb2b-test`, and the separate test Supabase project. Its live
  configuration/migration state must be checked; previous setup is not proof of
  readiness. Production stays `/opt/flightb2b`, port 4173, service `flightb2b`.
- Latest user-provided VPS inspection (2026-10-06): both test directories exist,
  but `flightb2b-test` reports `LoadState=not-found`, `ActiveState=inactive`, and
  an empty `FragmentPath`. The service is not installed; do not clone over or
  recreate the existing directories. Subsequent checks returned no domain address
  and rejected a Spring client ID matching production. A guarded `start.mjs
  --check` is read-only and sends no supplier request; passing it alone does not
  certify working Spring credentials or authorize test transactions.

## Initial setup and supplier work

1. Restore/finish the test site and confirm its access protection, DNS/TLS, test
   accounts and database migrations. Never copy production secrets, wallets,
   customer/passport data or Auth users into test. Use synthetic test data.
2. The user will obtain fresh Spring test-environment access. Confirm its endpoints,
   appKey/client credentials, whitelisted VPS IP and booking/payment permissions
   with Spring. Keep Spring staging paused until authorized test authentication
   succeeds; the earlier AUTH-004 result is not resolved by this plan.
   Security/UI acceptance can proceed with the explicitly supplier-disabled
   mode documented in `deploy/staging/README.md`: separate test Supabase remains
   mandatory; all Spring credentials/URLs are removed, status sync disabled,
   flight/booking actions denied before any supplier or financial call. This
   does not certify Spring functionality or permit real transactions.
3. Implement YeeFlightLink first on the **portal test site**, as a second supplier
   beside Spring. Begin with offline contract/crypto fixtures, then an approved
   read-only search/rules/price pilot, then authorized order/payment/after-sales
   acceptance. Do not connect it to agent-facing production before acceptance.
4. YeeFlightLink's reviewed FAQ says there is **no supplier sandbox**. Our portal
   test site does not make its upstream production API safe or simulated. Ask for
   current approved testing arrangements, merchant/channel access (including MU),
   dedicated account/credentials where available, quotas and settlement rules.
   Live order, payment, cancellation and refund calls remain disabled until each
   controlled test is explicitly authorized with spend limits and reconciliation.
   Do not weaken Spring test-isolation rules to accommodate YeeFlightLink.

## Default workflow for every future change

Local development → `develop` / review branch → test deployment and acceptance →
reviewed release into `main` → production deployment → smoke checks.

- Inspect branch state before creating/reusing `develop`; do not reset user work.
- All features, security/auth changes, provider adapters, pricing and database
  migrations go through the test environment first. Accumulate reviewed changes
  there; release a tested batch, not unverified work directly to production.
- Automated tests plus browser acceptance cover login/roles, tenant isolation,
  search/counts/price expiry, booking/ticketing, wallet rounding, invoice PDFs,
  change/refund history, notifications and duplicate/timeout money handling.
- Test-service credentials, sessions, provider identifiers and callbacks must be
  environment-scoped. Wrong-environment callbacks fail closed. SMTP is server-only;
  test emails go only to designated test recipients, not real agents/passengers.
- Promote only the exact reviewed code revision and separately reviewed database
  migrations/configuration. If merging into main changes the code, deploy and test
  that resulting revision on test before production. Never promote test data or
  copy a test env file into production. Provision production keys independently.
- Before production: record acceptance, take appropriate backup/snapshot, review
  pending operations and prepare code/schema rollback. A code revert alone does
  not undo supplier money actions or database changes.
- After production: check health/site/login/permissions and safe non-financial
  smoke tests. Real booking/payment tests require their own approval. Record exact
  commit, migrations and acceptance outcome in the work ledger.

The portal test workflow applies going forward. Historical direct-main/VPS
commands in old handover/release notes do not replace this new default policy.
No Git branch, DNS, VPS service, credentials, scheduled automation or supplier
connection was created or changed by recording this policy.
