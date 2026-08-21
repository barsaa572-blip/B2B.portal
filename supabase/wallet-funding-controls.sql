-- Run once in Supabase SQL Editor.
-- This reset intentionally preserves bookings and top-up invoices; it clears
-- only wallet balances and the wallet ledger/history requested by the admin.

create or replace function public.platform_reset_all_wallets(p_created_by uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = p_created_by and role = 'platform_admin' and active
  ) then
    raise exception 'Only an active platform administrator can reset wallets';
  end if;

  delete from public.wallet_transactions;
  update public.wallets set balance_cny = 0, updated_at = now();
end;
$$;

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
