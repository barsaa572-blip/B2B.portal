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
do $pre_cny_guard$
begin
  if to_regprocedure('public.cny_funding_ready()') is not null then
    raise exception 'HISTORICAL_SQL_DISABLED: this file must not overwrite current CNY funding functions';
  end if;
end;
$pre_cny_guard$;

-- HISTORICAL EMPTY-PROJECT BOOTSTRAP ONLY. See supabase/migrations.
alter table public.topup_requests add column if not exists expires_at timestamptz;
alter table public.topup_requests alter column expires_at drop default;
alter table public.topup_requests alter column expires_at drop not null;
alter table public.topup_requests drop constraint if exists topup_requests_status_check;
alter table public.topup_requests add constraint topup_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

create or replace function public.expire_pending_topup_requests()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'INVOICE_EXPIRY_DISABLED';
end;
$$;
revoke all on function public.expire_pending_topup_requests()
  from public, anon, authenticated, service_role;
