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

-- Run once in the Supabase SQL Editor before deploying the bank-fee invoice update.
-- Each invoice snapshots the specific banking charges that were quoted to the agency.
alter table public.topup_requests
  add column if not exists correspondent_fee_cny numeric(14,2) not null default 0,
  add column if not exists correspondent_fee_mnt numeric(14,0) not null default 0,
  add column if not exists khaan_transfer_fee_mnt numeric(14,0) not null default 0,
  add column if not exists bank_transfer_fee_mnt numeric(14,0) not null default 0,
  add column if not exists bank_name text;

comment on column public.topup_requests.correspondent_fee_cny is
  'Golomt Bank CNY OUR fee: 50 CNY through 100,000 CNY, otherwise 150 CNY.';

comment on column public.topup_requests.khaan_transfer_fee_mnt is
  'Historical Khaan Bank transfer-fee snapshot.';

comment on column public.topup_requests.bank_transfer_fee_mnt is
  'Golomt Bank CNY transfer fee: 5000 MNT through 50,000 CNY; 10000 MNT through 100,000 CNY; 20000 MNT above.';
