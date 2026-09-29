-- Run once on the target Supabase project before deploying the worker.
-- No booking/payment/itinerary values are rewritten.
begin;
alter table public.bookings add column if not exists supplier_status jsonb not null default '{}'::jsonb;
alter table public.bookings add column if not exists supplier_status_next_check_at timestamptz default now();
alter table public.bookings add column if not exists supplier_status_lease_until timestamptz;
alter table public.bookings add column if not exists supplier_status_lease_id uuid;
create index if not exists bookings_supplier_status_due_idx
  on public.bookings(supplier_status_next_check_at) where status = 'Ticketed';

create or replace function public.claim_spring_status_checks()
returns setof public.bookings language plpgsql security definer set search_path = public
as $$
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
$$;

create or replace function public.finish_spring_status_check(p_booking_id uuid, p_lease_id uuid, p_revision text, p_result jsonb)
returns boolean language plpgsql security definer set search_path = public
as $$
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
$$;
revoke all on function public.claim_spring_status_checks() from public, anon, authenticated;
revoke all on function public.finish_spring_status_check(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_spring_status_checks() to service_role;
grant execute on function public.finish_spring_status_check(uuid, uuid, text, jsonb) to service_role;
commit;
notify pgrst, 'reload schema';
