-- Run once in Supabase SQL Editor.
create table if not exists public.topup_requests (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  agency_id uuid not null references public.agencies(id),
  requested_by uuid not null references public.profiles(id),
  amount_cny numeric(14,2) not null check (amount_cny > 0),
  payment_reference text not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);

alter table public.topup_requests enable row level security;

drop policy if exists "topup request isolation" on public.topup_requests;
create policy "topup request isolation" on public.topup_requests for select using (
  requested_by = auth.uid()
  or public.is_platform_admin()
  or (
    agency_id = public.current_agency_id()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'office_manager')
  )
);

-- The platform approval both credits the wallet and saves its ledger entry in one transaction.
create or replace function public.approve_topup_request(p_topup_id uuid, p_approved_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare request_row public.topup_requests;
begin
  if not exists (select 1 from public.profiles where id = p_approved_by and role = 'platform_admin' and active) then
    raise exception 'Only an active platform administrator can approve top-ups';
  end if;
  select * into request_row from public.topup_requests where id = p_topup_id for update;
  if not found then raise exception 'Top-up request not found'; end if;
  if request_row.status <> 'pending' then raise exception 'This top-up request has already been processed'; end if;
  update public.topup_requests set status = 'approved', approved_at = now(), approved_by = p_approved_by where id = p_topup_id;
  -- An agency wallet may have been reset or may not have been created yet.
  -- Upsert guarantees that an approved invoice always creates its credit.
  insert into public.wallets (agency_id, balance_cny, updated_at)
  values (request_row.agency_id, request_row.amount_cny, now())
  on conflict (agency_id) do update
  set balance_cny = public.wallets.balance_cny + excluded.balance_cny,
      updated_at = now();
  insert into public.wallet_transactions (agency_id, entry_type, amount_cny, reason, created_by)
  values (request_row.agency_id, 'credit', request_row.amount_cny, 'Top-up approved: ' || request_row.invoice_number, p_approved_by);
end;
$$;
