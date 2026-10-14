-- FEAT-002: profiles and families.

create table public.profiles (
  id               uuid primary key references auth.users on delete cascade,
  display_name     text check (char_length(display_name) <= 50),
  tag              text check (tag ~ '^[A-Z]{2,4}$'),
  avatar_url       text,
  family_id        uuid,
  joined_family_at timestamptz,
  created_at       timestamptz not null default now(),
  unique (family_id, tag)
);

create table public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 50),
  owner_id    uuid not null references public.profiles,
  invite_code text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at  timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_family_id_fkey
  foreign key (family_id) references public.families on delete set null;

create index profiles_family_id_idx on public.profiles (family_id);

-- Every sign-up gets a profile. The app passes display_name in the sign-up metadata.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 50));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The caller's family. security definer so policies on profiles can call it
-- without recursing into profiles' own policies.
create function public.my_family_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.profiles where id = auth.uid()
$$;

-- 8 characters from a 32-symbol alphabet with no 0/O or 1/I. 256 is a multiple
-- of 32, so `byte % 32` is unbiased.
create function public.generate_invite_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  code text;
begin
  loop
    bytes := extensions.gen_random_bytes(8);
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.families where invite_code = code);
  end loop;
  return code;
end $$;

revoke execute on function public.generate_invite_code() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.families enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (family_id is not null and family_id = public.my_family_id()));

create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy families_select on public.families for select to authenticated
  using (id = public.my_family_id());

create policy families_update_owner on public.families for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Clients may read, and change only these columns. Membership changes go through
-- the functions in 20261006120200_family_functions.sql.
revoke all on public.profiles, public.families from anon, authenticated;
grant select on public.profiles, public.families to authenticated;
grant update (display_name, tag, avatar_url) on public.profiles to authenticated;
grant update (name) on public.families to authenticated;
