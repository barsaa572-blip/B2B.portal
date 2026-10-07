# Security fixes and controlled activation — 2026-10-06

User-provided VPS output on 2026-10-06 confirms `flightb2b` runs
`/usr/bin/node /opt/flightb2b/server.mjs` with Node **18.19.1**. The previously
installed isolated `/opt/nexahub-node/bin/node` must be checked on the VPS and
the currently deployed source tested with it before any runtime-only switch.
The user then ran the currently deployed source with that isolated Node
**24.21.0** and a cleared provider environment: **223 tests passed, 0 failed**.
This validates the deployed source on the VPS, not the 244-test local security
patch. The user then executed the service-only override
`/etc/systemd/system/flightb2b.service.d/90-nexahub-node24.conf`, pointing to
`/opt/nexahub-node/bin/node /opt/flightb2b/server.mjs`. The guarded restart checked
backend health and the live process executable. Reported result: service
**active**, **v24.21.0**, **Website HTTP 200**, **READY**. This is user-provided
confirmation; direct SSH is still unavailable. `/usr/bin/node` was not replaced.

Status: runtime-only migration confirmed by the user. Application security
changes remain local, NOT pushed/deployed/activated on production.
SSH to root@202.131.1.50 failed with permission denied. Never ask the user to paste
a password, signing key, API key, bearer token or entire environment file.

## Implemented

1. Price-panel refresh now uses `safeHtml`. Baggage text is escaped before markup
   generation. The regression exercises actual price-panel builders/refresh;
   an AST guard rejects unprotected HTML assignments in public application code.
2. Server-enforced **20-minute inactivity** expiration. Only the authenticated,
   same-origin `/api/auth/activity` endpoint moves the idle deadline. Browser
   activity comes from trusted typing, pointer, input and scrolling events; it
   is throttled to one request per minute. Background polling/token refresh,
   hidden-page events, synthetic events and offline failures never extend it.
   Expired/suspended browsers cannot revive an expired cookie. The UI returns to
   sign-in, closes private dialogs and displays session expiry. Multiple tabs
   of the same session share acknowledged deadlines through BroadcastChannel.
   The existing 12-hour absolute session cap is retained: activity extends idle
   time, not indefinite authenticated lifetime.
3. **One-year HSTS**, max-age=31536000, host-only, no preload/includeSubDomains.
   Backend response header is updated. VPS helper also updates the existing
   production Nginx header and suppresses duplicate upstream HSTS. It validates
   the expected domain/proxy, tests Nginx before reload and restores its backup
   on validation failure. It does not touch test DNS or Certbot certificate paths.
4. Email verification is remembered **24 elapsed hours from successful OTP**,
   not renewed on each password login. A persistent HttpOnly, Secure, SameSite
   Strict, `__Host-` host-only signed receipt survives browser/PC restarts and
   ordinary logout. It is not a session and cannot authorize an API or replace
   a password. Each sign-in still authenticates the password and verifies current
   user/agency status. Receipt identity binds account, email and private password
   revision; password changes invalidate it. A different browser/device, cookie
   deletion, incognito mode or a signing-key change requires another OTP.
   This remains a portal email second-step, **not Supabase native AAL2 MFA**.
5. Supplier endpoint validation, no credential-bearing URLs and no JSON redirect
   following. `SPRING_REQUIRE_TLS=true` is available after compatible HTTPS URLs
   are accepted; it refuses HTTP and never falls back or disables certificates.
   This guard is **not** encryption of the existing plaintext supplier connection.
   Credit-payment rejection logs no longer record raw SOAP XML/free-text replies
   that could reflect credentials or passenger data.
6. VPS runtime helper detects the actual service Node executable. An EOL/non-LTS
   runtime can move to isolated official **Node 24.21.0 LTS**, verified against
   official SHA256. It runs all tests under that Linux binary before changing a
   service-only override, verifies the live process executable after restart,
   checks backend health and restores the prior service configuration on failure.
   `/usr/bin/node` and other services are never upgraded. Existing supported Node
   22/24 majors are reported without an automatic major-version migration.

## Verification performed locally

- Full isolated suite: **250 passed, 0 failed**, on Node 22.23.2 and official
  Node 24.21.0 Windows x64. The Node 24 download passed its official SHA256 check.
- HTTP integration checks cover password+OTP, restricted pending authority,
  authenticated same-origin activity, receipt survival after logout, fresh
  password checks and receipt-only denial. Deterministic clocks test 20-minute
  idle expiration and fixed 24-hour email expiry.
- Local reachable Git/working-tree secret-pattern audit: no findings after
  review of explicitly fake test fixtures. No real credentials were added.
