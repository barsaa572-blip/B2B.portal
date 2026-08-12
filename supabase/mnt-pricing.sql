-- Run once in Supabase SQL Editor. Keeps a permanent pricing snapshot on each invoice/booking.
alter table public.topup_requests
  add column if not exists amount_mnt numeric(14,0),
  add column if not exists service_fee_mnt numeric(14,0) not null default 0,
  add column if not exists total_mnt numeric(14,0),
  add column if not exists official_cny_mnt_rate numeric(14,4),
  add column if not exists markup_mnt numeric(14,2) not null default 4,
  add column if not exists effective_cny_mnt_rate numeric(14,4),
  add column if not exists rate_date date;

alter table public.bookings
  add column if not exists total_mnt numeric(14,0),
  add column if not exists official_cny_mnt_rate numeric(14,4),
  add column if not exists markup_mnt numeric(14,2) not null default 4,
  add column if not exists effective_cny_mnt_rate numeric(14,4),
  add column if not exists rate_date date;
