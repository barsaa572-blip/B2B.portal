-- Run once in Supabase SQL Editor before deploying the agency-contact update.
alter table public.agencies
  add column if not exists registration_number text,
  add column if not exists email text,
  add column if not exists phone text;
