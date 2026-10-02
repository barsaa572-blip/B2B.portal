# Security hardening rollout

## Local verification

From the portal checkout, run `npm.cmd ci --ignore-scripts` on Windows (or
`npm ci --ignore-scripts` on Linux), then `node --test tests/*.test.*`.
Do not deploy when any test fails. The isolated HTTP and tenant tests use fake
providers/identities, never real customer accounts or supplier payments.

Optional real-browser HTML check:

```text
node scripts/check-html-security.cjs <path-to-playwright-module>
```

This loads the actual vendored DOMPurify and safe-html files in a headless
browser. All network requests are mocked or blocked. It verifies XSS filtering,
form attributes, DOM-clobbering protection and sandboxed local blob URLs;
bare table row fragments retain their sanitized tr/td structure instead of
being flattened by the HTML document parser.
It also exercises actual admin create/edit agency and user form submissions
against mocked APIs. It does not prove that a complete invoice PDF renders correctly.

Admin form controls use `agencyName` and `accountRole` to avoid built-in DOM
name collisions; submit handlers map these back to the existing `name` and
`role` API fields. DOMPurify's clobbering protection remains enabled.

Optional admin layout regression: `node scripts/check-admin-tables.cjs
<path-to-playwright-module>`. It uses the actual panel markup, theme styles and
renderer with fake accounts/invoices. It checks desktop/dark/mobile column
alignment, contained horizontal scrolling, empty states and pending invoice
actions, generates screenshots in a temporary directory and makes no API writes.

Keep `dompurify.js`, `DOMPURIFY_LICENSE`, `safe-html.js`, the lockfile and all
new backend modules/tests with the deployment. Do not commit `.env`, private
invoice artwork, temporary backups or stray files accidentally created while
copying commands. Existing unrelated working-tree edits must be preserved.

## Supabase tenant boundary (pending until applied)

Apply `supabase/tenant-access-hardening.sql` in the intended Supabase project,
after the existing schema and security-hardening migrations. It is transactional
and refuses to proceed without RLS and restrictive active-reader policies.
It adds restrictive current-agency SELECT gates for bookings and top-ups;
existing ownership and active-user policies are kept. It changes no stored
records, grants no access and does not interfere with the service-role backend.
It closes access to former-agency records after a user is reassigned.

Verify after applying:

```sql
select tablename, policyname, permissive, roles, cmd, qual
from pg_policies
where schemaname = 'public'
  and policyname = 'portal current agency boundary'
order by tablename;
```

Expected: bookings and topup_requests, RESTRICTIVE, authenticated, SELECT,
and `is_platform_admin() OR agency_id = current_agency_id()`.
Local migration tests check structure only, not a live PostgreSQL execution.
Real two-agency account/API tests remain a separate production acceptance step.

## Deployment behavior and remaining checks

Top-level cross-site browser GET navigation is allowed only to `/`, so email
and provider redirects can show the public sign-in page. Cross-site API access,
writes, iframe loads and fetches remain blocked. This navigation exception does
not verify an invite or establish a session. Invitation consumption requires an
explicit same-origin POST and valid password confirmation.

Server-held sessions use opaque HttpOnly/Secure/SameSite cookies. Restart signs
users out; old browser token sessions are discarded and require a fresh login.
Refresh does not extend the absolute session deadline. Verify login, refresh,
logout, booking/passenger forms, wallet and real invoice/PDF rendering on HTTPS.

Nginx HSTS was confirmed separately with `max-age=300`. This is a short trial,
not the final long-term policy. Preserve existing CSP/security headers and
validate TLS renewal before raising the duration. Do not add includeSubDomains
or preload without checking affected hosts. Inline styles remain allowed in CSP.

## Invitation rollout (live acceptance still required)

SMTP delivery was reported working by the operator. Before inviting any new
portal users, set production Supabase Site URL to `https://nexahub.airsales.ub.mn/`
and replace Emails > Templates > Invite user with `supabase/templates/invite.html`.
Keep `.TokenHash`; do not use `.ConfirmationURL` for this new flow. The fragment
is removed from browser history and never stored in sessionStorage/localStorage.
Only submitting the password form consumes the single-use invite, reducing
scanner/prefetch consumption. Do not add broad redirect wildcards.

Deploy backend and frontend together. New manager/agent creation no longer takes
a temporary password or sets `email_confirm: true`; it creates an unconfirmed
Auth account, assigns its profile and sends the invitation via Supabase SMTP.
If sending fails, only the just-created Auth account is cleaned up. Existing
users are not changed. Pending invitation resends are tenant/role checked and
rate-limited; confirmed users must use password recovery, not another invitation.
Password recovery, email 2FA and six-month renewal are NOT implemented here.

Setup returns no bearer tokens and does not log the user into the portal. They
sign in normally after success. A provider password-policy rejection retains a
separate opaque HttpOnly setup cookie for five minutes; it cannot authorize any
portal API, and retry does not consume the invitation a second time. Restart,
expiry, or an uncertain provider network failure may require administrator help.

Test via an admin/manager-created portal user with an owned test mailbox, not an
unassigned Dashboard-only Auth user. Verify email, one click, password setup,
fresh login and correct agency access. Local mocked tests do not prove live SMTP
or PostgreSQL behavior. Old bearer-fragment links are discarded safely; old
expired/consumed invitations cannot be repaired by changing their URL.
Never paste invitation links, SMTP passwords/API keys or bearer tokens into chat.

Optional actual-browser setup check: `node scripts/check-invite-browser.cjs
<path-to-playwright-module>` (all network mocked).

No Git push, database migration or VPS deployment is implied by local tests.
