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

-- Additive migration after retail-rounding.sql. Does not activate the model,
-- reprice existing invoices, erase history or change supplier payment amounts.
begin;
create table if not exists public.portal_pricing_config (
  id boolean primary key default true check(id),
  model text not null default 'legacy' check(model in ('legacy','cny-funding-v1')),
  activated_at timestamptz
);
insert into public.portal_pricing_config(id) values(true) on conflict do nothing;
alter table public.portal_pricing_config enable row level security;
revoke all on public.portal_pricing_config from public,anon,authenticated;
grant all on public.portal_pricing_config to service_role;
alter table public.topup_requests add column if not exists pricing_model text not null default 'legacy';
alter table public.topup_requests add column if not exists funding_quote jsonb;
-- Widen precision without repricing or changing any historical invoice value.
alter table public.topup_requests alter column effective_cny_mnt_rate type numeric(18,6);
alter table public.topup_requests alter column official_cny_mnt_rate type numeric(18,6);
create table if not exists public.cny_funding_receipts (
  topup_id uuid primary key references public.topup_requests(id),
  bank_reference text not null unique,
  received_cny numeric(14,2) not null check(received_cny>0),
  verified_by uuid not null references public.profiles(id),
  verified_at timestamptz not null default now()
);
alter table public.cny_funding_receipts enable row level security;
revoke all on public.cny_funding_receipts from public,anon,authenticated;
revoke all on public.cny_funding_receipts from service_role;
grant select,insert on public.cny_funding_receipts to service_role;

