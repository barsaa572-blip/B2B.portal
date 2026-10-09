-- HISTORICAL BOOTSTRAP ONLY: current releases use supabase/migrations.
do $historical_guard$
declare registered boolean := false;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select exists(select 1 from supabase_migrations.schema_migrations where name = ''nexahub_baseline'')' into registered;
  end if;
  if registered then
    raise exception 'HISTORICAL_SQL_DISABLED: use versioned migrations, not old standalone files';
  end if;
end;
$historical_guard$;

-- Run after schema.sql and security-hardening.sql in the intended project.
-- Additional RESTRICTIVE read gates; existing ownership and active-user
-- policies stay in place. This does not grant access or alter stored records.
begin;

do $$
begin
  if to_regprocedure('public.current_agency_id()') is null
    or to_regprocedure('public.is_platform_admin()') is null
    or to_regprocedure('public.portal_active_reader()') is null then
    raise exception 'Install the portal schema/security helpers first.';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('bookings', 'topup_requests')
        and c.relkind = 'r' and c.relrowsecurity) <> 2 then
    raise exception 'Both portal tables must exist with RLS enabled.';
  end if;
  if (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('bookings', 'topup_requests')
        and p.polname = 'active portal readers only'
        and not p.polpermissive and p.polcmd = 'r') <> 2 then
    raise exception 'Install restrictive active-reader policies first.';
  end if;
end
$$;

drop policy if exists "portal current agency boundary" on public.bookings;
create policy "portal current agency boundary" on public.bookings
  as restrictive for select to authenticated
  using (public.is_platform_admin() or agency_id = public.current_agency_id());

drop policy if exists "portal current agency boundary" on public.topup_requests;
create policy "portal current agency boundary" on public.topup_requests
  as restrictive for select to authenticated
  using (public.is_platform_admin() or agency_id = public.current_agency_id());

commit;
