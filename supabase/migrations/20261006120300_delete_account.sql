-- FEAT-002: in-app account deletion (App Store guideline 5.1.1(v)).
-- Personal events are deleted. Shared events stay with the family with owner_id null.
create function public.delete_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Leave first: if this was the last member, their shared events become personal
  -- and are then deleted with the rest.
  perform public._remove_from_family(uid);
  -- The cascade delete of our profile below needs this lock anyway; taking it here
  -- stops a write from this user's other device slipping in between. A shared-event
  -- insert from that device can still race this (Postgres aborts one side with
  -- 40P01); the app should treat that as retryable.
  perform 1 from public.profiles where id = uid for update;
  delete from public.events where owner_id = uid and visibility = 'personal';
  -- Cascades to profiles; events.owner_id and updated_by become null.
  delete from auth.users where id = uid;
end $$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
