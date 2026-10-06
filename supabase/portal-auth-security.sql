-- Apply to the production project only with the matching backend release.
-- Service-side portal access replaces direct browser REST reads. RLS stays on.
begin;

create table if not exists public.password_security (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_changed_at timestamptz not null,
  revision uuid not null default gen_random_uuid()
);
alter table public.password_security enable row level security;
revoke all on public.password_security from public, anon, authenticated;
grant select, insert, update, delete on public.password_security to service_role;

-- No guessed last-change date for old accounts: they renew on their next login.
create or replace function public.record_portal_password_change(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.password_security(user_id, password_changed_at, revision)
  values(p_user_id, clock_timestamp(), gen_random_uuid())
  on conflict(user_id) do update set password_changed_at = excluded.password_changed_at,
    revision = excluded.revision;
$$;
revoke all on function public.record_portal_password_change(uuid) from public, anon, authenticated;
grant execute on function public.record_portal_password_change(uuid) to service_role;

-- Remove inherited PUBLIC privileges too; this statement grants nobody access.
revoke all on public.agencies, public.branches, public.profiles, public.bookings,
  public.wallets, public.wallet_transactions, public.topup_requests,
  public.financial_operations, public.retail_pricing from public, anon, authenticated;

create or replace function public.portal_auth_security_ready()
returns boolean language sql security definer set search_path = '' as $$
  select not exists (
    select 1 from unnest(array['agencies','branches','profiles','bookings','wallets',
      'wallet_transactions','topup_requests','financial_operations','retail_pricing',
      'password_security']) t(name)
    cross join unnest(array['anon','authenticated']) r(name)
    where has_table_privilege(r.name, 'public.' || t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r.name, 'public.' || t.name, 'SELECT,INSERT,UPDATE,REFERENCES')
  ) and not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['anon','authenticated']) r(name)
    where n.nspname = 'public' and c.relkind in ('v','m')
      and (has_table_privilege(r.name, c.oid, 'SELECT')
        or has_any_column_privilege(r.name, c.oid, 'SELECT'))
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon','authenticated']) r(name)
    where n.nspname = 'public' and p.prosecdef
      and p.proname not in ('current_agency_id','is_platform_admin','portal_active_reader')
      and has_function_privilege(r.name, p.oid, 'EXECUTE')
  );
$$;
revoke all on function public.portal_auth_security_ready() from public, anon, authenticated;
grant execute on function public.portal_auth_security_ready() to service_role;

commit;

-- SQL editor uses postgres; backend uses service_role. Both must return true.
select public.portal_auth_security_ready();
