# Security rollout — 2026-09-10

## Required deployment order

1. Take a database backup and verify restore access. Use a maintenance window;
   stop financial activity while deploying. Do not run live airline payments as tests.
2. Apply `supabase/security-hardening.sql` using the Supabase SQL Editor as the
   database administrator. Apply after existing wallet/top-up/change migrations.
   It changes privileges and adds operation records; it deletes no business data.
   Never re-run older schema/permission scripts after it without reviewing grants.
3. Deploy this backend AND the updated `app.js` together; restart `flightb2b`.
   Hard refresh browsers. Old change quotes must be recalculated.
4. Check Nginx below. Test with isolated test accounts/data and test supplier
   credentials. The production Spring TLS problem is separate and still unresolved.

The new issue/change/refund functions fail closed if the operation RPC is missing.
This migration has NOT been executed against production by Codex. Unit/HTTP tests
use local fakes; they do not validate live PostgreSQL permissions or Spring behavior.

## What changed

- Repository files (.env, .git, backend source, SQL, docs/tests) are not public assets.
- APIs except health/login/refresh/airport lookup/FX require a valid active session.
  Agency/account status is checked; admin routes retain their separate role checks.
- Direct browser writes to financial/business tables and direct execution of
  actor-parameter financial RPCs are revoked. Existing read-isolation policies remain;
  a restrictive active-account/agency policy is added to direct authenticated reads.
- Top-up approval is one locked database transaction: status + balance + ledger.
- New booking requests cannot inject top-level change quotes/refund history/status.
- Change payment needs a server-stored quote, exact app ID/amount, and a timestamp
  within 15 minutes. Replacement metadata is obtained from Spring, not the browser.
  Standalone `change-submit` is disabled; use the guarded `change-pay` workflow.
- Issue/change/refund claim a durable database operation BEFORE supplier mutation.
  One agency can have only one active/review operation. Restart does not clear it.
- Browser wallet reset is disabled. Manual adjustments are blocked during an
  unresolved financial operation. Ticketed bookings must use refund, not local cancel.
- Sync cannot turn an unpaid local booking into Ticketed without reconciliation.
- CSP (self-hosted scripts only), anti-framing, nosniff, no-referrer and same-origin
  request checks; bounded request bodies/headers and upstream timeouts.

## Application rate limits

| Scope | Limit |
| --- | --- |
| All API requests per source IP | 1200/minute |
| Login per source IP | 30/15 minutes |
| Token refresh per source IP | 120/minute |
| Authenticated account, all API requests | 240/minute |
| Flight search per account | 30/minute |
| Writes per account | 30/minute |
| Top-up creation per account | 5/10 minutes |

Top-up maximum: 1 billion MNT per invoice; note 1000 characters, reference 200.
Limits count attempts, including failed attempts. They are in-memory per Node process,
not a distributed DDoS defense. Proxied IPs share the IP limit until trusted proxy
configuration is verified. Account limits do not depend on forwarded IP headers.

## Nginx must not bypass the application boundary

Inspect the actual server block (`sudo nginx -T`) locally; do not post credentials
or a full config publicly. If Nginx serves the repository via `root` / `try_files`,
the Node allowlist cannot protect those direct responses. Prefer proxying to Node:

```nginx
# Merge into the EXISTING server block; do not replace certificates or other apps.
location ~ (^|/)\. { return 404; }
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100k;
    proxy_read_timeout 120s;
}
```

Remove/review conflicting static locations that expose repo contents. Run `nginx -t`
before reload. Only after confirming Nginx overwrites X-Real-IP, set
`TRUST_PROXY_LOOPBACK=true` in `/etc/flightb2b/flightb2b.env` and restart. If using a
CDN, separately configure trusted CDN proxy ranges; do not trust arbitrary headers.

Verify BOTH localhost and the public address return 404 for `/server.mjs`,
`/backend/supabase-client.mjs`, `/.env`, `/.git/config`, `/supabase/schema.sql`.
Anonymous `/api/wallet` and `/api/flights` should return 401. The homepage must have
Content-Security-Policy and X-Frame-Options headers. Check browser console for CSP
regressions; do not solve them by enabling unsafe-inline scripts.

## Review queue / ambiguous supplier outcomes

An operation remains `pending` on a process crash, or `needs_review` on an error
after the claim. Even a network error may mean the supplier accepted the request.
Do NOT clear this with an automatic timer or retry the airline payment.

Read-only SQL for finance/database administrators:

```sql
select id, agency_id, booking_id, actor_id, action, reference, amount_cny,
       state, created_at, updated_at
from public.financial_operations
where state in ('pending', 'needs_review')
order by created_at;
```

Reconcile the exact operation against supplier order/application status and the
wallet ledger. If the supplier accepted it, repair only the missing local ledger/
booking state and mark the operation completed in a controlled transaction. Only
if the supplier confirms NO mutation/payment occurred may an administrator mark
the operation released. Record evidence and operator identity outside the immutable
operation fields. There is deliberately no public release endpoint or blanket SQL
cleanup command. The migration does not reconcile historical 600/300 CNY payments.

## Database privilege verification (read-only)

```sql
select p.oid::regprocedure as function_name,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as browser_can_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as backend_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'approve_topup_request','platform_adjust_wallet','platform_reset_all_wallets',
  'assert_wallet_funds','issue_booking_from_wallet','record_change_payment',
  'begin_financial_operation','finish_financial_operation');
```

Expected: false / false / true. Also inspect any custom functions, custom roles,
column-level grants or policies installed outside this repository; these are not
covered by the known-function migration. In staging, test two concurrent approvals,
two concurrent agency payments, disabled users, cross-agency IDs and direct Supabase
REST/RPC requests. Confirm exactly one credit/debit and no supplier retry.

## Still required before broad public production use

- HTTPS for the portal and authenticated TLS to the supplier. Domain setup is
  deferred, NOT replaced by these changes. Do not transmit real credentials or
  passenger/payment information over unencrypted public HTTP.
- Rotate the previously exposed Spring/Supabase secrets, revoke old credentials,
  and review historical access. Backend protections do not protect a leaked service key.
- Admin/finance MFA, secure session review (currently browser sessionStorage),
  comprehensive stored-XSS/PII review, backups/restore tests and alerting.
- Hosting/edge rate limits or WAF for volumetric/distributed attacks. The application
  limiter does not stop attacks that saturate the network before reaching Node.
- Dedicated reconciliation workflow, production PostgreSQL concurrency tests,
  and end-to-end tests with supplier TEST credentials. No claim of complete security
  or penetration-test certification is made by this change.