create or replace function public.cny_funding_ready() returns boolean
language sql security definer set search_path=public as $$
 select exists(select 1 from public.portal_pricing_config where id and model='cny-funding-v1')
   and to_regprocedure('public.approve_cny_topup(uuid,uuid,text,numeric)') is not null
   and position('wallet is distinct from supplier' in pg_get_functiondef('public.store_retail_price(text,text,text,uuid,jsonb,jsonb)'::regprocedure))>0
   and (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.cny_funding_receipts'::regclass,'public.portal_pricing_config'::regclass))
   and not exists(select 1 from (values('anon'),('authenticated')) as roles(name)
     where has_table_privilege(roles.name,'public.cny_funding_receipts','SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege(roles.name,'public.portal_pricing_config','SELECT,INSERT,UPDATE,DELETE')
        or has_function_privilege(roles.name,'public.activate_cny_funding()','EXECUTE')
        or has_function_privilege(roles.name,'public.approve_cny_topup(uuid,uuid,text,numeric)','EXECUTE'))
   and not has_function_privilege('service_role','public.approve_topup_request_legacy(uuid,uuid)','EXECUTE');
$$;
create or replace function public.activate_cny_funding() returns void
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.portal_pricing_config where id for update;
 if public.cny_funding_ready() then return; end if;
 -- User reports no paid funds. Refuse rather than reset or double-charge them.
 lock table public.wallets, public.topup_requests, public.financial_operations in share row exclusive mode;
 if exists(select 1 from public.wallets where balance_cny<>0)
   or exists(select 1 from public.topup_requests where status='pending')
   or exists(select 1 from public.financial_operations where state in ('pending','needs_review')) then
   raise exception 'Review existing balances, pending invoices and financial operations before activation';
 end if;
 update public.portal_pricing_config set model='cny-funding-v1',activated_at=now() where id;
end $$;

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
  if public.cny_funding_ready() is distinct from (p_snapshot->>'version'='3') then raise exception 'Pricing model changed; refresh the price'; end if;
  rate := (p_snapshot->>'rateMnt')::numeric;
  mnt := (p_snapshot->>'amountMnt')::numeric;
  wallet := (p_snapshot->>'walletCny')::numeric;
  supplier := (p_snapshot->>'supplierCny')::numeric;
  if (p_snapshot->>'version' not in ('1','3') or p_snapshot->>'version' is null) or rate is null or rate <= 0 or rate > 1000000
    or mnt is null or mnt < 0 or mnt > 100000000000000 or mod(mnt,case when p_snapshot->>'version'='3' then 10 else 100 end) <> 0
    or supplier is null or supplier < 0 or supplier > 10000000000
    or (case when p_snapshot->>'version'='3' then wallet is distinct from supplier else wallet is distinct from round(mnt/rate,2) end)
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


create or replace function public.validate_cny_funding_quote() returns trigger
language plpgsql security definer set search_path=public as $$
declare q jsonb; rate numeric; principal numeric; fee numeric; correspondent numeric; bank numeric; tariff numeric;
begin
 if tg_op='UPDATE' then
   if new.pricing_model is distinct from old.pricing_model then raise exception 'Saved invoice model is immutable'; end if;
   if old.pricing_model='cny-funding-v1' and
    (new.funding_quote is distinct from old.funding_quote or new.amount_cny is distinct from old.amount_cny
     or new.amount_mnt is distinct from old.amount_mnt or new.total_mnt is distinct from old.total_mnt
     or new.service_fee_mnt is distinct from old.service_fee_mnt or new.correspondent_fee_mnt is distinct from old.correspondent_fee_mnt
     or new.bank_transfer_fee_mnt is distinct from old.bank_transfer_fee_mnt or new.agency_id<>old.agency_id
     or new.requested_by<>old.requested_by or new.pricing_model<>old.pricing_model
     or new.effective_cny_mnt_rate is distinct from old.effective_cny_mnt_rate
     or new.rate_date is distinct from old.rate_date or new.invoice_number is distinct from old.invoice_number) then
     raise exception 'Saved CNY funding invoice is immutable'; end if;
   return new;
 end if;
 if new.pricing_model='legacy' then
   if public.cny_funding_ready() then raise exception 'Legacy funding is disabled'; end if;
   return new;
 end if;
 q:=new.funding_quote;
 if new.pricing_model<>'cny-funding-v1' or not public.cny_funding_ready()
   or q->>'model' is distinct from 'cny-funding-v1' or q->>'version' is distinct from '1'
   or q->>'transferCurrency' is distinct from 'CNY' then raise exception 'Invalid CNY funding model'; end if;
 principal:=(q->>'principalCny')::numeric; rate:=(q->>'rateMnt')::numeric;
 fee:=(q->>'serviceFeeCny')::numeric; correspondent:=(q->>'correspondentFeeCny')::numeric;
 bank:=(q->>'bankFeeCny')::numeric;
 tariff:=case when principal<=50000 then 5000 when principal<=100000 then 10000 else 20000 end;
 if principal is null or principal<=0 or principal>2000000 or principal<>round(principal,2)
   or rate is null or rate<=0 or rate>1000000
   or fee is distinct from round(principal*.03,2)
   or correspondent is distinct from (case when principal<=100000 then 50 else 150 end)
   or bank is distinct from ceil(tariff/rate*100)/100
   or q->>'serviceFeePercent' is distinct from '3'
   or q->'account'->>'iban' is distinct from 'MN940015001605336659'
   or q->'account'->>'currency' is distinct from 'CNY'
   or (q->>'bankTariffMnt')::numeric is distinct from tariff
   or q->>'rateDate' is distinct from new.rate_date::text
   or new.rate_date > (now() at time zone 'Asia/Ulaanbaatar')::date
   or new.rate_date < (now() at time zone 'Asia/Ulaanbaatar')::date-4
   or new.amount_cny is distinct from principal
   or (q->>'totalCny')::numeric is distinct from principal+fee+correspondent+bank
   or new.amount_mnt is distinct from ceil(principal*rate/10)*10
   or new.service_fee_mnt is distinct from ceil(fee*rate/10)*10
   or new.correspondent_fee_mnt is distinct from ceil(correspondent*rate/10)*10
   or new.bank_transfer_fee_mnt is distinct from ceil(bank*rate/10)*10
   or new.total_mnt is distinct from new.amount_mnt+new.service_fee_mnt+new.correspondent_fee_mnt+new.bank_transfer_fee_mnt
   or (q->>'totalMnt')::numeric is distinct from new.total_mnt
   or new.effective_cny_mnt_rate is distinct from rate
   or new.status is distinct from 'pending' then raise exception 'Invalid CNY funding calculation'; end if;
 if not exists(select 1 from public.profiles where id=new.requested_by and active and agency_id=new.agency_id
   and role in ('agent','office_manager','platform_admin'))
   or not exists(select 1 from public.agencies where id=new.agency_id and active) then raise exception 'Funding access denied'; end if;
 return new;
end $$;
drop trigger if exists validate_cny_funding_quote on public.topup_requests;
create trigger validate_cny_funding_quote before insert or update on public.topup_requests
for each row execute function public.validate_cny_funding_quote();

-- Preserve old approval authorization but disallow its use for CNY invoices.
do $$ begin
 if to_regprocedure('public.approve_topup_request_legacy(uuid,uuid)') is null then
  alter function public.approve_topup_request(uuid,uuid) rename to approve_topup_request_legacy;
 end if;
end $$;
create or replace function public.approve_topup_request(p_topup_id uuid,p_approved_by uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.topup_requests where id=p_topup_id and pricing_model='cny-funding-v1') then
  raise exception 'Verified CNY receipt required';
 end if;
 perform public.approve_topup_request_legacy(p_topup_id,p_approved_by);
end $$;
create or replace function public.approve_cny_topup(p_topup_id uuid,p_actor uuid,p_bank_reference text,p_received_cny numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.topup_requests; receipt public.cny_funding_receipts; ref text;
begin
 if not public.cny_funding_ready() or not exists(select 1 from public.profiles where id=p_actor and active and role='platform_admin') then
  raise exception 'Active administrator and CNY funding migration required'; end if;
 ref:=upper(trim(p_bank_reference));
 if ref is null or length(ref) not between 5 and 200 or p_received_cny is null
   or p_received_cny::text in ('NaN','Infinity','-Infinity') or p_received_cny<=0 or p_received_cny<>round(p_received_cny,2) then
   raise exception 'Verified bank reference and exact net CNY receipt required'; end if;
 select * into r from public.topup_requests where id=p_topup_id;
 if not found then raise exception 'Invoice not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('financial:'||r.agency_id::text,0));
 select * into r from public.topup_requests where id=p_topup_id for update;
 if r.pricing_model<>'cny-funding-v1' or p_received_cny is distinct from (r.funding_quote->>'totalCny')::numeric then
  raise exception 'Receipt differs from the invoice; reconcile before credit'; end if;
 select * into receipt from public.cny_funding_receipts where topup_id=r.id;
 if found then
  if receipt.bank_reference<>ref or receipt.received_cny<>p_received_cny then raise exception 'Receipt has already been recorded differently'; end if;
  return jsonb_build_object('alreadyApproved',true);
 end if;
 if r.status<>'pending' or not exists(select 1 from public.agencies where id=r.agency_id and active)
   or exists(select 1 from public.financial_operations where agency_id=r.agency_id and state in ('pending','needs_review')) then
  raise exception 'Invoice/agency is unavailable or has an unresolved payment'; end if;
 insert into public.cny_funding_receipts(topup_id,bank_reference,received_cny,verified_by) values(r.id,ref,p_received_cny,p_actor);
 update public.topup_requests set status='approved',approved_at=now(),approved_by=p_actor where id=r.id;
 insert into public.wallets(agency_id,balance_cny,updated_at) values(r.agency_id,r.amount_cny,now())
  on conflict(agency_id) do update set balance_cny=public.wallets.balance_cny+excluded.balance_cny,updated_at=now();
 insert into public.wallet_transactions(agency_id,entry_type,amount_cny,amount_mnt,fx_rate_mnt,reason,created_by)
  values(r.agency_id,'credit',r.amount_cny,r.amount_mnt,r.effective_cny_mnt_rate,'Top-up approved: '||r.invoice_number,p_actor);
 return jsonb_build_object('creditedCny',r.amount_cny,'serviceFeeCny',(r.funding_quote->>'serviceFeeCny')::numeric);
end $$;

revoke all on function public.cny_funding_ready(), public.activate_cny_funding(),
 public.validate_cny_funding_quote(), public.approve_cny_topup(uuid,uuid,text,numeric),
 public.approve_topup_request(uuid,uuid),public.approve_topup_request_legacy(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.approve_topup_request_legacy(uuid,uuid) from service_role;
grant execute on function public.cny_funding_ready(), public.activate_cny_funding(),
 public.approve_cny_topup(uuid,uuid,text,numeric), public.approve_topup_request(uuid,uuid) to service_role;
commit;
notify pgrst,'reload schema';
