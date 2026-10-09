# CNY funding follow-up release — deployed 9 October 2026, user evidence

**Latest local follow-up, not deployed:** Invoice amounts are stacked, frozen
breakdown is a full-width disclosure row, approval is one dialog with required
real bank reference/NET CNY and one final submit. Checkout total18px regular400.
Node24 tracked release suite294/294 PASS; updated real mock-browser verification
runs in the Node publisher below before any Git write. Starting local HEAD
5a469625d64426b8e7428b0e8f5c1a6ccaf5a97c; no independent current VPS SHA check.
No financial rules/SQL/env changes; do not approve unpaid invoices for testing.

**New local follow-up, not yet published:** Production TOPUP_CONFIRM_REQUIRED
root cause was missing pricing_model/funding_quote in the admin overview SELECT.
Those fields are now included; unknown model fails closed without empty receipt.
Prices adjusted to20/18px weight600 and top-up secondary MNT13/14px ink color
per new feedback. Release-scoped tests288/288 PASS; updated browser acceptance
still pending. Use the existing Node publisher below (it runs browser before
staging/push) then the same VPS block. No SQL rerun or actual test approval.

Publication: 65ad15b13ded0c30461a88ca2651258f62f6c18a and Git push verified
READY supplied by user; local HEAD matches. User also supplies final VPS
Production UI/approval update complete READY. Helper health/start/import/tests
guards therefore reached completion; no independent remote inspection here.
No SQL activation or manual wallet update by helper. Live invoice approval and
production visual check remain unverified. Earlier prepared/not-executed notes
below are historical and superseded by this acceptance update.

## Current code-only follow-up: use these commands, NOT the historical SQL steps

9 October: release-scoped Node24 suite 287/287 PASS, zero skipped. This excludes
the untracked superseded per-ticket proposal, unlike the earlier whole-folder
296/297 counts. User browser acceptance PASS at both widths. PowerShell helper
syntax and release guards pass; local Git Bash sandbox denies launch, so the VPS
block explicitly runs bash -n before executing anything. No commit/push done by
the agent for this request: user asked for commands. No migration/env change.

Windows PowerShell (tests + mock browser + explicit staging + push + remote SHA).
The .ps1 helper was blocked by the user's execution policy before any Git
mutation. Use the equivalent Node publisher; do not change execution policy:

```powershell
Set-Location 'C:\Users\barsa\Documents\Codex\2026-08-05\za\outputs\B2B.portal'
node .\scripts\publish-topup-ui.mjs
```

Only after Windows prints READY, run on VPS as root. Fetch/show retrieves the
helper without changing the live checkout; it checks cleanliness, takes a
private backup, restores umask022, stops/fast-forwards, checks runtime group
readability, runs tests/preflight, restarts and checks health/public HTTP200.
Any failure is STOP, not permission to reset wallets or reapply SQL.

```bash
(
set -euo pipefail
cd /opt/flightb2b
git -c safe.directory=/opt/flightb2b fetch origin main
export RELEASE_COMMIT=$(git -c safe.directory=/opt/flightb2b rev-parse origin/main)
TASK_UI_DEPLOY=$(mktemp /tmp/nexahub-ui.XXXXXX.sh)
git -c safe.directory=/opt/flightb2b show "${RELEASE_COMMIT}:scripts/deploy-topup-ui.sh" > "$TASK_UI_DEPLOY"
bash -n "$TASK_UI_DEPLOY"
bash "$TASK_UI_DEPLOY"
)
```

No actual invoice approval was tested. After deployment, a real failure should
show a safe TOPUP_* code. Do not approve a fake/unpaid invoice to test this.
The code-only backup does not include node_modules; manifests are checked
unchanged and npm reinstall is deliberately omitted. Separate FX cron rollout
is not rerun; its helper/source are merely preserved in Git.

## Historical original model rollout (already completed, do not repeat)

**Latest status (9 October 2026):** Original main release 9e66a74 is deployed:
user supplies schema ready, runtime imports as service user, health, active and
public HTTP 200 after repairing code read permissions. Instructions below retain
the original release sequence; do not repeat SQL activation or reset balances.
Current local follow-up changes top-up spacing/grouping, restores bold/large
money typography and safe approval errors/receipt checks. 296 unit/isolated HTTP
tests pass (zero skipped). User supplied the updated browser PASS at both
1280px and 390px after fixing the dark fare amount color regression. Targeted
theme/money tests 5/5 PASS; generated mobile price/top-up and desktop top-up
screenshots visually reviewed, no clipping seen. These are MOCK approvals,
not proof that the real bank receipt was credited. Publication/deployment of
this follow-up remains pending. The user accepted the separate three-hour FX collector
rollout; actual next scheduled rate timestamp has not been verified. No new SQL
required for this follow-up. Exact live approval cause still unknown. Do not
claim a real approval succeeded or rate feed is corrected before evidence.

