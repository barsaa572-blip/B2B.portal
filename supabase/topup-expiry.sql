-- Run once in Supabase SQL Editor. Pending top-up invoices expire at 23:59:59 Ulaanbaatar time.
alter table public.topup_requests
  add column if not exists expires_at timestamptz;

update public.topup_requests
set expires_at = ((date_trunc('day', created_at at time zone 'Asia/Ulaanbaatar') + interval '1 day' - interval '1 second') at time zone 'Asia/Ulaanbaatar')
where expires_at is null;

alter table public.topup_requests
  alter column expires_at set default ((date_trunc('day', now() at time zone 'Asia/Ulaanbaatar') + interval '1 day' - interval '1 second') at time zone 'Asia/Ulaanbaatar');

alter table public.topup_requests
  alter column expires_at set not null;

alter table public.topup_requests drop constraint if exists topup_requests_status_check;
alter table public.topup_requests
  add constraint topup_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled'));

create or replace function public.expire_pending_topup_requests()
returns void language sql security definer set search_path = public as $$
  update public.topup_requests
  set status = 'cancelled'
  where status = 'pending' and expires_at <= now();
$$;

create or replace function public.approve_topup_request(p_topup_id uuid, p_approved_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare request_row public.topup_requests;
begin
  if not exists (select 1 from public.profiles where id = p_approved_by and role = 'platform_admin' and active) then
    raise exception 'Only an active platform administrator can approve top-ups';
  end if;
  perform public.expire_pending_topup_requests();
  select * into request_row from public.topup_requests where id = p_topup_id for update;
  if not found then raise exception 'Top-up request not found'; end if;
  if request_row.status <> 'pending' then raise exception 'This top-up request has already been processed or has expired'; end if;
  update public.topup_requests set status = 'approved', approved_at = now(), approved_by = p_approved_by where id = p_topup_id;
  update public.wallets set balance_cny = balance_cny + request_row.amount_cny, updated_at = now() where agency_id = request_row.agency_id;
  insert into public.wallet_transactions (agency_id, entry_type, amount_cny, reason, created_by)
  values (request_row.agency_id, 'credit', request_row.amount_cny, 'Top-up approved: ' || request_row.invoice_number, p_approved_by);
end;
$$;
