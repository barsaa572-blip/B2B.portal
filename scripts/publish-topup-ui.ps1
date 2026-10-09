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
    'admin.js', 'admin.css', 'app.js', 'backend/supabase-client.mjs', 'backend/cny-approval.mjs', 'backend/booking-diagnostic.mjs', 'backend/spring-client.mjs',
    'index.html', 'money-display.js', 'money-display.css', 'night-theme.css', 'server.mjs', 'styles.css',
    'scripts/check-cny-currency-browser.cjs', 'scripts/publish-topup-ui.ps1', 'scripts/publish-topup-ui.mjs', 'scripts/deploy-topup-ui.sh',
    'scripts/set-bank-crawl-interval.mjs', 'scripts/deploy-bank-crawl-interval.sh',
    'tests/cny-approval.test.mjs', 'tests/cny-funding-http.test.mjs', 'tests/cny-funding.test.mjs', 'tests/booking-diagnostic.test.mjs',
    'tests/money-display-dom.test.cjs', 'tests/money-typography.test.mjs', 'tests/pricing-model-two-fx.test.mjs', 'tests/settlement-audit-ui.test.mjs',
    'tests/support/cny-ui-server.cjs', 'tests/bank-crawl-interval.test.mjs', 'tests/topup-release.test.mjs',
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
    'tests/bank-crawl-interval.test.mjs', 'tests/topup-release.test.mjs', 'tests/settlement-audit-ui.test.mjs', 'tests/booking-diagnostic.test.mjs'
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
& $taskNode scripts/check-cny-currency-browser.cjs $taskPlaywright
if ($LASTEXITCODE -ne 0) { throw 'STOP: Browser acceptance failed. No push.' }
Invoke-ReleaseGit diff --check
Invoke-ReleaseGit add -- @taskFiles
Invoke-ReleaseGit diff --cached --check
& git -c "safe.directory=$taskRepo" diff --cached --quiet
if ($LASTEXITCODE -eq 1) { Invoke-ReleaseGit commit -m 'Fix checkout passenger enum values and validate real form submission' }
elseif ($LASTEXITCODE -ne 0) { throw 'STOP: Staged diff check failed.' }
Invoke-ReleaseGit push origin main
$taskCommit = Invoke-ReleaseGit rev-parse HEAD
$taskRemoteHead = Invoke-ReleaseGit ls-remote origin refs/heads/main
if (($taskRemoteHead -split '\s+')[0] -ne $taskCommit) { throw 'STOP: Remote revision does not match. Do not deploy.' }
Write-Host "Commit: $taskCommit"
Write-Host 'READY: Git push verified. Run the VPS block next.'
