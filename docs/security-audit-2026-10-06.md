# Production security review — 2026-10-06

Subsequent local fixes are recorded in [security-fixes-2026-10-06.md](security-fixes-2026-10-06.md).
This audit is the pre-fix evidence; local fixes do not certify live production changes.

Target: https://nexahub.airsales.ub.mn/

Scope: low-volume public HTTP/TLS checks, public frontend comparison against local
Git HEAD 5bbc444, local source review, reachable Git secret-pattern scan,
dependency audit and isolated automated tests. No customer account was used. No
booking, payment, refund, invitation, password or production configuration was
changed. Two empty login validation requests used no email/password and could
not reach provider authentication in the reviewed handler.

## Findings

### 1. Price-panel refresh bypasses HTML sanitization — priority high

Evidence: app.js:828 assigns `checkoutPricePanel()` directly to `outerHTML`.
`baggageSummary()` interpolates supplier baggage values into HTML without escaping
them (app.js:775–801). `normaliseSpring()` preserves those values without numeric
or text validation (server.mjs:429–434).

The public production app.js matches local Git HEAD after normalizing line
endings. A local VM diagnostic using a harmless `<b data-security-audit>` marker
confirmed raw markup reaches the assignment, with zero calls to `safeHtml`.
Nothing malicious was submitted to production.

Impact: if supplier baggage data contains attacker-controlled markup, it can
alter checkout HTML. This is a confirmed unsafe sink/data-flow in the reviewed
code, not proof of arbitrary JavaScript execution in production. The live CSP
blocks ordinary inline scripts/event handlers, but is not a replacement for
sanitization. Server normalization is based on matching local source; private
deployed backend bytes were not retrieved.

Recommended fix: route the refresh assignment through the existing sanitizer,
escape baggage text, validate supplier baggage fields and add a regression test
covering actual price-panel refresh. No fix applied in this audit.

### 2. HSTS lifetime is only five minutes — priority low

Confirmed live header: `Strict-Transport-Security: max-age=300`.
HTTP redirects to same-host HTTPS and the certificate validates. The short
lifetime leaves little persistent browser protection between visits.

Recommended: after HTTPS/renewal acceptance, increase gradually toward a longer
production lifetime. Do not enable includeSubDomains/preload without checking
all affected domains, including planned test domains.

Reference: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html

### 3. Email-step / password-renewal activation needs confirmation

Both empty login requests, with and without Origin, returned HTTP 400:
`Email and password are required.`

In the reviewed server, an active login-security policy rejects a missing Origin
with 403 before validating those fields. The live behavior therefore suggests
both policies are inactive, or the private deployed backend differs from the
reviewed version. Public frontend matching alone does not prove backend matching.
No valid account was authenticated, and actual production environment flags were
not read. Do not label mandatory email verification as production-verified yet.

### 4. No idle-session expiry in reviewed source — priority medium

backend/browser-session.mjs:6 defaults to an absolute 12-hour lifetime. `find`
checks only the absolute deadline; it tracks no last-activity time. Provider
access-token expiry/refresh may shorten effective access, so this is not a claim
that a live session was measured as usable for all 12 hours.

Recommended: add server-enforced idle expiry, with an appropriate agent workflow
timeout and shorter handling for privileged operations. Production session
behavior was not tested with a real account.

Reference: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

### 5. VPS runtime and Spring transport require internal checks

- Earlier VPS output showed production Node 18.19.1. Node 18 is EOL; current
  production executable/version was not checked through SSH in this audit.
  Reference: https://nodejs.org/en/about/previous-releases
- Earlier production Spring URLs used HTTP. Reviewed clients permit HTTP, and
  SOAP includes username/password in its XML body. If those current endpoints
  remain HTTP over an unprotected network path, credentials and booking data
  have no transport encryption. Confirm current protocols and any protected
  tunnel with the provider; do not assume an HTTPS endpoint exists.
- Confirm TRUST_PROXY_LOOPBACK and Nginx address forwarding together. The
  application has per-IP limits, but a wrong proxy setting can make agents share
  one limit. No flooding/rate-limit exhaustion was attempted on production.

## Checks that passed

- Unauthenticated admin, wallet, bookings, flights, top-ups, invoice and backend
  status requests returned 401.
- .env, .git/config, server.mjs, backend/supabase-client.mjs, schema.sql,
  package.json and a private documentation path returned 404.
- Foreign Origin / cross-site requests returned 403 without wildcard CORS;
  the tested preflight returned 405 without CORS access.
- Live CSP, nosniff, frame denial, no-referrer, permissions policy and no-store
  were present. A validated connection negotiated TLS 1.3; the certificate
  expires 2026-12-20. Other protocol/cipher combinations were not exhaustively
  tested.
- Public auth.js, admin.js, safe-html.js and dompurify.js matched local bytes;
  app.js matched after line-ending normalization. Pattern scan of those public
  files found no secret-key matches.
- Local secret audit scanned 159 tracked files, 3 untracked files, 1,476 reachable
  Git objects / 1,050 text objects and reported no matches. This does not cover
  ignored files, unfetched remote history, dangling objects or provider-side
  secret rotation. No matched secret values were printed.
- Local production dependency audit reported zero known vulnerabilities.
  This does not establish the VPS-installed dependency or OS patch state.
- Local automated suite: 223 passed, 0 failed. Provider boundaries are mocked;
  this does not establish live database policies or prove every HTML sink safe.

## Not verified

Current Supabase RLS, grants, security-definer RPC permissions and cross-agent
access using actual production identities; mandatory login email step; live
cookie/logout lifecycle; VPS firewall/SSH/OS patch state; current Spring URL
protocols; runtime version; database/backups restoration; provider-key rotation.

A direct public port-4173 request timed out; that alone is not proof of firewall
isolation. Reviewed server source binds to loopback. No private production
environment contents, customer records or authorization tokens were collected.

Only this report was added locally. No runtime/code fix, Git push or VPS deploy
was performed.