- Real-browser automated QA **passed in the user's normal PowerShell** on
  2026-10-06. The user supplied all PASS output from
  `scripts/check-html-security.cjs` and
  `scripts/check-login-security-browser.cjs`: XSS, forms, clobber protection,
  local/blocked-remote preview, table rows/XSS, actual checkout refresh with real
  sanitizer, actual admin forms/table structure, email code/error/password
  renewal/subsequent login/token-free storage, and mobile/cancellation layout.
  The earlier desktop sandbox Edge launch failure remains historical only; no
  bypass was attempted. These isolated browser checks do not certify the remote
  test database, SMTP delivery or full staging acceptance, which remain required.
- Credential-free TLS handshakes to the previously reported Spring production
  hostname ports 7001/7003 timed out. This does not prove HTTPS is unavailable
  everywhere or identify a replacement endpoint. No authenticated Spring request,
  booking, payment, refund or email was sent in these diagnostics.

## Remaining production prerequisites

Follow `docs/testing-release-policy.md`: accept exact code on the isolated test
site before promotion. The user confirmed `test.nexahub.airsales.ub.mn`; DNS
returns no address and the unit is not installed. Fresh supplier test access
remains pending. Local supplier-disabled mode now permits security/UI acceptance
without retaining Spring credentials or sending supplier requests; it still
requires isolated test Supabase and normal authentication. See staging README.
This new test mode has not been deployed. Do not bypass staging guards.

1. Inspect current VPS runtime without secrets:

   ```bash
   systemctl show flightb2b -p ExecStart --no-pager
   /usr/bin/node -v
   ```

   Once matching scripts are in the VPS checkout:

   ```bash
   cd /opt/flightb2b
   /usr/bin/node scripts/vps-security-preflight.mjs --check-auth
   ```

   This prints only the service runtime/version, policy booleans, signing-key
   readiness and supplier URL protocols/hosts/ports, never keys or full URLs.

2. Apply `supabase/portal-auth-security.sql` to the correct test project, then the
   production project at promotion. `select public.portal_auth_security_ready();`
   must return true. No migration was executed by this coding task. Keep the
   finance/table backend-only privilege gates; do not loosen them to pass.

3. Keep the working Supabase Invite template. Set **Magic Link** to the existing
   `supabase/templates/login-code.html` template and accept delivery of the code
   with a designated account. Review SMTP quota before enabling required OTP.
   Existing accounts with no trusted password-change date will renew once.

4. After the exact accepted commit is in `/opt/flightb2b`, run ONE gated operation
   at a time. Replace the placeholder below with that commit's 40-character hash.
   The helper rejects another checkout or tracked local changes. These are not
   blind "latest main" deployment commands.

   ```bash
   node scripts/apply-vps-security.mjs --revision ACCEPTED_40_CHARACTER_COMMIT --hsts
   node scripts/apply-vps-security.mjs --revision ACCEPTED_40_CHARACTER_COMMIT --upgrade-node
   # Only after the SQL/template/account checks above:
   node scripts/apply-vps-security.mjs --revision ACCEPTED_40_CHARACTER_COMMIT --activate-login --email-code-template-confirmed
   ```

   Activation generates and saves a private persistent `AUTH_DEVICE_SECRET`
   automatically when missing, without displaying it, sets both AUTH flags true
   and restarts the portal. Restarts sign existing sessions out. The receipt
   survives later server restarts while the key and password revision stay stable.
   The helper keeps private configuration backups and tests health; actual SMTP
   delivery, UI and agency-account acceptance remain mandatory afterwards.

   If Node was already on a supported major, upgrade-node intentionally does not
   restart the service. A normal accepted-code deployment/restart is still needed
   for source changes when not running the activation step. A failed download or
   runtime test does not alter the active service; inspect any retained temporary
   runtime directory before retrying. No automatic recursive deletion is used.

5. Confirm live HSTS exactly once, OTP after 24 hours, no OTP on same-browser
   password login after ordinary logout within 24 hours, denied receipt-only API,
   active typing >20 minutes and unattended logout at20 minutes. Check two agencies
   and a manager/admin without any business transaction.

## Spring encryption is still supplier-dependent

Current HTTP endpoints have NOT been changed; `SPRING_REQUIRE_TLS` defaults false
for compatibility. Request matching production/test **HTTPS JSON and SOAP URLs**,
valid TLS certificates and unchanged path/auth/XML semantics from Spring, or a
provider-approved encrypted VPN/private tunnel covering the entire network path.
A local HTTPS wrapper followed by remote plaintext HTTP is not a complete fix.
After synthetic test acceptance, set matching URLs and SPRING_REQUIRE_TLS=true
together, with no fallback. Do not enable that flag against the current HTTP
URLs: it intentionally blocks requests.

References:

- https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html
- https://nodejs.org/en/about/previous-releases
- https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
- https://supabase.com/docs/guides/auth/auth-email-passwordless