Do NOT enable the new model until the browser check and isolated multi-session
PostgreSQL money-lock checks pass. No live bank/Spring transaction is a test.
Production has not changed. Stop on every error; do not reset balances/history.
User supplied actual browser PASS at 1280px and 390px on 8 October 2026.
User subsequently supplied all four independent-session PostgreSQL PASS lines
and final concurrency PASS on the VPS on 8 October. The verified archive's
test container was removed; production remains unchanged. Browser and concurrency
gates have passed. No Docker Desktop is installed on the user's PC; installation
is unnecessary. Remaining release steps are backup, publication, maintenance,
production SQL/activation, env flag, preflight and deployment.
User reports Docker 29.1.3 on the VPS, host psql absent. A secret-free test
archive/copy/run procedure is prepared in cny-concurrency-vps.md. No Git push
or production checkout change is required to perform that isolated check.

## 1. Ordinary Windows PowerShell: browser acceptance first

```powershell
Set-Location 'C:\Users\barsa\Documents\Codex\2026-08-05\za\outputs\B2B.portal'
node .\scripts\check-cny-currency-browser.cjs 'C:\Users\barsa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
```

Expected PASS at 1280px and 390px: clear actual helper-rendered prices in light/dark
and both currencies; grouped 100,000 input; principal/fee/total hierarchy; names
retained; no real payment side effects; safe MOCK approval failures and success.
Screenshots are saved in tmp/security/price-topup-20261009 for visual review. If it fails,
send error output only (no secrets); do not push/activate yet. For visual review,
`node tests/support/cny-ui-server.cjs` serves the same local fixtures at
http://127.0.0.1:4199; finance mutations disabled. Stop it with Ctrl+C afterward.

## 1b. Real PostgreSQL concurrency, before activation

Docker is available on the VPS. Follow cny-concurrency-vps.md to transfer only
the test bundle and run it outside the production checkout. If using another
test host, first check whether Docker is already available.
Do not install Docker, expose a port or test against the live Supabase project
without separate agreement. The browser PASS does not prove financial locking.

On a host with Docker already running (repository checkout required):

```powershell
docker pull postgres:16-bookworm
# Stop if image download fails.
node .\scripts\check-cny-concurrency.mjs
```

This runner starts only its own random-named disposable PostgreSQL, with network
disabled, no published ports, no host mounts and tmpfs-only test data. Independent
sessions must actually wait on locks; inspecting SQL or serial WASM execution
alone is not accepted. It checks duplicate approvals, cross-agency bank-reference
reuse, duplicate net refund and funding while a supplier operation is unresolved.
Its verified owned test container is automatically removed; no real customer
history is deleted. The downloaded image is left cached for repeat tests.
Missing Docker is STOP, not PASS. The script reads no production env/DB URL.

