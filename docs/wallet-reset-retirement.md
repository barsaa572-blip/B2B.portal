# Wallet reset retirement

Scope: only `public.platform_reset_all_wallets(uuid)` and its backend caller.
No balances, ledger rows, bookings, invoices or receipt records are modified.
Keep the signature as an inert, security-invoker stub so old callers cannot reset data.
Revoke all execution from PUBLIC, anon, authenticated and service_role.

The existing HTTP authentication boundary already rejected reset requests.
Remove its unreachable destructive handler and RPC export as defense in depth.
Old bootstrap SQL must not recreate the destructive body or restore service_role execution.
Never re-run full historical financial SQL against production to apply this change.

## Production migration

Project: `gxofgtasjaxqxmbqljhd` (`production.nexahub`).
Migration name: `disable_wallet_reset` via the Supabase migration tool.
The definition guard deliberately stops if the previously reviewed function changed.
At retirement time the Supabase CLI was unavailable; this is the exact remote
query. The already-applied migration is now imported into the versioned history;
see sql-cleanup-release.md for the baseline and future deployment workflow.

```sql
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if (select md5(pg_get_functiondef(p.oid)) from pg_proc p
      where p.oid = to_regprocedure('public.platform_reset_all_wallets(uuid)'))
      is distinct from '5beab5048d4a98de6014c8960d202eb2' then
    raise exception 'Wallet reset definition changed. Review before applying.';
  end if;
end;
$guard$;

create or replace function public.platform_reset_all_wallets(p_created_by uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'WALLET_RESET_DISABLED';
end;
$$;
revoke all on function public.platform_reset_all_wallets(uuid)
  from public, anon, authenticated, service_role;
comment on function public.platform_reset_all_wallets(uuid) is
  'Retired: wallet balances and financial history must never be reset.';
notify pgrst, 'reload schema';
```

## Recovery reference

Before applying, the original definition, owner, ACL and comment were saved to
ignored `tmp/security/wallet-reset-before.json`. This contains no credentials or
customer rows. It is a manual recovery reference only, never an automated rollback.
Restoring it re-enables financial-history deletion and needs fresh explicit approval.

## Verification

- Local HTTP: authenticated admin and agent requests are denied with
  `WALLET_RESET_DISABLED`; anonymous requests remain unauthenticated; no DB writes.
- Isolated Postgres: even the function owner receives the disabled error;
  API roles have no execute permission; balances and ledger rows are unchanged.
- Production: inspect the stub, owner/security/ACL, financial readiness and before/after
  row fingerprints. Do not invoke the old reset function or run a real payment test.
- Apply local backend cleanup separately through the normal Git/VPS release.

## Applied result — 2026-10-09

Production migration succeeded. The live function is security invoker with an
empty search path, contains only the disabled exception, and is executable by
neither anon, authenticated nor service_role. Its owner remains postgres.

Before/after fingerprints match for wallets (2), wallet_transactions (1),
bookings (1), topup_requests (2) and cny_funding_receipts (1). The definitions
and ACLs of all other public functions also match. CNY funding, auth security
and retail pricing readiness remain true.

314 local tests pass, including HTTP no-write denial. The exact guarded remote
migration also passed in isolated Postgres, with preserved balances and ledger.
Security/performance advisors were rechecked; pre-existing, unrelated findings
remain for a separately scoped follow-up. No Git push or VPS code deployment
was performed. The database-level retirement is already effective in production.
