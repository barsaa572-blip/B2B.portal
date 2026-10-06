# Controlled release — Windows Git and VPS together

**Not executed by this task.** Browser QA was blocked by the local automation
sandbox (Edge launch failed; in-app browser could not reach localhost). The full
Node/mock HTTP tests pass (223 passed, 0 failed; local Node 22.23.2). SQL runtime
and production Node 18 acceptance have not been run. Run the browser check in your normal Windows PowerShell
before committing/pushing. No real email, account or supplier transaction is used
by that check. Keep the new AUTH flags false for this initial code deployment.

## 1. Windows PowerShell (not the VPS terminal)

Copy the entire block at once. `npm.cmd` avoids the blocked npm.ps1 wrapper.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  Set-Location -LiteralPath 'C:\Users\barsa\Documents\Codex\2026-08-05\za\outputs\B2B.portal'
  function Invoke-PortalGit {
    & git -c "safe.directory=$($PWD.Path)" -c http.sslBackend=openssl @args
    if ($LASTEXITCODE -ne 0) { throw 'Git failed. Stop here.' }
  }
  if ((Invoke-PortalGit branch --show-current).Trim() -ne 'main') { throw 'Stop: expected main.' }
  & git -c "safe.directory=$($PWD.Path)" diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Stop: existing staged changes need review.' }
  npm.cmd ci --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  node --test tests/*.test.*
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed. Do not push.' }
  node scripts/audit-git-secrets.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Secret audit needs review. Do not push.' }
  node scripts/check-login-security-browser.cjs 'C:/Users/barsa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
  if ($LASTEXITCODE -ne 0) { throw 'Browser check failed. Do not push.' }
  Invoke-PortalGit add -- .env.example CODEX_HANDOVER.md SECURITY_DEPLOYMENT.md `
    app.js auth.js styles.css backend/browser-session.mjs backend/supabase-client.mjs `
    backend/input-validation.mjs backend/spring-pricing.mjs `
    backend/booking-review.mjs backend/login-security.mjs `
    docs/login-security.md docs/work-roadmap.md docs/yeepay-integration-plan.md `
    docs/release-login-security.md scripts/audit-git-secrets.mjs `
    scripts/check-login-security-browser.cjs scripts/serve-login-preview.mjs `
    server.mjs supabase/portal-auth-security.sql supabase/templates/login-code.html `
    tests/password-change.test.mjs tests/spring-pricing.test.mjs `
    tests/booking-review.test.mjs tests/login-security-http.test.mjs `
    tests/login-security.test.mjs tests/secret-audit.test.mjs `
    tests/input-validation.test.mjs tests/passenger-counts.test.mjs tests/search-failure.test.cjs
  Invoke-PortalGit --no-pager diff --cached --stat
  Invoke-PortalGit commit -m 'Add guarded email login, password renewal and fare review'
  Invoke-PortalGit push origin main
  Write-Host 'Copy this exact commit for the VPS:'
  Invoke-PortalGit rev-parse HEAD
}
```

The two pre-existing typo/untracked files are intentionally not staged. If Git
push fails/crashes, stop and inspect status; do not disable TLS or repeat commit.

## 2. VPS Bash (not Windows PowerShell)

This prompts for the exact commit printed above. It does not accept latest main
silently. It refuses tracked local changes and does not upgrade production Node.
Ensure AUTH_EMAIL_OTP_REQUIRED / AUTH_PASSWORD_ROTATION_REQUIRED are unset/false
until the SQL/template and account acceptance steps in `docs/login-security.md`.

```bash
(
  set -eu
  cd /opt/flightb2b
  if [ -n "$(git -c safe.directory=/opt/flightb2b status --porcelain --untracked-files=no)" ]; then
    echo 'STOP: tracked VPS changes need review.'
    exit 1
  fi
  read -r -p 'Paste the Windows commit (40 hex characters): ' PORTAL_DEPLOY_REVISION
  case "$PORTAL_DEPLOY_REVISION" in
    ''|*[!0-9a-f]*) echo 'STOP: invalid commit.'; exit 1 ;;
  esac
  [ "${#PORTAL_DEPLOY_REVISION}" -eq 40 ] || exit 1
  git -c safe.directory=/opt/flightb2b fetch origin main
  [ "$(git -c safe.directory=/opt/flightb2b rev-parse origin/main)" = "$PORTAL_DEPLOY_REVISION" ] || {
    echo 'STOP: main differs from the reviewed commit.'; exit 1;
  }
  git -c safe.directory=/opt/flightb2b merge --ff-only "$PORTAL_DEPLOY_REVISION"
  npm ci --ignore-scripts
  /usr/bin/node --check server.mjs
  /usr/bin/node --test tests/*.test.*
  systemctl restart flightb2b
  systemctl is-active --quiet flightb2b
  PORTAL_READY=false
  for PORTAL_ATTEMPT in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 3 http://127.0.0.1:4173/api/health; then
      PORTAL_READY=true; break
    fi
    sleep 1
  done
  [ "$PORTAL_READY" = true ] || { echo 'STOP: backend health failed.'; exit 1; }
  curl -fsS --max-time 15 -o /dev/null -w 'Website HTTP: %{http_code}\n' https://nexahub.airsales.ub.mn/
  echo 'READY: Code deployed. AUTH policy activation is a separate gated step.'
)
```

If any test fails, do not restart. If service/health fails after restarting,
inspect `journalctl -u flightb2b -n 60 --no-pager` locally; redact secrets/PII before
sharing. This block does not rewrite user data or roll back the checkout.
