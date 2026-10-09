-- Schema-only baseline captured from production.nexahub. No customer rows or credentials.
-- Existing projects are verified, not rebuilt; an empty project gets the exact captured schema.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = public, pg_catalog;
set local check_function_bodies = off;
do $baseline$
begin
  if exists(select 1 from pg_tables where schemaname = 'public') then
    if (with snapshot as (SELECT jsonb_build_object(
'enums', (SELECT coalesce(jsonb_agg(x ORDER BY name COLLATE "C"),'[]') FROM (SELECT t.typname AS name,jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname) x),
'tables', (SELECT jsonb_agg(x ORDER BY name COLLATE "C") FROM (SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,pg_get_userbyid(c.relowner) AS owner,(select array_agg(x::text order by x::text)::text from unnest(c.relacl) x) AS acl,(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') x),
'constraints',(SELECT jsonb_agg(x ORDER BY table_name COLLATE "C",name COLLATE "C") FROM (SELECT c.conrelid::regclass::text AS table_name,c.conname AS name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c WHERE c.connamespace='public'::regnamespace AND c.conrelid<>0) x),
'indexes',(SELECT jsonb_agg(x ORDER BY name COLLATE "C") FROM (SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_constraint con WHERE con.conindid=i.indexrelid)) x),
'functions',(SELECT jsonb_agg(x ORDER BY signature COLLATE "C") FROM (SELECT p.oid::regprocedure::text AS signature,replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') AS definition,pg_get_userbyid(p.proowner) AS owner,(select array_agg(x::text order by x::text)::text from unnest(p.proacl) x) AS acl,obj_description(p.oid,'pg_proc') AS comment FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') x),
'policies',(SELECT jsonb_agg(x ORDER BY tablename COLLATE "C",policyname COLLATE "C") FROM (SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public') x),
'triggers',(SELECT coalesce(jsonb_agg(x ORDER BY name COLLATE "C"),'[]') FROM (SELECT t.tgname AS name,pg_get_triggerdef(t.oid) AS definition,t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND (n.nspname='public' OR p.pronamespace='public'::regnamespace)) x),
'other_relations',(SELECT coalesce(jsonb_agg(c.relname),'[]') FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('v','m','S','f','p'))
) AS catalog) select md5(catalog::text) AS fingerprint from snapshot) is distinct from '1c340054e5e94401529c4a407c1359f9' then
      raise exception 'BASELINE_DRIFT: current schema differs from the reviewed production snapshot';
    end if;
  else
    if exists(select 1 from auth.users) then
      raise exception 'BASELINE_REQUIRES_EMPTY_PROJECT: authentication users already exist';
    end if;
    execute $captured_schema$
create type public."user_role" as enum ('agent', 'office_manager', 'platform_admin');

create type public."wallet_entry_type" as enum ('credit', 'debit', 'adjustment');

create table public."agencies" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "registration_number" text,
  "email" text,
  "phone" text,
  "address" text
);

create table public."bookings" (
  "id" uuid default gen_random_uuid() not null,
  "pnr" text,
  "agency_id" uuid not null,
  "branch_id" uuid,
  "created_by" uuid not null,
  "status" text default 'draft'::text not null,
  "total_cny" numeric(14,2) not null,
  "itinerary" jsonb not null,
  "passengers" jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "supplier_status" jsonb default '{}'::jsonb not null,
  "supplier_status_next_check_at" timestamp with time zone default now(),
  "supplier_status_lease_until" timestamp with time zone,
  "supplier_status_lease_id" uuid,
  "retail_price" jsonb
);

create table public."branches" (
  "id" uuid default gen_random_uuid() not null,
  "agency_id" uuid not null,
  "name" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."cny_funding_receipts" (
  "topup_id" uuid not null,
  "bank_reference" text not null,
  "received_cny" numeric(14,2) not null,
  "verified_by" uuid not null,
  "verified_at" timestamp with time zone default now() not null
);

create table public."financial_operations" (
  "id" uuid default gen_random_uuid() not null,
  "agency_id" uuid not null,
  "booking_id" uuid not null,
  "actor_id" uuid not null,
  "action" text not null,
  "reference" text not null,
  "amount_cny" numeric(14,2) not null,
  "state" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."password_security" (
  "user_id" uuid not null,
  "password_changed_at" timestamp with time zone not null,
  "revision" uuid default gen_random_uuid() not null
);

create table public."portal_pricing_config" (
  "id" boolean default true not null,
  "model" text default 'legacy'::text not null,
  "activated_at" timestamp with time zone
);

create table public."profiles" (
  "id" uuid not null,
  "agency_id" uuid,
  "branch_id" uuid,
  "role" user_role default 'agent'::user_role not null,
  "full_name" text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "email" text,
  "phone" text
);

create table public."retail_pricing" (
  "booking_id" uuid not null,
  "action" text not null,
  "reference" text not null,
  "snapshot" jsonb not null,
  "state" text default 'prepared'::text not null,
  "actor_id" uuid not null,
  "settlement_reference" text,
  "settled_by" uuid,
  "updated_at" timestamp with time zone default now() not null
);

create table public."topup_requests" (
  "id" uuid default gen_random_uuid() not null,
  "invoice_number" text not null,
  "agency_id" uuid not null,
  "requested_by" uuid not null,
  "amount_cny" numeric(14,2) not null,
  "payment_reference" text not null,
  "note" text,
  "status" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "approved_at" timestamp with time zone,
  "approved_by" uuid,
  "amount_mnt" numeric(14,0),
  "official_cny_mnt_rate" numeric(18,6),
  "markup_mnt" numeric(14,2) default 4 not null,
  "effective_cny_mnt_rate" numeric(18,6),
  "rate_date" date,
  "service_fee_mnt" numeric(14,0) default 0 not null,
  "total_mnt" numeric(14,0),
  "expires_at" timestamp with time zone default (((date_trunc('day'::text, (now() AT TIME ZONE 'Asia/Ulaanbaatar'::text)) + '1 day'::interval) - '00:00:01'::interval) AT TIME ZONE 'Asia/Ulaanbaatar'::text) not null,
  "correspondent_fee_cny" numeric(14,2) default 0 not null,
  "correspondent_fee_mnt" numeric(14,0) default 0 not null,
  "khaan_transfer_fee_mnt" numeric(14,0) default 0 not null,
  "bank_transfer_fee_mnt" numeric(14,0) default 0 not null,
  "bank_name" text,
  "pricing_model" text default 'legacy'::text not null,
  "funding_quote" jsonb
);

create table public."wallet_transactions" (
  "id" uuid default gen_random_uuid() not null,
  "agency_id" uuid not null,
  "entry_type" wallet_entry_type not null,
  "amount_cny" numeric(14,2) not null,
  "booking_id" uuid,
  "reason" text not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "amount_mnt" numeric(18,0),
  "fx_rate_mnt" numeric(18,6)
);

create table public."wallets" (
  "agency_id" uuid not null,
  "balance_cny" numeric(14,2) default 0 not null,
  "updated_at" timestamp with time zone default now() not null
);

alter table public."agencies" add constraint "agencies_name_key" UNIQUE (name);

alter table public."agencies" add constraint "agencies_pkey" PRIMARY KEY (id);

alter table public."bookings" add constraint "bookings_pkey" PRIMARY KEY (id);

alter table public."bookings" add constraint "bookings_pnr_key" UNIQUE (pnr);

alter table public."bookings" add constraint "bookings_total_cny_check" CHECK ((total_cny >= (0)::numeric));

alter table public."branches" add constraint "branches_agency_id_name_key" UNIQUE (agency_id, name);

alter table public."branches" add constraint "branches_pkey" PRIMARY KEY (id);

alter table public."cny_funding_receipts" add constraint "cny_funding_receipts_bank_reference_key" UNIQUE (bank_reference);

alter table public."cny_funding_receipts" add constraint "cny_funding_receipts_pkey" PRIMARY KEY (topup_id);

alter table public."cny_funding_receipts" add constraint "cny_funding_receipts_received_cny_check" CHECK ((received_cny > (0)::numeric));

alter table public."financial_operations" add constraint "financial_operations_action_check" CHECK ((action = ANY (ARRAY['issue'::text, 'change'::text, 'refund'::text])));

alter table public."financial_operations" add constraint "financial_operations_amount_cny_check" CHECK ((amount_cny >= (0)::numeric));

alter table public."financial_operations" add constraint "financial_operations_pkey" PRIMARY KEY (id);

alter table public."financial_operations" add constraint "financial_operations_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'needs_review'::text, 'completed'::text, 'released'::text])));

alter table public."password_security" add constraint "password_security_pkey" PRIMARY KEY (user_id);

alter table public."portal_pricing_config" add constraint "portal_pricing_config_id_check" CHECK (id);

alter table public."portal_pricing_config" add constraint "portal_pricing_config_model_check" CHECK ((model = ANY (ARRAY['legacy'::text, 'cny-funding-v1'::text])));

alter table public."portal_pricing_config" add constraint "portal_pricing_config_pkey" PRIMARY KEY (id);

alter table public."profiles" add constraint "profiles_check" CHECK (((role = 'platform_admin'::user_role) OR (agency_id IS NOT NULL)));

alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);

alter table public."retail_pricing" add constraint "retail_pricing_action_check" CHECK ((action = ANY (ARRAY['issue'::text, 'change'::text, 'refund'::text])));

alter table public."retail_pricing" add constraint "retail_pricing_pkey" PRIMARY KEY (booking_id, action, reference);

alter table public."retail_pricing" add constraint "retail_pricing_state_check" CHECK ((state = ANY (ARRAY['prepared'::text, 'settled'::text, 'awaiting_settlement'::text])));

alter table public."topup_requests" add constraint "topup_requests_amount_cny_check" CHECK ((amount_cny > (0)::numeric));

alter table public."topup_requests" add constraint "topup_requests_invoice_number_key" UNIQUE (invoice_number);

alter table public."topup_requests" add constraint "topup_requests_pkey" PRIMARY KEY (id);

alter table public."topup_requests" add constraint "topup_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));

alter table public."wallet_transactions" add constraint "wallet_transactions_amount_cny_check" CHECK ((amount_cny <> (0)::numeric));

alter table public."wallet_transactions" add constraint "wallet_transactions_pkey" PRIMARY KEY (id);

alter table public."wallets" add constraint "wallets_pkey" PRIMARY KEY (agency_id);

alter table public."bookings" add constraint "bookings_agency_id_fkey" FOREIGN KEY (agency_id) REFERENCES agencies(id);

alter table public."bookings" add constraint "bookings_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id);

alter table public."bookings" add constraint "bookings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);

alter table public."branches" add constraint "branches_agency_id_fkey" FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE;

alter table public."cny_funding_receipts" add constraint "cny_funding_receipts_topup_id_fkey" FOREIGN KEY (topup_id) REFERENCES topup_requests(id);

alter table public."cny_funding_receipts" add constraint "cny_funding_receipts_verified_by_fkey" FOREIGN KEY (verified_by) REFERENCES profiles(id);

alter table public."financial_operations" add constraint "financial_operations_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES profiles(id);

alter table public."financial_operations" add constraint "financial_operations_agency_id_fkey" FOREIGN KEY (agency_id) REFERENCES agencies(id);

alter table public."financial_operations" add constraint "financial_operations_booking_id_fkey" FOREIGN KEY (booking_id) REFERENCES bookings(id);

alter table public."password_security" add constraint "password_security_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."profiles" add constraint "profiles_agency_id_fkey" FOREIGN KEY (agency_id) REFERENCES agencies(id);

alter table public."profiles" add constraint "profiles_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES branches(id);

alter table public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."retail_pricing" add constraint "retail_pricing_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES profiles(id);

alter table public."retail_pricing" add constraint "retail_pricing_booking_id_fkey" FOREIGN KEY (booking_id) REFERENCES bookings(id);

alter table public."retail_pricing" add constraint "retail_pricing_settled_by_fkey" FOREIGN KEY (settled_by) REFERENCES profiles(id);

alter table public."topup_requests" add constraint "topup_requests_agency_id_fkey" FOREIGN KEY (agency_id) REFERENCES agencies(id);

alter table public."topup_requests" add constraint "topup_requests_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES profiles(id);

alter table public."topup_requests" add constraint "topup_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES profiles(id);

alter table public."wallet_transactions" add constraint "wallet_transactions_agency_id_fkey" FOREIGN KEY (agency_id) REFERENCES agencies(id);

alter table public."wallet_transactions" add constraint "wallet_transactions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);

alter table public."wallets" add constraint "wallets_agency_id_fkey" FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE;

CREATE INDEX bookings_supplier_status_due_idx ON public.bookings USING btree (supplier_status_next_check_at) WHERE (status = 'Ticketed'::text);

CREATE UNIQUE INDEX financial_agency_in_flight ON public.financial_operations USING btree (agency_id) WHERE (state = ANY (ARRAY['pending'::text, 'needs_review'::text]));

CREATE UNIQUE INDEX financial_operation_once ON public.financial_operations USING btree (booking_id, action, reference) WHERE (state <> 'released'::text);

CREATE OR REPLACE FUNCTION public.activate_cny_funding()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke all on function public.activate_cny_funding() from public, anon, authenticated, service_role;

grant execute on function public.activate_cny_funding() to "service_role";

CREATE OR REPLACE FUNCTION public.apply_retail_debit(p_booking_id uuid, p_action text, p_reference text, p_actor uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke all on function public.apply_retail_debit(uuid,text,text,uuid,text) from public, anon, authenticated, service_role;

grant execute on function public.apply_retail_debit(uuid,text,text,uuid,text) to "service_role";

CREATE OR REPLACE FUNCTION public.approve_cny_topup(p_topup_id uuid, p_actor uuid, p_bank_reference text, p_received_cny numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke all on function public.approve_cny_topup(uuid,uuid,text,numeric) from public, anon, authenticated, service_role;

grant execute on function public.approve_cny_topup(uuid,uuid,text,numeric) to "service_role";

CREATE OR REPLACE FUNCTION public.approve_topup_request_legacy(p_topup_id uuid, p_approved_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  update public.wallets
  set balance_cny = balance_cny + request_row.amount_cny,
      updated_at = now()
  where agency_id = request_row.agency_id;

  insert into public.wallet_transactions (agency_id, entry_type, amount_cny, reason, created_by)
  values (
    request_row.agency_id,
    'credit',
    request_row.amount_cny,
    'Top-up approved: ' || request_row.invoice_number,
    p_approved_by
  );
end;
$function$;

revoke all on function public.approve_topup_request_legacy(uuid,uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_topup_request(p_topup_id uuid, p_approved_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if exists(select 1 from public.topup_requests where id=p_topup_id and pricing_model='cny-funding-v1') then
  raise exception 'Verified CNY receipt required';
 end if;
 perform public.approve_topup_request_legacy(p_topup_id,p_approved_by);
end $function$;

revoke all on function public.approve_topup_request(uuid,uuid) from public, anon, authenticated, service_role;

grant execute on function public.approve_topup_request(uuid,uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.assert_wallet_funds(p_agency_id uuid, p_amount_cny numeric, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public.assert_wallet_funds(uuid,numeric,uuid) from public, anon, authenticated, service_role;

grant execute on function public.assert_wallet_funds(uuid,numeric,uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.begin_financial_operation_base(p_actor uuid, p_pnr text, p_action text, p_reference text, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke all on function public.begin_financial_operation_base(uuid,text,text,text,numeric) from public, anon, authenticated, service_role;

grant execute on function public.begin_financial_operation_base(uuid,text,text,text,numeric) to "service_role";

CREATE OR REPLACE FUNCTION public.begin_financial_operation(p_actor uuid, p_pnr text, p_action text, p_reference text, p_amount numeric, p_expected_retail jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke all on function public.begin_financial_operation(uuid,text,text,text,numeric,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.begin_financial_operation(uuid,text,text,text,numeric,jsonb) to "service_role";

CREATE OR REPLACE FUNCTION public.claim_spring_status_checks()
 RETURNS SETOF bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with candidates as (
    select b.id from public.bookings b
    where b.status = 'Ticketed' and b.pnr not like 'B2B%'
      and (b.supplier_status_lease_until is null or b.supplier_status_lease_until < now())
      and (b.supplier_status_next_check_at <= now()
        or b.supplier_status->>'revision' is distinct from md5(jsonb_build_array(b.itinerary->'flights', b.itinerary->'departureDate', b.itinerary->'returnDate', b.passengers)::text))
    order by b.supplier_status_next_check_at nulls first, b.id
    limit 5 for update skip locked
  )
  update public.bookings b set supplier_status_lease_until = now() + interval '5 minutes',
    supplier_status_lease_id = gen_random_uuid(),
    supplier_status = b.supplier_status || jsonb_build_object('claimedRevision', md5(jsonb_build_array(b.itinerary->'flights', b.itinerary->'departureDate', b.itinerary->'returnDate', b.passengers)::text))
  from candidates c where b.id = c.id returning b.*;
end;
$function$;

revoke all on function public.claim_spring_status_checks() from public, anon, authenticated, service_role;

grant execute on function public.claim_spring_status_checks() to "service_role";

CREATE OR REPLACE FUNCTION public.cny_funding_ready()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public.cny_funding_ready() from public, anon, authenticated, service_role;

grant execute on function public.cny_funding_ready() to "service_role";

CREATE OR REPLACE FUNCTION public.current_agency_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select agency_id
  from public.profiles
  where id = auth.uid() and active
$function$;

revoke all on function public.current_agency_id() from public, anon, authenticated, service_role;

grant execute on function public.current_agency_id() to public;

grant execute on function public.current_agency_id() to "anon";

grant execute on function public.current_agency_id() to "authenticated";

grant execute on function public.current_agency_id() to "service_role";

CREATE OR REPLACE FUNCTION public.expire_pending_topup_requests()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.topup_requests
  set status = 'cancelled'
  where status = 'pending' and expires_at <= now();
$function$;

revoke all on function public.expire_pending_topup_requests() from public, anon, authenticated, service_role;

grant execute on function public.expire_pending_topup_requests() to "service_role";

CREATE OR REPLACE FUNCTION public.finish_financial_operation(p_id uuid, p_actor uuid, p_state text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_state is null or p_state not in ('completed','needs_review') then raise exception 'Invalid operation state'; end if;
  update public.financial_operations set state = p_state, updated_at = now()
    where id = p_id and actor_id = p_actor and state = 'pending';
  if not found then raise exception 'Financial operation cannot be updated'; end if;
end $function$;

revoke all on function public.finish_financial_operation(uuid,uuid,text) from public, anon, authenticated, service_role;

grant execute on function public.finish_financial_operation(uuid,uuid,text) to "service_role";

CREATE OR REPLACE FUNCTION public.finish_spring_status_check(p_booking_id uuid, p_lease_id uuid, p_revision text, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b public.bookings; current_revision text;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.supplier_status_lease_id is distinct from p_lease_id or p_lease_id is null then return false; end if;
  current_revision := md5(jsonb_build_array(b.itinerary->'flights', b.itinerary->'departureDate', b.itinerary->'returnDate', b.passengers)::text);
  if b.status <> 'Ticketed' or current_revision is distinct from p_revision then
    update public.bookings set supplier_status_lease_until = null, supplier_status_lease_id = null,
      supplier_status_next_check_at = now() where id = b.id;
    return false;
  end if;
  update public.bookings set
    supplier_status = case when p_result is null then
      b.supplier_status || jsonb_build_object('result', 'error', 'lastAttemptAt', now(), 'revision', current_revision)
    else p_result || jsonb_build_object('revision', current_revision) end,
    supplier_status_next_check_at = now() + case
      when p_result->>'result' = 'ok' and jsonb_array_length(p_result->'records') > 0
        and not exists (select 1 from jsonb_array_elements(p_result->'records') r where r->>'flag' <> '40')
      then interval '24 hours' else interval '15 minutes' end,
    supplier_status_lease_until = null, supplier_status_lease_id = null
  where id = b.id;
  return true;
end;
$function$;

revoke all on function public.finish_spring_status_check(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.finish_spring_status_check(uuid,uuid,text,jsonb) to "service_role";

CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'platform_admin'
      and active
  )
$function$;

revoke all on function public.is_platform_admin() from public, anon, authenticated, service_role;

grant execute on function public.is_platform_admin() to public;

grant execute on function public.is_platform_admin() to "anon";

grant execute on function public.is_platform_admin() to "authenticated";

grant execute on function public.is_platform_admin() to "service_role";

CREATE OR REPLACE FUNCTION public.issue_booking_from_wallet_base(p_booking_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public.issue_booking_from_wallet_base(uuid,uuid) from public, anon, authenticated, service_role;

grant execute on function public.issue_booking_from_wallet_base(uuid,uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.issue_booking_from_wallet(p_booking_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb; b public.bookings; q public.retail_pricing;
begin
  result := public.issue_booking_from_wallet_base(p_booking_id,p_actor_id);
  select * into b from public.bookings where id=p_booking_id;
  perform public.apply_retail_debit(b.id,'issue',b.pnr,p_actor_id,'Ticket issue: '||b.pnr);
  select * into q from public.retail_pricing where booking_id=b.id and action='issue' and reference=b.pnr;
  if found then result := result || jsonb_build_object('debitedCny',(q.snapshot->>'walletCny')::numeric,'balanceCny',(select balance_cny from public.wallets where agency_id=b.agency_id)); end if;
  return result;
end $function$;

revoke all on function public.issue_booking_from_wallet(uuid,uuid) from public, anon, authenticated, service_role;

grant execute on function public.issue_booking_from_wallet(uuid,uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.platform_adjust_wallet(p_agency_id uuid, p_amount numeric, p_reason text, p_created_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_amount = 0 then
    raise exception 'Amount must not be zero';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_created_by
      and role = 'platform_admin'
      and active
  ) then
    raise exception 'Only an active platform administrator can adjust a wallet';
  end if;

  update public.wallets
  set balance_cny = balance_cny + p_amount,
      updated_at = now()
  where agency_id = p_agency_id;

  if not found then
    raise exception 'Wallet not found';
  end if;

  insert into public.wallet_transactions (
    agency_id, entry_type, amount_cny, reason, created_by
  )
  values (
    p_agency_id, 'adjustment', p_amount, p_reason, p_created_by
  );
end;
$function$;

revoke all on function public.platform_adjust_wallet(uuid,numeric,text,uuid) from public, anon, authenticated, service_role;

grant execute on function public.platform_adjust_wallet(uuid,numeric,text,uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.platform_reset_all_wallets(p_created_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception using errcode = '42501', message = 'WALLET_RESET_DISABLED';
end;
$function$;

revoke all on function public.platform_reset_all_wallets(uuid) from public, anon, authenticated, service_role;

comment on function public.platform_reset_all_wallets(uuid) is 'Retired: wallet balances and financial history must never be reset.';

CREATE OR REPLACE FUNCTION public.portal_active_reader()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.active
    and (p.role = 'platform_admin' or (p.role in ('agent','office_manager')
      and exists(select 1 from public.agencies a where a.id = p.agency_id and a.active))));
$function$;

revoke all on function public.portal_active_reader() from public, anon, authenticated, service_role;

grant execute on function public.portal_active_reader() to "authenticated";

grant execute on function public.portal_active_reader() to "service_role";

CREATE OR REPLACE FUNCTION public.portal_auth_security_ready()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not exists (
    select 1 from unnest(array['agencies','branches','profiles','bookings','wallets',
      'wallet_transactions','topup_requests','financial_operations','retail_pricing',
      'password_security']) t(name)
    cross join unnest(array['anon','authenticated']) r(name)
    where has_table_privilege(r.name, 'public.' || t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r.name, 'public.' || t.name, 'SELECT,INSERT,UPDATE,REFERENCES')
  ) and not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['anon','authenticated']) r(name)
    where n.nspname = 'public' and c.relkind in ('v','m')
      and (has_table_privilege(r.name, c.oid, 'SELECT')
        or has_any_column_privilege(r.name, c.oid, 'SELECT'))
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon','authenticated']) r(name)
    where n.nspname = 'public' and p.prosecdef
      and p.proname not in ('current_agency_id','is_platform_admin','portal_active_reader')
      and has_function_privilege(r.name, p.oid, 'EXECUTE')
  );
$function$;

revoke all on function public.portal_auth_security_ready() from public, anon, authenticated, service_role;

grant execute on function public.portal_auth_security_ready() to "service_role";

CREATE OR REPLACE FUNCTION public.record_change_payment_base(p_pnr text, p_app_id text, p_amount numeric, p_actor uuid, p_check_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public.record_change_payment_base(text,text,numeric,uuid,boolean) from public, anon, authenticated, service_role;

grant execute on function public.record_change_payment_base(text,text,numeric,uuid,boolean) to "service_role";

CREATE OR REPLACE FUNCTION public.record_change_payment(p_pnr text, p_app_id text, p_amount numeric, p_actor uuid, p_check_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke all on function public.record_change_payment(text,text,numeric,uuid,boolean) from public, anon, authenticated, service_role;

grant execute on function public.record_change_payment(text,text,numeric,uuid,boolean) to "service_role";

CREATE OR REPLACE FUNCTION public.record_portal_password_change(p_user_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.password_security(user_id, password_changed_at, revision)
  values(p_user_id, clock_timestamp(), gen_random_uuid())
  on conflict(user_id) do update set password_changed_at = excluded.password_changed_at,
    revision = excluded.revision;
$function$;

revoke all on function public.record_portal_password_change(uuid) from public, anon, authenticated, service_role;

grant execute on function public.record_portal_password_change(uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.retail_operation_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.state='completed' and old.state='pending' then
    update public.retail_pricing set state=case when new.action='refund' then 'awaiting_settlement' else 'settled' end,updated_at=now()
      where booking_id=new.booking_id and action=new.action and reference=new.reference and state='prepared'
      and (new.action='refund' or (new.action='change' and (snapshot->>'walletCny')::numeric=0));
  end if;
  return new;
end $function$;

revoke all on function public.retail_operation_completed() from public, anon, authenticated, service_role;

grant execute on function public.retail_operation_completed() to "service_role";

CREATE OR REPLACE FUNCTION public.retail_pricing_ready()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select to_regprocedure('public.begin_financial_operation(uuid,text,text,text,numeric,jsonb)') is not null
    and to_regprocedure('public.settle_retail_refund(uuid,text,uuid,numeric,text)') is not null;
$function$;

revoke all on function public.retail_pricing_ready() from public, anon, authenticated, service_role;

grant execute on function public.retail_pricing_ready() to "service_role";

CREATE OR REPLACE FUNCTION public.settle_retail_refund(p_booking_id uuid, p_reference text, p_actor uuid, p_supplier_received numeric, p_settlement_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke all on function public.settle_retail_refund(uuid,text,uuid,numeric,text) from public, anon, authenticated, service_role;

grant execute on function public.settle_retail_refund(uuid,text,uuid,numeric,text) to "service_role";

CREATE OR REPLACE FUNCTION public.store_retail_price(p_pnr text, p_action text, p_reference text, p_actor uuid, p_snapshot jsonb, p_public jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke all on function public.store_retail_price(text,text,text,uuid,jsonb,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.store_retail_price(text,text,text,uuid,jsonb,jsonb) to "service_role";

CREATE OR REPLACE FUNCTION public.validate_cny_funding_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke all on function public.validate_cny_funding_quote() from public, anon, authenticated, service_role;

grant execute on function public.validate_cny_funding_quote() to "service_role";

alter table public."agencies" enable row level security;

revoke all on table public."agencies" from public, anon, authenticated, service_role;

grant all on public."agencies" to service_role;

alter table public."bookings" enable row level security;

revoke all on table public."bookings" from public, anon, authenticated, service_role;

grant all on public."bookings" to service_role;

alter table public."branches" enable row level security;

revoke all on table public."branches" from public, anon, authenticated, service_role;

grant all on public."branches" to service_role;

alter table public."cny_funding_receipts" enable row level security;

revoke all on table public."cny_funding_receipts" from public, anon, authenticated, service_role;

grant select, insert on public."cny_funding_receipts" to service_role;

alter table public."financial_operations" enable row level security;

revoke all on table public."financial_operations" from public, anon, authenticated, service_role;

grant all on public."financial_operations" to service_role;

alter table public."password_security" enable row level security;

revoke all on table public."password_security" from public, anon, authenticated, service_role;

grant all on public."password_security" to service_role;

alter table public."portal_pricing_config" enable row level security;

revoke all on table public."portal_pricing_config" from public, anon, authenticated, service_role;

grant all on public."portal_pricing_config" to service_role;

alter table public."profiles" enable row level security;

revoke all on table public."profiles" from public, anon, authenticated, service_role;

grant all on public."profiles" to service_role;

alter table public."retail_pricing" enable row level security;

revoke all on table public."retail_pricing" from public, anon, authenticated, service_role;

grant all on public."retail_pricing" to service_role;

alter table public."topup_requests" enable row level security;

revoke all on table public."topup_requests" from public, anon, authenticated, service_role;

grant all on public."topup_requests" to service_role;

alter table public."wallet_transactions" enable row level security;

revoke all on table public."wallet_transactions" from public, anon, authenticated, service_role;

grant all on public."wallet_transactions" to service_role;

alter table public."wallets" enable row level security;

revoke all on table public."wallets" from public, anon, authenticated, service_role;

grant all on public."wallets" to service_role;

create policy "active portal readers only" on public."agencies" as RESTRICTIVE for SELECT to "authenticated" using (portal_active_reader());

create policy "agency isolation" on public."agencies" as PERMISSIVE for SELECT to public using (((id = current_agency_id()) OR is_platform_admin()));

create policy "active portal readers only" on public."bookings" as RESTRICTIVE for SELECT to "authenticated" using (portal_active_reader());

create policy "agent creates own booking" on public."bookings" as PERMISSIVE for INSERT to public with check (((created_by = auth.uid()) AND (agency_id = current_agency_id())));

create policy "agent own bookings" on public."bookings" as PERMISSIVE for SELECT to public using (((created_by = auth.uid()) OR is_platform_admin() OR ((agency_id = current_agency_id()) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'office_manager'::user_role)))))));

create policy "portal current agency boundary" on public."bookings" as RESTRICTIVE for SELECT to "authenticated" using ((is_platform_admin() OR (agency_id = current_agency_id())));

create policy "active portal readers only" on public."branches" as RESTRICTIVE for SELECT to "authenticated" using (portal_active_reader());

create policy "branch isolation" on public."branches" as PERMISSIVE for SELECT to public using (((agency_id = current_agency_id()) OR is_platform_admin()));

create policy "active portal readers only" on public."profiles" as RESTRICTIVE for SELECT to "authenticated" using (portal_active_reader());

create policy "profile own or platform" on public."profiles" as PERMISSIVE for SELECT to public using (((id = auth.uid()) OR is_platform_admin()));

create policy "active portal readers only" on public."topup_requests" as RESTRICTIVE for SELECT to "authenticated" using (portal_active_reader());

create policy "portal current agency boundary" on public."topup_requests" as RESTRICTIVE for SELECT to "authenticated" using ((is_platform_admin() OR (agency_id = current_agency_id())));

create policy "topup request isolation" on public."topup_requests" as PERMISSIVE for SELECT to public using (((requested_by = auth.uid()) OR is_platform_admin() OR ((agency_id = current_agency_id()) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'office_manager'::user_role)))))));

create policy "active portal readers only" on public."wallet_transactions" as RESTRICTIVE for SELECT to "authenticated" using (portal_active_reader());

create policy "ledger isolation" on public."wallet_transactions" as PERMISSIVE for SELECT to public using (((agency_id = current_agency_id()) OR is_platform_admin()));

create policy "active portal readers only" on public."wallets" as RESTRICTIVE for SELECT to "authenticated" using (portal_active_reader());

create policy "wallet isolation" on public."wallets" as PERMISSIVE for SELECT to public using (((agency_id = current_agency_id()) OR is_platform_admin()));

CREATE TRIGGER retail_operation_completed AFTER UPDATE OF state ON public.financial_operations FOR EACH ROW EXECUTE FUNCTION retail_operation_completed();

CREATE TRIGGER validate_cny_funding_quote BEFORE INSERT OR UPDATE ON public.topup_requests FOR EACH ROW EXECUTE FUNCTION validate_cny_funding_quote();
$captured_schema$;
  end if;
end;
$baseline$;
