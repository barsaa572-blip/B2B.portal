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

-- Run once in Supabase SQL Editor. This creates an atomic, auditable wallet adjustment.
create or replace function public.platform_adjust_wallet(
  p_agency_id uuid,
  p_amount numeric,
  p_reason text,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount = 0 then
    raise exception 'Amount must not be zero';
  end if;
  if not exists (select 1 from public.profiles where id = p_created_by and role = 'platform_admin' and active) then
    raise exception 'Only an active platform administrator can adjust a wallet';
  end if;
  update public.wallets
  set balance_cny = balance_cny + p_amount, updated_at = now()
  where agency_id = p_agency_id;
  if not found then
    raise exception 'Wallet not found';
  end if;
  insert into public.wallet_transactions (agency_id, entry_type, amount_cny, reason, created_by)
  values (p_agency_id, 'adjustment', p_amount, p_reason, p_created_by);
end;
$$;
