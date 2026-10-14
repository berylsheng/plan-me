-- Test helpers for supabase/tests. Local only: `supabase db reset` applies this after
-- the migrations. Never push it to a hosted project.
create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- Create a confirmed user; the sign-up trigger creates their profile.
create or replace function tests.create_user(p_id uuid, p_email text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data)
  values (p_id, p_email, 'authenticated', 'authenticated',
          case when p_display_name is null then '{}'::jsonb
               else jsonb_build_object('display_name', p_display_name) end);
  return p_id;
end $$;

-- Act as this user for the rest of the transaction (until `reset role`).
create or replace function tests.login_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Set up membership directly, bypassing the RPCs (which have their own tests).
create or replace function tests.make_family(p_owner uuid, p_name text default 'Test family')
returns uuid language plpgsql security definer set search_path = '' as $$
declare fam uuid;
begin
  insert into public.families (name, owner_id, invite_code)
  values (p_name, p_owner, public.generate_invite_code())
  returning id into fam;
  update public.profiles set family_id = fam, joined_family_at = clock_timestamp() where id = p_owner;
  return fam;
end $$;

create or replace function tests.add_to_family(p_user uuid, p_family uuid)
returns void language sql security definer set search_path = '' as $$
  update public.profiles set family_id = p_family, joined_family_at = clock_timestamp() where id = p_user;
$$;

create or replace function tests.family_of(p_user uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select family_id from public.profiles where id = p_user;
$$;

create or replace function tests.invite_code_of(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select f.invite_code from public.families f join public.profiles p on p.family_id = f.id where p.id = p_user;
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
