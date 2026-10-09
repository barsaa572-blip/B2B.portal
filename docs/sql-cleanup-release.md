# SQL cleanup release — 2026-10-09

All five requested cleanup items are addressed. Production SQL has already been
applied through Supabase migrations; the VPS rollout deploys code only.

- Wallet reset and invoice expiry are inert, execution-revoked stubs.
- `expires_at` is nullable with no default. Old values remain historical metadata;
  no invoice status, wallet balance, ledger or customer row is changed.
- Four policies use `(select auth.uid())`; ownership, permissive/restrictive mode,
  roles and agency boundaries are preserved. Fourteen FK indexes were added.
- PUBLIC/anon execution was removed from `current_agency_id` and
  `is_platform_admin`. Authenticated RLS helper execution remains intentional.
- A schema-only baseline captures 12 tables, 29 original functions, constraints,
  indexes, triggers, policies and ACLs. It verifies existing schema rather than
  rebuilding it. Standalone historical SQL now stops before doing any work once
  `nexahub_baseline` is registered. No helpers/legacy financial wrappers were dropped.

## One forward migration history

The exact applied versions and names are recorded in `supabase/migration-journal.json`.
CLI-created baseline/cleanup/readiness filenames were aligned to the versions
returned by Supabase. The earlier wallet reset migration was imported verbatim.
For this existing production project all four migrations are already applied;
do not execute them again in SQL Editor, and never run `db reset` on production.
Future changes use a new CLI-created migration, isolated tests, then one reviewed
deployment. Do not re-run old root-level SQL files or auto-apply SQL during a VPS pull.

Fresh projects must bootstrap the schema-only `nexahub_baseline` first (it refuses
an empty public schema with existing auth users), then the cleanup and readiness
migrations. The pre-baseline retirement query is an imported historical record,
not a first-run installer: its original definition guard intentionally fails on
an empty database. When onboarding a fresh project to CLI migration tracking,
record the pre-baseline retirement as already covered by the baseline rather
than replaying it. The historical staging installer remains a guarded legacy test
fixture, not the canonical production schema or a production upgrade script.
The baseline does not copy customers, balances, config rows, passwords or credentials;
model activation/configuration on a new project remains a separate reviewed action.

## Verification

Local: 318 unit/HTTP tests, exact-baseline/repeat/drift and cleanup/repeat in isolated
Postgres; financial approval/payment/refund bodies unchanged; existing CNY funding
and retail settlement integration scripts pass.

Production: cleanup/funding/auth/retail readiness all true. FK-index and per-row
RLS warnings are gone; anonymous helper warning is gone. Existing row counts:
wallets 2, ledger 1, bookings 1, invoices 2, CNY receipts 1. Production business-row
fingerprint inspection was denied by the safety review and was not bypassed; these
are metadata/readiness/count checks, not a row-by-row financial reconciliation.

Remaining advisor findings are outside this requested five-item cleanup:
server-only RLS tables with no client policies, intentional authenticated helpers,
leaked-password protection configuration, and unused-index information (new indexes
have not served traffic yet). Do not remove the indexes just because they are new.

## Git / VPS

Publish through `scripts/publish-topup-ui.mjs` from ordinary Windows PowerShell.
It stages an explicit allowlist, preserves unrelated YeePay work, and stops before
staging/push if browser acceptance fails. The sandbox cannot start the browser;
ordinary PowerShell must complete that gate. No browser-test bypass is permitted.
Git Bash syntax validation is also mandatory before staging. The sandbox blocked
Git Bash's named-object initialization, so it must run in ordinary PowerShell too.

The VPS deployment first verifies the new read-only `portal_sql_cleanup_ready` RPC
before stopping the service. It never calls reset/expiry or executes migration SQL.
SQL files may be downloaded as tracked release artifacts; package/env changes stay
blocked. Private code/env backup, fast-forward-only update, runtime permissions,
tests and health checks remain required.
