-- Run once in Supabase SQL Editor.
-- An approved top-up must always create (or increase) the agency wallet.
-- This supersedes earlier versions of approve_topup_request.

create or replace function public.approve_topup_request(p_topup_id uuid, p_approved_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare request_row public.topup_requests;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_approved_by and role = 'platform_admin' and active
  ) then
    raise exception 'Only an active platform administrator can approve top-ups';
  end if;

  select * into request_row
  from public.topup_requests
  where id = p_topup_id
  for update;

  if not found then
    raise exception 'Top-up request not found';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'This top-up request has already been processed';
  end if;

  update public.topup_requests
  set status = 'approved', approved_at = now(), approved_by = p_approved_by
  where id = p_topup_id;

  insert into public.wallets (agency_id, balance_cny, updated_at)
  values (request_row.agency_id, request_row.amount_cny, now())
  on conflict (agency_id) do update
  set balance_cny = public.wallets.balance_cny + excluded.balance_cny,
      updated_at = now();

  insert into public.wallet_transactions (agency_id, entry_type, amount_cny, reason, created_by)
  values (
    request_row.agency_id,
    'credit',
    request_row.amount_cny,
    'Top-up approved: ' || request_row.invoice_number,
    p_approved_by
  );
end;
$$;
