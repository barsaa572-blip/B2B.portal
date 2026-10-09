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

-- Run after security-hardening.sql. Existing financial history is unchanged.
begin;
alter table public.bookings add column if not exists retail_price jsonb;
alter table public.wallet_transactions add column if not exists amount_mnt numeric(18,0);
alter table public.wallet_transactions add column if not exists fx_rate_mnt numeric(18,6);

create table if not exists public.retail_pricing (
  booking_id uuid not null references public.bookings(id),
  action text not null check(action in ('issue','change','refund')),
  reference text not null,
  snapshot jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','settled','awaiting_settlement')),
  actor_id uuid not null references public.profiles(id),
  settlement_reference text,
  settled_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(booking_id, action, reference)
);
alter table public.retail_pricing enable row level security;
revoke all on public.retail_pricing from public, anon, authenticated;
grant all on public.retail_pricing to service_role;
-- Bookings contain supplier fare/quote metadata. Agency access goes through
-- the authenticated backend serializer, not a direct raw PostgREST SELECT.
revoke select on public.bookings from anon, authenticated;

create or replace function public.store_retail_price(p_pnr text, p_action text, p_reference text, p_actor uuid, p_snapshot jsonb, p_public jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings; rate numeric; mnt numeric; wallet numeric; supplier numeric;
begin
  select * into b from public.bookings where pnr = p_pnr for update;
  if not found then raise exception 'Booking not found'; end if;
  if not exists(select 1 from public.agencies where id=b.agency_id and active) then raise exception 'Agency is inactive'; end if;
  if not exists(select 1 from public.profiles p where p.id = p_actor and p.active
    and (p.role = 'platform_admin' or (p.agency_id = b.agency_id and
      (p.role = 'office_manager' or b.created_by = p.id)))) then raise exception 'Booking access denied'; end if;
  if p_action not in ('issue','change','refund') or p_reference is null or length(p_reference) not between 1 and 500
    or (p_action = 'issue' and b.status <> 'Reserved') or (p_action <> 'issue' and b.status <> 'Ticketed') then raise exception 'Invalid pricing operation'; end if;
  rate := (p_snapshot->>'rateMnt')::numeric;
  mnt := (p_snapshot->>'amountMnt')::numeric;
  wallet := (p_snapshot->>'walletCny')::numeric;
  supplier := (p_snapshot->>'supplierCny')::numeric;
  if p_snapshot->>'version' is distinct from '1' or rate is null or rate <= 0 or rate > 1000000
    or mnt is null or mnt < 0 or mnt > 100000000000000 or mod(mnt,100) <> 0
    or supplier is null or supplier < 0 or supplier > 10000000000
    or wallet is distinct from round(mnt/rate,2)
    or p_snapshot->>'direction' is distinct from (case when p_action='refund' then 'refund' else 'charge' end)
    or p_public is distinct from (p_snapshot - array['supplierCny','marginCny','adjustmentMnt','conversionResidualMnt']) then
    raise exception 'Invalid retail settlement quote';
  end if;
  if exists(select 1 from public.financial_operations where booking_id=b.id and state in ('pending','needs_review')) then raise exception 'Resolve the current financial operation first'; end if;
  if exists(select 1 from public.retail_pricing where booking_id=b.id and action=p_action and reference=p_reference and state<>'prepared') then raise exception 'Pricing is already settled'; end if;
  insert into public.retail_pricing(booking_id,action,reference,snapshot,actor_id)
    values(b.id,p_action,p_reference,p_snapshot,p_actor)
    on conflict(booking_id,action,reference) do update set snapshot=excluded.snapshot,actor_id=excluded.actor_id,updated_at=now();
  if p_action='issue' then update public.bookings set retail_price=p_public,total_cny=supplier where id=b.id; end if;
end $$;

-- Preserve the audited authorization/idempotency routines and compose the
-- rounded debit inside the SAME database transaction, never a second charge.
do $$ begin
  if to_regprocedure('public.begin_financial_operation_base(uuid,text,text,text,numeric)') is null then
    alter function public.begin_financial_operation(uuid,text,text,text,numeric) rename to begin_financial_operation_base;
  end if;
  if to_regprocedure('public.issue_booking_from_wallet_base(uuid,uuid)') is null then
    alter function public.issue_booking_from_wallet(uuid,uuid) rename to issue_booking_from_wallet_base;
  end if;
  if to_regprocedure('public.record_change_payment_base(text,text,numeric,uuid,boolean)') is null then
    alter function public.record_change_payment(text,text,numeric,uuid,boolean) rename to record_change_payment_base;
  end if;
end $$;

create or replace function public.begin_financial_operation(p_actor uuid,p_pnr text,p_action text,p_reference text,p_amount numeric,p_expected_retail jsonb default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare operation uuid; q public.retail_pricing; b public.bookings; available numeric;
begin
  operation := public.begin_financial_operation_base(p_actor,p_pnr,p_action,p_reference,p_amount);
  select * into b from public.bookings where pnr=p_pnr;
  select * into q from public.retail_pricing where booking_id=b.id and action=p_action and reference=p_reference for update;
  if found then
    if p_expected_retail is distinct from (q.snapshot - array['supplierCny','marginCny','adjustmentMnt','conversionResidualMnt']) then raise exception 'The confirmed retail price changed'; end if;
    if q.state <> 'prepared' or q.updated_at < now()-interval '15 minutes'
      or (p_action<>'refund' and (q.snapshot->>'supplierCny')::numeric <> round(p_amount,2)) then raise exception 'Retail price expired or changed; review the price again'; end if;
    select balance_cny into available from public.wallets where agency_id=b.agency_id for update;
    if p_action<>'refund' and available < (q.snapshot->>'walletCny')::numeric then raise exception 'Insufficient wallet balance'; end if;
    update public.financial_operations set amount_cny=(q.snapshot->>'walletCny')::numeric where id=operation;
  elsif p_expected_retail is not null or (b.retail_price is not null and p_action='issue') then
    raise exception 'Retail price is missing. No supplier payment was sent';
  end if;
  return operation;
end $$;

create or replace function public.apply_retail_debit(p_booking_id uuid,p_action text,p_reference text,p_actor uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare b public.bookings; q public.retail_pricing; extra numeric;
begin
  select * into b from public.bookings where id=p_booking_id for update;
  select * into q from public.retail_pricing where booking_id=b.id and action=p_action and reference=p_reference for update;
  if not found or q.state='settled' then return; end if;
  if q.state <> 'prepared' then raise exception 'Invalid settlement state'; end if;
  if not exists(select 1 from public.financial_operations where booking_id=b.id and action=p_action and reference=p_reference and actor_id=p_actor and state='pending') then raise exception 'Verified payment operation required'; end if;
  extra := (q.snapshot->>'walletCny')::numeric - (q.snapshot->>'supplierCny')::numeric;
  if extra<0 then raise exception 'Invalid retail debit'; end if;
  update public.wallets set balance_cny=balance_cny-extra,updated_at=now() where agency_id=b.agency_id;
  update public.wallet_transactions set amount_cny=-(q.snapshot->>'walletCny')::numeric,
    amount_mnt=-(q.snapshot->>'amountMnt')::numeric,fx_rate_mnt=(q.snapshot->>'rateMnt')::numeric
    where agency_id=b.agency_id and reason=p_reason and entry_type='debit';
  if not found then raise exception 'Original payment ledger entry missing'; end if;
  update public.retail_pricing set state='settled',updated_at=now() where booking_id=b.id and action=p_action and reference=p_reference;
end $$;

create or replace function public.issue_booking_from_wallet(p_booking_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; b public.bookings; q public.retail_pricing;
begin
  result := public.issue_booking_from_wallet_base(p_booking_id,p_actor_id);
  select * into b from public.bookings where id=p_booking_id;
  perform public.apply_retail_debit(b.id,'issue',b.pnr,p_actor_id,'Ticket issue: '||b.pnr);
  select * into q from public.retail_pricing where booking_id=b.id and action='issue' and reference=b.pnr;
  if found then result := result || jsonb_build_object('debitedCny',(q.snapshot->>'walletCny')::numeric,'balanceCny',(select balance_cny from public.wallets where agency_id=b.agency_id)); end if;
  return result;
end $$;

create or replace function public.record_change_payment(p_pnr text,p_app_id text,p_amount numeric,p_actor uuid,p_check_only boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.bookings; q public.retail_pricing; result jsonb;
begin
  select * into b from public.bookings where pnr=p_pnr;
  if not exists(select 1 from public.profiles p where p.id=p_actor and p.active
    and (p.role='platform_admin' or (p.agency_id=b.agency_id and (p.role='office_manager' or b.created_by=p.id)))) then raise exception 'Booking access denied'; end if;
  select * into q from public.retail_pricing where booking_id=b.id and action='change' and reference=p_app_id;
  if found and q.state='settled' then
    if (q.snapshot->>'supplierCny')::numeric <> round(p_amount,2) then raise exception 'Change amount mismatch'; end if;
    return jsonb_build_object('recorded',true);
  end if;
  result := public.record_change_payment_base(p_pnr,p_app_id,p_amount,p_actor,p_check_only);
  if not p_check_only then perform public.apply_retail_debit(b.id,'change',p_app_id,p_actor,'Change fee payment: '||p_pnr||' | Spring application '||p_app_id); end if;
  return result;
end $$;

-- A successful refund request is NOT a completed supplier settlement.
create or replace function public.retail_operation_completed()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.state='completed' and old.state='pending' then
    update public.retail_pricing set state=case when new.action='refund' then 'awaiting_settlement' else 'settled' end,updated_at=now()
      where booking_id=new.booking_id and action=new.action and reference=new.reference and state='prepared'
      and (new.action='refund' or (new.action='change' and (snapshot->>'walletCny')::numeric=0));
  end if;
  return new;
end $$;
drop trigger if exists retail_operation_completed on public.financial_operations;
create trigger retail_operation_completed after update of state on public.financial_operations
  for each row execute function public.retail_operation_completed();

-- Finance must verify receipt from Spring before explicitly calling this RPC.
-- Matching the supplier amount and a unique booking/reference prevents duplicate credits.
create or replace function public.settle_retail_refund(p_booking_id uuid,p_reference text,p_actor uuid,p_supplier_received numeric,p_settlement_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.bookings; q public.retail_pricing;
begin
  if not exists(select 1 from public.profiles where id=p_actor and active and role='platform_admin') then raise exception 'Administrator access required'; end if;
  if p_settlement_reference is null or length(trim(p_settlement_reference)) not between 5 and 200 then raise exception 'Verified supplier settlement reference required'; end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  select * into q from public.retail_pricing where booking_id=b.id and action='refund' and reference=p_reference for update;
  if not found or p_supplier_received is distinct from (q.snapshot->>'supplierCny')::numeric then raise exception 'Supplier refund amount differs; reconcile before crediting'; end if;
  if q.state='settled' then return jsonb_build_object('alreadySettled',true); end if;
  if q.state<>'awaiting_settlement' or not exists(select 1 from public.financial_operations where booking_id=b.id and action='refund' and reference=p_reference and state='completed') then raise exception 'Refund request has not completed'; end if;
  perform 1 from public.wallets where agency_id=b.agency_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  update public.wallets set balance_cny=balance_cny+(q.snapshot->>'walletCny')::numeric,updated_at=now() where agency_id=b.agency_id;
  if (q.snapshot->>'walletCny')::numeric > 0 then
  insert into public.wallet_transactions(agency_id,entry_type,amount_cny,amount_mnt,fx_rate_mnt,reason,created_by)
    values(b.agency_id,'credit',(q.snapshot->>'walletCny')::numeric,(q.snapshot->>'amountMnt')::numeric,(q.snapshot->>'rateMnt')::numeric,'Refund settled: '||b.pnr||' | '||p_reference,p_actor);
  end if;
  update public.retail_pricing set state='settled',settlement_reference=trim(p_settlement_reference),settled_by=p_actor,updated_at=now()
    where booking_id=b.id and action='refund' and reference=p_reference;
  update public.bookings set itinerary=jsonb_set(itinerary,'{refundHistory}',
    (select coalesce(jsonb_agg(case when entry->'quote'->>'settlementKey'=p_reference then entry || jsonb_build_object('status','settled','settledAt',now()) else entry end),'[]'::jsonb)
      from jsonb_array_elements(coalesce(itinerary->'refundHistory','[]'::jsonb)) entry)) where id=b.id;
  return jsonb_build_object('creditedCny',(q.snapshot->>'walletCny')::numeric,'amountMnt',(q.snapshot->>'amountMnt')::numeric);
end $$;

revoke all on function public.retail_operation_completed() from public,anon,authenticated;
revoke all on function public.settle_retail_refund(uuid,text,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.settle_retail_refund(uuid,text,uuid,numeric,text) to service_role;

revoke all on function public.store_retail_price(text,text,text,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.apply_retail_debit(uuid,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.begin_financial_operation(uuid,text,text,text,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.issue_booking_from_wallet(uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_change_payment(text,text,numeric,uuid,boolean) from public,anon,authenticated;
grant execute on function public.store_retail_price(text,text,text,uuid,jsonb,jsonb) to service_role;
grant execute on function public.apply_retail_debit(uuid,text,text,uuid,text) to service_role;
grant execute on function public.begin_financial_operation(uuid,text,text,text,numeric,jsonb) to service_role;
grant execute on function public.issue_booking_from_wallet(uuid,uuid) to service_role;
grant execute on function public.record_change_payment(text,text,numeric,uuid,boolean) to service_role;
create or replace function public.retail_pricing_ready() returns boolean language sql security definer set search_path=public as $$
  select to_regprocedure('public.begin_financial_operation(uuid,text,text,text,numeric,jsonb)') is not null
    and to_regprocedure('public.settle_retail_refund(uuid,text,uuid,numeric,text)') is not null;
$$;
revoke all on function public.retail_pricing_ready() from public,anon,authenticated;
grant execute on function public.retail_pricing_ready() to service_role;
commit;
notify pgrst, 'reload schema';
