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
