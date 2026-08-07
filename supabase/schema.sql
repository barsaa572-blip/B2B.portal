-- Run in Supabase SQL Editor after creating the project.
create type public.user_role as enum ('agent', 'office_manager', 'platform_admin');
create type public.wallet_entry_type as enum ('credit', 'debit', 'adjustment');

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (agency_id, name)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  agency_id uuid references public.agencies(id),
  branch_id uuid references public.branches(id),
  role public.user_role not null default 'agent',
  full_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((role = 'platform_admin') or agency_id is not null)
);

create table public.wallets (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  balance_cny numeric(14,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  entry_type public.wallet_entry_type not null,
  amount_cny numeric(14,2) not null check (amount_cny <> 0),
  booking_id uuid,
  reason text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  pnr text unique,
  agency_id uuid not null references public.agencies(id),
  branch_id uuid references public.branches(id),
  created_by uuid not null references public.profiles(id),
  status text not null default 'draft',
  total_cny numeric(14,2) not null check (total_cny >= 0),
  itinerary jsonb not null,
  passengers jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'platform_admin' and active) $$;

create or replace function public.current_agency_id()
returns uuid language sql stable security definer set search_path = public
as $$ select agency_id from public.profiles where id = auth.uid() and active $$;

alter table public.profiles enable row level security;
alter table public.agencies enable row level security;
alter table public.branches enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.bookings enable row level security;

create policy "profile own or platform" on public.profiles for select using (id = auth.uid() or public.is_platform_admin());
create policy "agency isolation" on public.agencies for select using (id = public.current_agency_id() or public.is_platform_admin());
create policy "branch isolation" on public.branches for select using (agency_id = public.current_agency_id() or public.is_platform_admin());
create policy "wallet isolation" on public.wallets for select using (agency_id = public.current_agency_id() or public.is_platform_admin());
create policy "ledger isolation" on public.wallet_transactions for select using (agency_id = public.current_agency_id() or public.is_platform_admin());
create policy "agent own bookings" on public.bookings for select using (created_by = auth.uid() or public.is_platform_admin() or (agency_id = public.current_agency_id() and exists (select 1 from public.profiles where id = auth.uid() and role = 'office_manager')));
create policy "agent creates own booking" on public.bookings for insert with check (created_by = auth.uid() and agency_id = public.current_agency_id());

-- Wallet credit/debit and platform-user management must use server-side Edge Functions.
-- Never expose service_role, Spring API credentials, or balance adjustment endpoints to the browser.
