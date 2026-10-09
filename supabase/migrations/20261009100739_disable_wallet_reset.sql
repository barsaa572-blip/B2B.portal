-- Imported exact query of the already-applied remote migration, not a new migration.
-- Fresh projects bootstrap from nexahub_baseline; do not replay this historical guard first.
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
