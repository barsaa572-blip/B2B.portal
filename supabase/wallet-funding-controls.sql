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

-- Run once in Supabase SQL Editor.
-- Wallet reset is retired. Keep a non-mutating stub for old callers;
-- never zero balances or delete financial history through this function.

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

-- Checks funds only. Do not create a ledger debit here: that must happen in
-- the same server-side transaction as a confirmed Spring payment/issue call.
create or replace function public.assert_wallet_funds(
  p_agency_id uuid,
  p_amount_cny numeric,
  p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  current_balance numeric;
begin
  if coalesce(p_amount_cny, 0) < 0 then
    raise exception 'Wallet amount cannot be negative';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and active
      and (role = 'platform_admin' or agency_id = p_agency_id)
  ) then
    raise exception 'You do not have access to this agency wallet';
  end if;

  select balance_cny into current_balance
  from public.wallets
  where agency_id = p_agency_id
  for share;

  if not found then
    raise exception 'Wallet not found for this agency';
  end if;

  if coalesce(current_balance, 0) < p_amount_cny then
    raise exception 'Insufficient wallet balance. Required: % CNY. Available: % CNY.',
      round(p_amount_cny, 2), round(current_balance, 2);
  end if;

  return jsonb_build_object('ok', true, 'availableCny', current_balance, 'requiredCny', p_amount_cny);
end;
$$;

-- Issue from a prepaid agency wallet. All three operations happen inside one
-- database transaction: validate the user and deadline, debit the wallet,
-- then mark the booking Ticketed. This prevents double-charging and prevents
-- a ticket from being marked issued when the wallet balance is insufficient.
create or replace function public.issue_booking_from_wallet(
  p_booking_id uuid,
  p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  booking_row public.bookings;
  current_balance numeric;
begin
  select * into booking_row
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and active
      and (
        role = 'platform_admin'
        or id = booking_row.created_by
        or (role = 'office_manager' and agency_id = booking_row.agency_id)
      )
  ) then
    raise exception 'You do not have access to issue this booking';
  end if;

  if booking_row.status <> 'Reserved' then
    raise exception 'This booking is no longer available for ticket issue';
  end if;

  if booking_row.created_at <= now() - interval '30 minutes' then
    update public.bookings set status = 'Cancelled' where id = booking_row.id;
    raise exception 'The 30-minute ticketing deadline has passed. The reservation has been cancelled.';
  end if;

  select balance_cny into current_balance
  from public.wallets
  where agency_id = booking_row.agency_id
  for update;

  if not found then
    raise exception 'Wallet not found for this agency';
  end if;

  if coalesce(current_balance, 0) < booking_row.total_cny then
    raise exception 'Insufficient wallet balance. Required: % CNY. Available: % CNY.',
      round(booking_row.total_cny, 2), round(current_balance, 2);
  end if;

  update public.wallets
  set balance_cny = balance_cny - booking_row.total_cny,
      updated_at = now()
  where agency_id = booking_row.agency_id;

  insert into public.wallet_transactions (agency_id, entry_type, amount_cny, reason, created_by)
  values (
    booking_row.agency_id,
    'debit',
    -booking_row.total_cny,
    'Ticket issue: ' || coalesce(booking_row.pnr, booking_row.id::text),
    p_actor_id
  );

  update public.bookings
  set status = 'Ticketed'
  where id = booking_row.id;

  return jsonb_build_object(
    'id', booking_row.id,
    'pnr', booking_row.pnr,
    'status', 'Ticketed',
    'debitedCny', booking_row.total_cny,
    'balanceCny', current_balance - booking_row.total_cny
  );
end;
$$;
