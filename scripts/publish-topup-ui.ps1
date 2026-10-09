$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRepo = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $taskRepo
function Invoke-ReleaseGit {
    & git -c "safe.directory=$taskRepo" @args
    if ($LASTEXITCODE -ne 0) { throw 'STOP: Git failed. Do not deploy.' }
}
if ((Invoke-ReleaseGit branch --show-current) -ne 'main') { throw 'STOP: main branch required.' }
$taskRemote = Invoke-ReleaseGit remote get-url origin
if ($taskRemote -notin @('https://github.com/barsaa572-blip/B2B.portal.git', 'git@github.com:barsaa572-blip/B2B.portal.git')) { throw 'STOP: Unexpected origin.' }
$taskFiles = @(
    '.gitignore', '.gitattributes',
    'admin.js', 'admin.css', 'app.js', 'backend/supabase-client.mjs', 'backend/cny-approval.mjs', 'backend/booking-diagnostic.mjs', 'backend/spring-client.mjs',
    'index.html', 'money-display.js', 'money-display.css', 'night-theme.css', 'server.mjs', 'styles.css',
    'scripts/check-cny-currency-browser.cjs', 'scripts/publish-topup-ui.ps1', 'scripts/publish-topup-ui.mjs', 'scripts/deploy-topup-ui.sh',
    'scripts/set-bank-crawl-interval.mjs', 'scripts/deploy-bank-crawl-interval.sh',
    'tests/cny-approval.test.mjs', 'tests/cny-funding-http.test.mjs', 'tests/cny-funding.test.mjs', 'tests/booking-diagnostic.test.mjs', 'tests/supplier-status-ui.test.mjs',
    'tests/money-display-dom.test.cjs', 'tests/money-typography.test.mjs', 'tests/pricing-model-two-fx.test.mjs', 'tests/settlement-audit-ui.test.mjs',
    'tests/support/cny-ui-server.cjs', 'tests/bank-crawl-interval.test.mjs', 'tests/topup-release.test.mjs',
    'supabase/admin-functions.sql',
    'supabase/agency-contact-details.sql',
    'supabase/agent-contact-details.sql',
    'supabase/change-wallet-payment.sql',
    'supabase/cny-funding.sql',
    'supabase/mnt-pricing.sql',
    'supabase/portal-auth-security.sql',
    'supabase/remove-topup-expiry.sql',
    'supabase/retail-rounding.sql',
    'supabase/schema.sql',
    'supabase/security-hardening.sql',
    'supabase/spring-status-sync.sql',
    'supabase/tenant-access-hardening.sql',
    'supabase/topup-bank-transfer-fees.sql',
    'supabase/topup-expiry.sql',
    'supabase/topup-wallet-credit-fix.sql',
    'supabase/topups.sql',
    'supabase/wallet-funding-controls.sql',
    'supabase/baseline-catalog.json',
    'supabase/migration-journal.json',
    'supabase/migrations/20261009100739_disable_wallet_reset.sql',
    'supabase/migrations/20261009102942_nexahub_baseline.sql',
    'supabase/migrations/20261009102947_retire_expiry_optimize_access.sql',
    'supabase/migrations/20261009103332_verify_sql_cleanup_readiness.sql',
    'deploy/staging/empty-test-schema.sql',
    'docs/wallet-reset-retirement.md',
    'docs/sql-cleanup-release.md',
    'scripts/test-sql-cleanup-db.mjs',
    'scripts/sql-cleanup-preflight.mjs',
    'tests/sql-cleanup.test.mjs',
    'tests/sql-cleanup-preflight.test.mjs',
    'tests/wallet-reset-disabled.test.mjs',
    'tests/security-http.test.mjs',
    'CODEX_HANDOVER.md', 'docs/cny-funding-release.md', 'docs/work-roadmap.md', 'docs/bank-crawl-three-hour-release.md'
)
foreach ($taskStaged in @(Invoke-ReleaseGit diff --cached --name-only)) {
    if ($taskStaged -notin $taskFiles) { throw 'STOP: Unrelated staged changes. Preserve them and review before publication.' }
}
$taskNode = Join-Path $taskRepo 'tmp/security/node24/node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode = (Get-Command node -ErrorAction Stop).Source }
& $taskNode --check server.mjs
if ($LASTEXITCODE -ne 0) { throw 'STOP: Syntax check failed.' }
$taskTests = @((Invoke-ReleaseGit ls-files -- 'tests/*.test.*')) + @(
    'tests/cny-approval.test.mjs', 'tests/money-typography.test.mjs',
    'tests/bank-crawl-interval.test.mjs', 'tests/topup-release.test.mjs', 'tests/settlement-audit-ui.test.mjs', 'tests/booking-diagnostic.test.mjs', 'tests/supplier-status-ui.test.mjs',
    'tests/wallet-reset-disabled.test.mjs', 'tests/sql-cleanup.test.mjs', 'tests/sql-cleanup-preflight.test.mjs'
)
$taskTests = @($taskTests | Sort-Object -Unique)
$taskPreviousPython = $env:PYTHON_FOR_FX_TEST
$taskPython = 'C:/Users/barsa/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
try {
    if (Test-Path -LiteralPath $taskPython) { $env:PYTHON_FOR_FX_TEST = $taskPython }
    & $taskNode --test @taskTests
    if ($LASTEXITCODE -ne 0) { throw 'STOP: Tests failed. No push.' }
} finally {
    if ($null -eq $taskPreviousPython) { Remove-Item Env:PYTHON_FOR_FX_TEST -ErrorAction SilentlyContinue }
    else { $env:PYTHON_FOR_FX_TEST = $taskPreviousPython }
}
$taskPlaywright = 'C:/Users/barsa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
& $taskNode scripts/test-sql-cleanup-db.mjs
if ($LASTEXITCODE -ne 0) { throw 'STOP: Isolated SQL verification failed. No push.' }
& 'C:/Program Files/Git/bin/bash.exe' -n scripts/deploy-topup-ui.sh
if ($LASTEXITCODE -ne 0) { throw 'STOP: VPS script syntax verification failed. No push.' }
& $taskNode scripts/check-cny-currency-browser.cjs $taskPlaywright
if ($LASTEXITCODE -ne 0) { throw 'STOP: Browser acceptance failed. No push.' }
Invoke-ReleaseGit diff --check
Invoke-ReleaseGit add -- @taskFiles
Invoke-ReleaseGit diff --cached --check
& git -c "safe.directory=$taskRepo" diff --cached --quiet
if ($LASTEXITCODE -eq 1) { Invoke-ReleaseGit commit -m 'Retire unsafe wallet operations and standardize SQL migrations' }
elseif ($LASTEXITCODE -ne 0) { throw 'STOP: Staged diff check failed.' }
Invoke-ReleaseGit push origin main
$taskCommit = Invoke-ReleaseGit rev-parse HEAD
$taskRemoteHead = Invoke-ReleaseGit ls-remote origin refs/heads/main
if (($taskRemoteHead -split '\s+')[0] -ne $taskCommit) { throw 'STOP: Remote revision does not match. Do not deploy.' }
Write-Host "Commit: $taskCommit"
Write-Host 'READY: Git push verified. Run the VPS block next.'
