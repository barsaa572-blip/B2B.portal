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

-- Run once in Supabase SQL Editor. Keeps a permanent pricing snapshot on each invoice/booking.
alter table public.topup_requests
  add column if not exists amount_mnt numeric(14,0),
  add column if not exists service_fee_mnt numeric(14,0) not null default 0,
  add column if not exists total_mnt numeric(14,0),
  add column if not exists official_cny_mnt_rate numeric(14,4),
  add column if not exists markup_mnt numeric(14,2) not null default 4,
  add column if not exists effective_cny_mnt_rate numeric(14,4),
  add column if not exists rate_date date;

alter table public.bookings
  add column if not exists total_mnt numeric(14,0),
  add column if not exists official_cny_mnt_rate numeric(14,4),
  add column if not exists markup_mnt numeric(14,2) not null default 4,
  add column if not exists effective_cny_mnt_rate numeric(14,4),
  add column if not exists rate_date date;
