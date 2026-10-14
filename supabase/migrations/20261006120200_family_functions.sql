-- FEAT-002: family membership. Clients change membership only through these functions.

create table public.join_attempts (
  user_id      uuid not null references auth.users on delete cascade,
  attempted_at timestamptz not null default now()
);
create index join_attempts_user_idx on public.join_attempts (user_id, attempted_at);
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from anon, authenticated;

-- Take a user out of their family. If they owned it, the longest-standing member
-- becomes owner. If they were the last member, their shared events become personal
-- and the family is deleted (with any events earlier members left behind).
-- Locks the user's profile FOR NO KEY UPDATE (so an ownership-transfer FK check onto this user
-- cannot deadlock), then the family, so concurrent calls for one user run one at a time.
create function public._remove_from_family(p_user uuid, p_required_owner uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  fam uuid;
  next_owner uuid;
begin
  -- Lock order everywhere: profile row, then family row.
  select family_id into fam from public.profiles where id = p_user for no key update;
  if fam is null then
    return;
  end if;
  perform 1 from public.families where id = fam for update;

  -- remove_member passes the caller; check ownership only once the family is locked.
  if p_required_owner is not null
     and (p_user = p_required_owner
          or not exists (select 1 from public.families where id = fam and owner_id = p_required_owner)) then
    raise exception 'not_family_owner' using errcode = 'P0001';
  end if;

  update public.profiles set family_id = null, joined_family_at = null
   where id = p_user and family_id = fam;

  select id into next_owner from public.profiles
   where family_id = fam
   order by joined_family_at, id
   limit 1;

  if next_owner is null then
    update public.events set visibility = 'personal'
     where family_id = fam and owner_id = p_user;
    delete from public.families where id = fam;
  else
    update public.families set owner_id = next_owner
     where id = fam and owner_id = p_user;
  end if;
end $$;

create function public.create_family(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  fam uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if (select family_id from public.profiles where id = uid for no key update) is not null then
    raise exception 'already_in_family' using errcode = 'P0001';
  end if;

  insert into public.families (name, owner_id, invite_code)
  values (btrim(p_name), uid, public.generate_invite_code())
  returning id into fam;

  update public.profiles set family_id = fam, joined_family_at = clock_timestamp() where id = uid;
  return fam;
end $$;

-- Returns 'joined', 'invalid_code', 'rate_limited' or 'already_in_family'. It returns
-- rather than raising so that failed attempts are saved and counted.
create function public.join_family(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  fam uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if (select family_id from public.profiles where id = uid for no key update) is not null then
    return 'already_in_family';
  end if;
  if (select count(*) from public.join_attempts
       where user_id = uid and attempted_at > now() - interval '1 hour') >= 5 then
    return 'rate_limited';
  end if;

  select id into fam from public.families where invite_code = upper(btrim(p_code)) for share;
  if fam is null then
    insert into public.join_attempts (user_id) values (uid);
    return 'invalid_code';
  end if;

  -- Tags are unique within a family: drop the joiner's tag if a member has it.
  update public.profiles p
     set family_id = fam,
         joined_family_at = clock_timestamp(),
         tag = case when exists (select 1 from public.profiles o
                                  where o.family_id = fam and o.tag = p.tag)
                    then null else p.tag end
   where p.id = uid;
  return 'joined';
end $$;

create function public.leave_family() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  perform public._remove_from_family(auth.uid());
end $$;

create function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.families f
      join public.profiles p on p.family_id = f.id
     where f.owner_id = auth.uid() and p.id = p_user and p.id <> auth.uid()
  ) then
    raise exception 'not_family_owner' using errcode = 'P0001';
  end if;
  perform public._remove_from_family(p_user, auth.uid());
end $$;

create function public.regenerate_invite_code() returns text
language plpgsql security definer set search_path = '' as $$
declare
  code text;
begin
  update public.families set invite_code = public.generate_invite_code()
   where owner_id = auth.uid()
  returning invite_code into code;
  if code is null then
    raise exception 'not_family_owner' using errcode = 'P0001';
  end if;
  return code;
end $$;

revoke execute on function public._remove_from_family(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_family(text), public.join_family(text), public.leave_family(),
  public.remove_member(uuid), public.regenerate_invite_code() from public, anon;
grant execute on function public.create_family(text), public.join_family(text), public.leave_family(),
  public.remove_member(uuid), public.regenerate_invite_code() to authenticated;
