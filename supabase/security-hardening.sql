-- Apply AFTER existing schema, top-up, wallet-funding-controls and
-- change-wallet-payment migrations, BEFORE deploying the matching backend.
-- No user data is deleted. Never re-run older permission migrations afterwards.
begin;

-- Browser callers must not supply an arbitrary actor UUID to SECURITY DEFINER
-- financial functions, or forge booking status/quotes through direct REST writes.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'platform_adjust_wallet', 'platform_reset_all_wallets', 'assert_wallet_funds',
      'issue_booking_from_wallet', 'record_change_payment', 'approve_topup_request',
      'expire_pending_topup_requests'
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

revoke insert, update, delete, truncate, references, trigger on
  public.agencies, public.branches, public.profiles, public.bookings,
  public.wallets, public.wallet_transactions, public.topup_requests
  from public, anon, authenticated;

-- Existing isolation policies remain; this restrictive policy additionally
-- rejects direct reads from disabled users/agencies, even with an unexpired JWT.
create or replace function public.portal_active_reader()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.active
    and (p.role = 'platform_admin' or (p.role in ('agent','office_manager')
      and exists(select 1 from public.agencies a where a.id = p.agency_id and a.active))));
$$;
revoke all on function public.portal_active_reader() from public, anon;
grant execute on function public.portal_active_reader() to authenticated, service_role;
do $$
declare table_name text;
begin
  foreach table_name in array array['agencies','branches','profiles','bookings','wallets','wallet_transactions','topup_requests'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "active portal readers only" on public.%I', table_name);
    execute format('create policy "active portal readers only" on public.%I as restrictive for select to authenticated using (public.portal_active_reader())', table_name);
  end loop;
end $$;

-- Approval locks the invoice, changes state, credits wallet and writes ledger
-- inside one transaction. Replaying approval cannot credit the wallet again.
create or replace function public.approve_topup_request(p_topup_id uuid, p_approved_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.topup_requests;
begin
  if not exists(select 1 from public.profiles where id = p_approved_by and role = 'platform_admin' and active) then
    raise exception 'Only an active platform administrator can approve top-ups'; end if;
  select * into r from public.topup_requests where id = p_topup_id for update;
  if not found then raise exception 'Top-up request not found'; end if;
  if r.status <> 'pending' then raise exception 'This top-up request has already been processed'; end if;
  if r.amount_cny is null or r.amount_cny::text in ('NaN','Infinity','-Infinity') or r.amount_cny <= 0 then
    raise exception 'Invalid top-up credit amount'; end if;
  if not exists(select 1 from public.agencies where id = r.agency_id and active) then raise exception 'Agency is inactive'; end if;
  update public.topup_requests set status = 'approved', approved_at = now(), approved_by = p_approved_by where id = r.id;
  insert into public.wallets(agency_id,balance_cny,updated_at) values(r.agency_id,r.amount_cny,now())
    on conflict(agency_id) do update set balance_cny = public.wallets.balance_cny + excluded.balance_cny, updated_at = now();
  insert into public.wallet_transactions(agency_id,entry_type,amount_cny,reason,created_by)
    values(r.agency_id,'credit',r.amount_cny,'Top-up approved: ' || r.invoice_number,p_approved_by);
end $$;
revoke all on function public.approve_topup_request(uuid,uuid) from public, anon, authenticated;
grant execute on function public.approve_topup_request(uuid,uuid) to service_role;

create table if not exists public.financial_operations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  booking_id uuid not null references public.bookings(id),
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('issue', 'change', 'refund')),
  reference text not null,
  amount_cny numeric(14,2) not null check (amount_cny >= 0),
  state text not null default 'pending' check (state in ('pending', 'needs_review', 'completed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists financial_operation_once
  on public.financial_operations(booking_id, action, reference) where state <> 'released';
create unique index if not exists financial_agency_in_flight
  on public.financial_operations(agency_id) where state in ('pending', 'needs_review');
alter table public.financial_operations enable row level security;
revoke all on public.financial_operations from public, anon, authenticated;
grant all on public.financial_operations to service_role;

create or replace function public.begin_financial_operation(
  p_actor uuid, p_pnr text, p_action text, p_reference text, p_amount numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; operation_id uuid; current_balance numeric; q jsonb;
begin
  if p_action is null or p_action not in ('issue', 'change', 'refund')
    or p_reference is null or length(p_reference) not between 1 and 500
    or p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity') or p_amount < 0 then
    raise exception 'Invalid financial operation';
  end if;
  select * into b from public.bookings where pnr = p_pnr;
  if not found then raise exception 'Booking not found'; end if;
  if not exists(select 1 from public.profiles p where p.id = p_actor and p.active
    and (p.role = 'platform_admin' or (p.agency_id = b.agency_id
      and (p.role = 'office_manager' or (p.role = 'agent' and b.created_by = p.id))
      and exists(select 1 from public.agencies a where a.id = b.agency_id and a.active)))) then
    raise exception 'Booking access denied';
  end if;
  -- Serialise agency spending across different tickets and backend processes.
  perform pg_advisory_xact_lock(hashtextextended('financial:' || b.agency_id::text, 0));
  select * into b from public.bookings where id = b.id for update;
  if exists(select 1 from public.financial_operations where agency_id = b.agency_id
    and state in ('pending','needs_review')) then
    raise exception 'Agency has a financial operation in progress or awaiting reconciliation. Do not retry payment';
  end if;
  if exists(select 1 from public.financial_operations where booking_id = b.id
    and action = p_action and reference = p_reference and state <> 'released') then
    raise exception 'This financial operation has already been submitted';
  end if;
  if p_action = 'issue' then
    if b.status <> 'Reserved' or b.created_at <= now() - interval '30 minutes'
      or p_amount <= 0 or round(p_amount,2) <> b.total_cny then
      raise exception 'Booking is not eligible for ticket issue';
    end if;
  else
    if b.status <> 'Ticketed' then raise exception 'Ticketed booking required'; end if;
  end if;
  if p_action = 'change' then
    q := b.itinerary->'changeQuotes'->p_reference;
    if q is null or (q->>'securityVersion') is distinct from '1'
      or (q->>'appId') is distinct from p_reference
      or not (q ? 'quotedAt') or not ((q->'amountsCny') ? 'additionalPayment')
      or (q->>'quotedAt')::timestamptz < now() - interval '15 minutes'
      or (q->>'quotedAt')::timestamptz > now()
      or round((q->'amountsCny'->>'additionalPayment')::numeric,2) is distinct from round(p_amount,2) then
      raise exception 'A current matching server quote is required';
    end if;
  end if;
  select balance_cny into current_balance from public.wallets where agency_id = b.agency_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  if p_action <> 'refund' and (current_balance::text in ('NaN','Infinity','-Infinity') or current_balance < round(p_amount,2)) then raise exception 'Insufficient wallet balance'; end if;
  insert into public.financial_operations(agency_id, booking_id, actor_id, action, reference, amount_cny)
    values(b.agency_id, b.id, p_actor, p_action, p_reference, round(p_amount,2)) returning id into operation_id;
  return operation_id;
end $$;

create or replace function public.finish_financial_operation(p_id uuid, p_actor uuid, p_state text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_state is null or p_state not in ('completed','needs_review') then raise exception 'Invalid operation state'; end if;
  update public.financial_operations set state = p_state, updated_at = now()
    where id = p_id and actor_id = p_actor and state = 'pending';
  if not found then raise exception 'Financial operation cannot be updated'; end if;
end $$;
revoke all on function public.begin_financial_operation(uuid,text,text,text,numeric) from public, anon, authenticated;
revoke all on function public.finish_financial_operation(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.begin_financial_operation(uuid,text,text,text,numeric) to service_role;
grant execute on function public.finish_financial_operation(uuid,uuid,text) to service_role;

-- Prevent manual balance changes racing with a supplier payment.
create or replace function public.platform_adjust_wallet(p_agency_id uuid, p_amount numeric, p_reason text, p_created_by uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2) = 0
    or p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'Invalid wallet adjustment'; end if;
  if not exists(select 1 from public.profiles where id = p_created_by and role = 'platform_admin' and active) then
    raise exception 'Only an active platform administrator can adjust a wallet'; end if;
  perform pg_advisory_xact_lock(hashtextextended('financial:' || p_agency_id::text, 0));
  if exists(select 1 from public.financial_operations where agency_id = p_agency_id and state in ('pending','needs_review')) then
    raise exception 'Resolve the pending financial operation before adjusting this wallet'; end if;
  update public.wallets set balance_cny = balance_cny + round(p_amount,2), updated_at = now() where agency_id = p_agency_id;
  if not found then raise exception 'Wallet not found'; end if;
  insert into public.wallet_transactions(agency_id,entry_type,amount_cny,reason,created_by)
    values(p_agency_id,'adjustment',round(p_amount,2),p_reason,p_created_by);
end $$;
revoke all on function public.platform_adjust_wallet(uuid,numeric,text,uuid) from public, anon, authenticated;
grant execute on function public.platform_adjust_wallet(uuid,numeric,text,uuid) to service_role;

commit;
notify pgrst, 'reload schema';