Image/CLI references: [official PostgreSQL image](https://hub.docker.com/_/postgres),
[Docker run documentation](https://docs.docker.com/reference/cli/docker/container/run/).

## 2. Git push (Windows), only after acceptance

Review status/staged diff before committing. Do not use `git add .`: unrelated
typo files and offline superseded per-ticket drafts must not be included.
The explicit list below is this release, not permission to overwrite other edits.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  Set-Location 'C:\Users\barsa\Documents\Codex\2026-08-05\za\outputs\B2B.portal'
  if ((git -c "safe.directory=$($PWD.Path)" branch --show-current) -ne 'main') { throw 'Main branch required. No push.' }
  npm.cmd ci --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'Install failed. No push.' }
  node --test tests/*.test.*
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed. No push.' }
  git -c "safe.directory=$($PWD.Path)" diff --check
  if ($LASTEXITCODE -ne 0) { throw 'Diff failed. No push.' }
  git -c "safe.directory=$($PWD.Path)" add .env.example .gitignore money-display.js index.html styles.css app.js admin.js server.mjs backend/fx-rate.mjs backend/request-security.mjs backend/retail-pricing.mjs backend/supabase-client.mjs backend/topup-invoice.mjs backend/cny-funding.mjs backend/pricing-model.mjs backend/pricing-model-two-fx.mjs supabase/cny-funding.sql scripts/preview-invoice.mjs scripts/cny-funding-preflight.mjs scripts/test-cny-funding-db.mjs scripts/check-cny-currency-browser.cjs scripts/check-cny-concurrency.mjs tests/cny-concurrency-runner.test.mjs tests/cny-funding.test.mjs tests/cny-funding-http.test.mjs tests/cny-funding-preflight.test.mjs tests/money-display-dom.test.cjs tests/pricing-model-two-fx.test.mjs tests/support/cny-ui-server.cjs docs/pricing-cny-funding.md docs/cny-funding-release.md docs/cny-concurrency-vps.md CODEX_HANDOVER.md docs/work-roadmap.md
  if ($LASTEXITCODE -ne 0) { throw 'Add failed. No push.' }
  git -c "safe.directory=$($PWD.Path)" commit -m "CNY funding with upfront fee and display-only MNT"
  if ($LASTEXITCODE -ne 0) { throw 'Commit failed. No push.' }
  git -c "safe.directory=$($PWD.Path)" push origin main
  if ($LASTEXITCODE -ne 0) { throw 'Push failed. No deploy.' }
  git -c "safe.directory=$($PWD.Path)" rev-parse HEAD
}
```

Retain the printed 40-character tested commit. Sandbox Git crashes must not be
worked around by printing credentials or weakening Windows security.

## 3. VPS Bash: exact revision / maintenance

Have a verified database backup/recovery point and private code/env backup.
Review balances/pending invoices/unresolved financial operations. Announce a
maintenance window: service must be stopped for SQL/model activation. Restart
invalidates browser sessions; stale checkout prices need refresh.

```bash
(
set -euo pipefail
cd /opt/flightb2b
read -r -p 'Paste tested 40-character commit: ' RELEASE
[[ "$RELEASE" =~ ^[0-9a-f]{40}$ ]]
read -r -p 'Verified Supabase backup/recovery point ready? Type YES: ' DB_BACKUP_READY
test "$DB_BACKUP_READY" = YES
test -z "$(git -c safe.directory=/opt/flightb2b status --porcelain --untracked-files=no)"
export PATH=/opt/nexahub-node/bin:$PATH
test "$(node --version | cut -d. -f1)" = v24
git -c safe.directory=/opt/flightb2b fetch origin main
git -c safe.directory=/opt/flightb2b merge-base --is-ancestor "$RELEASE" origin/main

umask 077
CNY_BACKUP=$(mktemp -d /root/nexahub-cny-backup.XXXXXX)
cp -p /etc/flightb2b/flightb2b.env "$CNY_BACKUP/flightb2b.env"
tar --exclude=.git --exclude=tmp --exclude=logs --exclude=.tmp-retail-db --exclude=output -czf "$CNY_BACKUP/code-and-dependencies.tar.gz" .
tar -tzf "$CNY_BACKUP/code-and-dependencies.tar.gz" >/dev/null
echo "Private backup: $CNY_BACKUP"

# Private backup stays protected. Do not carry 077 into public code/dependencies.
umask 022
systemctl stop flightb2b
git -c safe.directory=/opt/flightb2b merge --ff-only "$RELEASE"
test "$(git rev-parse HEAD)" = "$RELEASE"
npm ci --ignore-scripts
node --test tests/*.test.*
runuser -u "$(systemctl show flightb2b -p User --value)" -- /opt/nexahub-node/bin/node --input-type=module -e "await import('./backend/cny-funding.mjs'); await import('./backend/topup-invoice.mjs'); console.log('PASS: service-user runtime imports');"
echo 'READY: code tested; service stopped for SQL activation.'
)
```

No forced reset/guessed branch. Preserve existing local production edits and stop
instead of overwriting them. Do not activate SQL while a legacy process is active.

## 4. Supabase SQL Editor and private env

Apply the complete `supabase/cny-funding.sql` after existing retail-rounding and
security migrations. Additive migration is NOT activation. Then:

```sql
select public.activate_cny_funding();
select public.cny_funding_ready();
```

Second result must be true. Activation refuses nonzero balances, pending invoices
and unsettled operations. Refusal requires finance review, NOT history deletion
or wallet reset. Do not reapply older retail-rounding.sql afterward; it replaces
the v3 store function. Readiness detects this downgrade.

VPS: `nano /etc/flightb2b/flightb2b.env`, set exactly one line:

```text
PRICING_MODEL=cny-funding-v1
```

Keep auth/device/supplier secrets and endpoints unchanged. Official source defaults
to local `/api/rates/bank/MongolBank?limit=1` on port8000. Existing GolomtBank
feed must return dated noncash buy/sell. Do not print/source private env to chat.

## 5. VPS: read-only preflight and restart

```bash
set -euo pipefail
cd /opt/flightb2b
PORTAL_NODE=/opt/nexahub-node/bin/node
"$PORTAL_NODE" scripts/cny-funding-preflight.mjs
systemctl restart flightb2b
for i in {1..20}; do
  if curl -fsS --max-time 3 http://127.0.0.1:4173/api/health; then break; fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:4173/api/health
systemctl is-active flightb2b
curl -fsS --max-time 15 -o /dev/null -w 'Website HTTP: %{http_code}\n' https://nexahub.airsales.ub.mn/
echo 'READY: Deployment complete; finance/browser acceptance still required.'
```

Preflight prints flags/dates only and makes no Spring request. Check the real UI
using designated accounts: CNY entry, official vs SELL, saved PDF, currency toggle,
unchanged passenger forms, admin split. Never approve a fabricated bank receipt.
Receipt acceptance needs finance authority and authorized disposable funds.

## Rollback / financial acceptance

WASM tests do not certify concurrent live PostgreSQL sessions. The user has now
passed the separate real PostgreSQL independent-session test on the VPS: one
receipt/one principal credit for repeated approval, cross-agency bank-reference
collision rollback, one net-only refund credit, and funding serialized/refused
against an unresolved issue operation. This is isolated acceptance, not live
bank/Spring settlement. Authorized real receipt reconciliation remains finance's
responsibility; never fabricate a receipt merely to exercise production approval.

If gate/health fails, keep mutations blocked and review. A code/config rollback
after CNY receipts exist is NOT a payment rollback. Do not switch to legacy to
reinterpret funds, reverse transfers or delete history. Restore only a compatible
version of this model/schema under a reviewed recovery plan.
