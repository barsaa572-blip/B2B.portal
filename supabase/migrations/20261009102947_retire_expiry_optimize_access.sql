-- No business-row writes. Existing expiry values remain historical metadata.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.topup_requests alter column expires_at drop default;
alter table public.topup_requests alter column expires_at drop not null;

create or replace function public.expire_pending_topup_requests()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'INVOICE_EXPIRY_DISABLED';
end;
$$;
revoke all on function public.expire_pending_topup_requests() from public, anon, authenticated, service_role;
comment on function public.expire_pending_topup_requests() is 'Retired: pending invoices do not expire.';

-- These RLS helpers still validate auth.uid(); authenticated policy execution stays available.
create or replace function public.current_agency_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select agency_id from public.profiles where id = (select auth.uid()) and active
$$;
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles
    where id = (select auth.uid()) and role = 'platform_admin' and active)
$$;
revoke all on function public.current_agency_id(), public.is_platform_admin() from public, anon;
grant execute on function public.current_agency_id(), public.is_platform_admin() to authenticated, service_role;

alter policy "profile own or platform" on public.profiles
  using (id = (select auth.uid()) or public.is_platform_admin());
alter policy "agent own bookings" on public.bookings
  using (created_by = (select auth.uid()) or public.is_platform_admin()
    or (agency_id = public.current_agency_id() and exists
      (select 1 from public.profiles where id = (select auth.uid()) and role = 'office_manager')));
alter policy "agent creates own booking" on public.bookings
  with check (created_by = (select auth.uid()) and agency_id = public.current_agency_id());
alter policy "topup request isolation" on public.topup_requests
  using (requested_by = (select auth.uid()) or public.is_platform_admin()
    or (agency_id = public.current_agency_id() and exists
      (select 1 from public.profiles where id = (select auth.uid()) and role = 'office_manager')));

create index if not exists bookings_agency_id_idx on public.bookings(agency_id);
create index if not exists bookings_branch_id_idx on public.bookings(branch_id);
create index if not exists bookings_created_by_idx on public.bookings(created_by);
create index if not exists cny_funding_receipts_verified_by_idx on public.cny_funding_receipts(verified_by);
create index if not exists financial_operations_actor_id_idx on public.financial_operations(actor_id);
create index if not exists profiles_agency_id_idx on public.profiles(agency_id);
create index if not exists profiles_branch_id_idx on public.profiles(branch_id);
create index if not exists retail_pricing_actor_id_idx on public.retail_pricing(actor_id);
create index if not exists retail_pricing_settled_by_idx on public.retail_pricing(settled_by);
create index if not exists topup_requests_agency_id_idx on public.topup_requests(agency_id);
create index if not exists topup_requests_approved_by_idx on public.topup_requests(approved_by);
create index if not exists topup_requests_requested_by_idx on public.topup_requests(requested_by);
create index if not exists wallet_transactions_agency_id_idx on public.wallet_transactions(agency_id);
create index if not exists wallet_transactions_created_by_idx on public.wallet_transactions(created_by);
notify pgrst, 'reload schema';
