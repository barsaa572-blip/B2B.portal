-- Run before deploying the change-payment update.
create or replace function public.record_change_payment(
  p_pnr text, p_app_id text, p_amount numeric, p_actor uuid,
  p_check_only boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  balance numeric;
  previous numeric;
  reference text;
begin
  if p_amount is null or p_amount <= 0 or p_app_id is null or p_app_id !~ '^[0-9]+$' then
    raise exception 'Invalid change payment';
  end if;
  select * into b from public.bookings where pnr = p_pnr;
  if not found then raise exception 'Booking not found'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor and p.active
    and (p.role = 'platform_admin' or (p.agency_id = b.agency_id
      and (p.role = 'office_manager' or (p.role = 'agent' and b.created_by = p.id))
      and exists(select 1 from public.agencies a where a.id = b.agency_id and a.active)))) then
    raise exception 'Booking access denied';
  end if;
  select balance_cny into balance from public.wallets where agency_id = b.agency_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  reference := 'Change fee payment: ' || p_pnr || ' | Spring application ' || p_app_id;
  select amount_cny into previous from public.wallet_transactions
    where agency_id = b.agency_id and reason = reference limit 1;
  if found then
    if previous <> -round(p_amount, 2) then raise exception 'Change amount mismatch'; end if;
    return jsonb_build_object('recorded', true);
  end if;
  if p_check_only then
    if balance < round(p_amount, 2) then raise exception 'Insufficient wallet balance'; end if;
    return jsonb_build_object('recorded', false);
  end if;
  -- Supplier has already accepted payment. Always record the actual liability.
  update public.wallets set balance_cny = balance_cny - round(p_amount, 2), updated_at = now()
    where agency_id = b.agency_id;
  insert into public.wallet_transactions(agency_id, entry_type, amount_cny, reason, created_by)
    values(b.agency_id, 'debit', -round(p_amount, 2), reference, p_actor);
  return jsonb_build_object('recorded', true);
end;
$$;
revoke all on function public.record_change_payment(text,text,numeric,uuid,boolean) from public, anon, authenticated;
grant execute on function public.record_change_payment(text,text,numeric,uuid,boolean) to service_role;
notify pgrst, 'reload schema';
