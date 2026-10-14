-- FEAT-002: events, personal or shared with the creator's family.

create table public.events (
  id            uuid primary key, -- generated on the device so offline creates work
  owner_id      uuid references public.profiles on delete set null, -- null = former member
  family_id     uuid references public.families on delete cascade,
  visibility    text not null default 'personal' check (visibility in ('personal', 'shared')),
  title         text not null check (char_length(title) between 1 and 200),
  date          date not null, -- NZ calendar date
  start_time    time,
  end_time      time,
  people        uuid[] not null default '{}', -- profile ids
  legacy_people text[] not null default '{}', -- old tags not mapped to a member
  series_id     uuid, -- shared by the occurrences of one recurring event
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles on delete set null,
  deleted_at    timestamptz,
  constraint events_shared_has_family check ((visibility = 'shared') = (family_id is not null)),
  constraint events_orphans_are_shared check (owner_id is not null or visibility = 'shared')
);

create index events_family_updated_idx on public.events (family_id, updated_at);
create index events_owner_updated_idx on public.events (owner_id, updated_at);

create function public.events_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Visibility decides the family: personal has none, shared uses the caller's.
  if new.visibility = 'personal' then
    new.family_id := null;
  elsif new.family_id is null then
    new.family_id := public.my_family_id();
    if new.family_id is null then
      raise exception 'not_in_family' using errcode = 'P0001';
    end if;
  end if;

  -- The server owns the timestamps; sync orders by updated_at.
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_at := new.updated_at;
  else
    new.created_at := old.created_at;
  end if;

  -- Rules for app users. Functions running as the table owner (leaving a family,
  -- deleting an account) and foreign-key cascades skip these.
  if current_user = 'authenticated' then
    new.updated_by := auth.uid();
    if tg_op = 'UPDATE' then
      if new.id is distinct from old.id then
        raise exception 'id_cannot_change' using errcode = '42501';
      end if;
      if new.owner_id is distinct from old.owner_id then
        raise exception 'owner_cannot_change' using errcode = '42501';
      end if;
      if old.visibility = 'shared' and new.visibility = 'personal'
         and old.owner_id is distinct from auth.uid() then
        raise exception 'only_creator_can_make_personal' using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end $$;

create trigger events_guard
  before insert or update on public.events
  for each row execute function public.events_guard();

alter table public.events enable row level security;

-- Personal: only the creator. Shared: everyone currently in that family.
create policy events_select on public.events for select to authenticated
  using ((visibility = 'personal' and owner_id = auth.uid())
      or (visibility = 'shared' and family_id = public.my_family_id()));

create policy events_insert on public.events for insert to authenticated
  with check (owner_id = auth.uid()
          and (visibility = 'personal' or family_id = public.my_family_id()));

create policy events_update on public.events for update to authenticated
  using ((visibility = 'personal' and owner_id = auth.uid())
      or (visibility = 'shared' and family_id = public.my_family_id()))
  with check ((visibility = 'personal' and owner_id = auth.uid())
           or (visibility = 'shared' and family_id = public.my_family_id()));

-- No hard deletes from the app: set deleted_at so other devices hear about it.
revoke all on public.events from anon, authenticated;
grant select, insert, update on public.events to authenticated;

-- Live updates for the app (RLS still applies to Realtime).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.events;
