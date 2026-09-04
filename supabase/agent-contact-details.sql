-- Run before deploying the agent contact and ticket PDF update.
begin;
alter table public.profiles
  add column if not exists email text,
  add column if not exists phone text;
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and (p.email is null or p.email = '');
commit;
