-- Run once in the Supabase SQL Editor before deploying the bank-fee invoice update.
-- Each invoice snapshots the specific banking charges that were quoted to the agency.
alter table public.topup_requests
  add column if not exists correspondent_fee_cny numeric(14,2) not null default 0,
  add column if not exists correspondent_fee_mnt numeric(14,0) not null default 0,
  add column if not exists khaan_transfer_fee_mnt numeric(14,0) not null default 0;

comment on column public.topup_requests.correspondent_fee_cny is
  'OUR correspondent bank fee in CNY; currently 1%, minimum 50 CNY, maximum 260 CNY.';

comment on column public.topup_requests.khaan_transfer_fee_mnt is
  'Khaan Bank CNY transfer fee: 7500 MNT through 50,000 CNY; 10000 MNT through 100,000 CNY; 20000 MNT above.';
