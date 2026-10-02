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
it also exercises actual admin create/edit agency and user form submissions
against mocked APIs. It does not prove that a complete invoice PDF renders correctly.

Admin form controls use `agencyName` and `accountRole` to avoid built-in DOM
name collisions; submit handlers map these back to the existing `name` and
`role` API fields. DOMPurify's clobbering protection remains enabled.

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

Server-held sessions use opaque HttpOnly/Secure/SameSite cookies. Restart signs
users out; old browser token sessions are discarded and require a fresh login.
Refresh does not extend the absolute session deadline. Verify login, refresh,
logout, booking/passenger forms, wallet and real invoice/PDF rendering on HTTPS.

Nginx HSTS was confirmed separately with `max-age=300`. This is a short trial,
not the final long-term policy. Preserve existing CSP/security headers and
validate TLS renewal before raising the duration. Do not add includeSubDomains
or preload without checking affected hosts. Inline styles remain allowed in CSP.

Email ownership verification is NOT complete: admin-created users still use
`email_confirm: true`. Configure production SMTP and implement/test invitation
or confirmation/password-setup routing before changing that flag. Do not lock
out existing users. Email verification is distinct from the deferred email 2FA
and six-month password renewal features. Never paste SMTP passwords/API keys
into chat or put them in frontend/Git.

No Git push, database migration or VPS deployment is implied by local tests.
