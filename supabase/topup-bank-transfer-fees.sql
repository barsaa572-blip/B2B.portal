-- Run once in the Supabase SQL Editor before deploying the bank-fee invoice update.
-- Each invoice snapshots the specific banking charges that were quoted to the agency.
alter table public.topup_requests
  add column if not exists correspondent_fee_cny numeric(14,2) not null default 0,
  add column if not exists correspondent_fee_mnt numeric(14,0) not null default 0,
  add column if not exists khaan_transfer_fee_mnt numeric(14,0) not null default 0,
  add column if not exists bank_transfer_fee_mnt numeric(14,0) not null default 0,
  add column if not exists bank_name text;

comment on column public.topup_requests.correspondent_fee_cny is
  'Golomt Bank CNY OUR fee: 50 CNY through 100,000 CNY, otherwise 150 CNY.';

comment on column public.topup_requests.khaan_transfer_fee_mnt is
  'Historical Khaan Bank transfer-fee snapshot.';

comment on column public.topup_requests.bank_transfer_fee_mnt is
  'Golomt Bank CNY transfer fee: 5000 MNT through 50,000 CNY; 10000 MNT through 100,000 CNY; 20000 MNT above.';
