-- Read-only release gate. No business-row reads or writes.
create or replace function public.portal_sql_cleanup_ready()
returns boolean language sql stable security invoker set search_path = '' as $$
  select
    exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='topup_requests' and column_name='expires_at'
        and column_default is null and is_nullable='YES')
    and (select count(*)=2 from pg_catalog.pg_proc p
      where p.oid in (pg_catalog.to_regprocedure('public.platform_reset_all_wallets(uuid)'),
        pg_catalog.to_regprocedure('public.expire_pending_topup_requests()'))
      and not p.prosecdef and p.prosrc like '%DISABLED%'
      and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'))
    and (select count(*)=2 from pg_catalog.pg_proc p
      where p.oid in (pg_catalog.to_regprocedure('public.current_agency_id()'),pg_catalog.to_regprocedure('public.is_platform_admin()'))
        and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
        and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'))
    and (select count(*)=4 from pg_catalog.pg_policies
      where schemaname='public' and policyname in
        ('profile own or platform','agent own bookings','agent creates own booking','topup request isolation')
        and position('SELECT auth.uid()' in coalesce(qual,with_check))>0)
    and (select count(*)=14 from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid
      where c.relnamespace='public'::regnamespace and i.indisvalid and i.indisready and c.relname in
        ('bookings_agency_id_idx','bookings_branch_id_idx','bookings_created_by_idx',
         'cny_funding_receipts_verified_by_idx','financial_operations_actor_id_idx',
         'profiles_agency_id_idx','profiles_branch_id_idx','retail_pricing_actor_id_idx',
         'retail_pricing_settled_by_idx','topup_requests_agency_id_idx','topup_requests_approved_by_idx',
         'topup_requests_requested_by_idx','wallet_transactions_agency_id_idx','wallet_transactions_created_by_idx'));
$$;
revoke all on function public.portal_sql_cleanup_ready() from public, anon, authenticated;
grant execute on function public.portal_sql_cleanup_ready() to service_role;
notify pgrst, 'reload schema';
