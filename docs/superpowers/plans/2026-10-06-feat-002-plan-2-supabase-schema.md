# Plan 2: Supabase schema, access rules and database tests (FEAT-002 phase B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, tested Supabase database with profiles, families, events, row-level security, membership functions and account deletion, plus CI that runs the app and database tests on every PR.

**Architecture:** All schema lives in versioned SQL migrations under `supabase/migrations/`. Access rules are Postgres row-level security policies plus one `before` trigger (`events_guard`). Membership changes go only through `security definer` functions, never direct writes. pgTAP tests under `supabase/tests/database/` sign in as test users and prove each rule. Nothing in the app changes in this plan.

**Tech Stack:** Supabase CLI (npm package `supabase`), Postgres 15+ via Docker, pgTAP, GitHub Actions.

**Spec:** [2026-10-06-accounts-family-sharing-design.md](../specs/2026-10-06-accounts-family-sharing-design.md) §2–4 and §9 Phase B. Roadmap: [2026-10-06-feat-002-roadmap.md](2026-10-06-feat-002-roadmap.md).

## Global Constraints

- Hosted projects (later plans) are in `ap-southeast-2` (Sydney). This plan only runs locally.
- Every access rule is enforced in the database. App code is never trusted to filter.
- `anon` gets nothing on these tables. The service-role key is never used by app code.
- Invite codes: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O, 1/I).
- Join attempts: at most 5 failed codes per user per rolling hour.
- Tags: `^[A-Z]{2,4}$`, unique within a family.
- Clients never hard-delete events; deletion is `deleted_at`.
- Requires Docker Desktop running (installed: 29.1). Windows: run commands from the repo root in Git Bash.
- Test helpers live in `supabase/seed.sql`, which runs only on local `db reset` / `db start`. Never run `supabase db push --include-seed` against a hosted project.
- Commit messages start with `FEAT-002:`.

### Correction to the spec, applied in Task 5

The spec's §4 select rule (`owner_id = auth.uid() OR shared-in-my-family`) lets someone who **left** a family keep seeing, editing, and un-sharing the shared events they created, which contradicts D7. This plan uses: **personal → only the owner; shared → only current members of that family.** Also, the spec doesn't say what happens to the family's events when its **last** member leaves. This plan: that member's shared events become personal; events left by earlier ex-members are deleted with the family.

## Review Focus

1. **A member who leaves or is removed must lose access to events they shared**, and can't take them back by making them personal. Pinned in Task 4 (test 15) and Task 2 (test 7).
2. **Joining a family where someone already uses your tag** must not fail with a unique-constraint error; the joiner's tag is cleared. Pinned in Task 4 (test 7).
3. **Failed join attempts must be counted even though the call "fails"**, otherwise rate limiting does nothing. `join_family` returns a status instead of raising. Pinned in Task 4 (test 11).
4. **Deleting the account of the last family member** must not trip foreign keys or the "orphans are shared" check. Pinned in Task 5 (tests 7–8).
5. **A client sending its own `updated_at`, `updated_by` or `owner_id`** must not affect sync order or ownership. Pinned in Task 2 (tests 5, 6, 16).

## File structure

| File | Responsibility |
|---|---|
| `supabase/config.toml` | Local stack config (from `supabase init`) |
| `supabase/migrations/20261006120000_profiles_and_families.sql` | Profiles, families, sign-up trigger, `my_family_id`, invite code generator, their RLS |
| `supabase/migrations/20261006120100_events.sql` | Events table, `events_guard` trigger, RLS, Realtime |
| `supabase/migrations/20261006120200_family_functions.sql` | Join attempts, create/join/leave/remove/regenerate functions |
| `supabase/migrations/20261006120300_delete_account.sql` | `delete_account()` |
| `supabase/seed.sql` | Test helpers (`tests` schema). Local only: applied after migrations on `db reset` |
| `supabase/tests/database/001-profiles.test.sql` … `004-delete-account.test.sql` | One test file per migration |
| `.github/workflows/ci.yml` | Lint, typecheck, Jest, database tests |

Running the tests: `npm run db:reset` re-applies every migration and then `seed.sql` to the local database, and `npm run db:test` runs every file in `supabase/tests/`. Each test file runs in a transaction and rolls back, so files don't depend on each other or on order.

---

### Task 1: Supabase tooling, profiles and families

**Files:**
- Modify: `package.json` (dev dependency, scripts)
- Create: `supabase/config.toml` (generated), `supabase/migrations/20261006120000_profiles_and_families.sql`, `supabase/seed.sql`
- Test: `supabase/tests/database/001-profiles.test.sql`

**Interfaces:**
- Produces (SQL):
  - Tables `public.profiles(id, display_name, tag, avatar_url, family_id, joined_family_at, created_at)` and `public.families(id, name, owner_id, invite_code, created_at)`
  - `public.my_family_id() returns uuid`, the caller's family or null
  - `public.generate_invite_code() returns text` (not callable by clients)
  - Test helpers: `tests.create_user(id uuid, email text, display_name text default null) returns uuid`, `tests.login_as(id uuid)`, `tests.make_family(owner uuid, name text default 'Test family') returns uuid`, `tests.add_to_family(user uuid, family uuid)`, `tests.family_of(user uuid) returns uuid`, `tests.invite_code_of(user uuid) returns text`

- [ ] **Step 1: Install the Supabase CLI and initialise**

```bash
npm install supabase --save-dev
npx supabase init --with-vscode-settings=false --with-intellij-settings=false
```

Expected: `supabase/config.toml` created. Open it and set the first line to `project_id = "plan-me"`.

Add to `package.json` `scripts`:

```json
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:test": "supabase test db"
```

Start the local stack (Docker Desktop must be running; the first run downloads images and takes several minutes):

```bash
npm run db:start
```

Expected: it prints `API URL`, `DB URL`, `Studio URL` and keys. These local keys are not secrets.

- [ ] **Step 2: Write the failing profile tests**

Create `supabase/tests/database/001-profiles.test.sql`:

```sql
begin;
select plan(6);

select tests.create_user('11111111-1111-1111-1111-111111111111', 'alice@test.nz', 'Alice');
select tests.create_user('22222222-2222-2222-2222-222222222222', 'bob@test.nz');

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Alice',
  'signing up creates a profile with the display name');

select tests.login_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.profiles),
  1,
  'a user without a family sees only their own profile');

update public.profiles set display_name = 'Ali', tag = 'AZ'
 where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select display_name || '/' || tag from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Ali/AZ',
  'a user can change their own display name and tag');

select throws_ok(
  $$update public.profiles set family_id = gen_random_uuid() where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null,
  'a user cannot set their own family directly');

select throws_ok(
  $$update public.profiles set tag = 'az' where id = '11111111-1111-1111-1111-111111111111'$$,
  '23514', null,
  'tags must be 2-4 upper-case letters');

reset role;
select tests.login_as('22222222-2222-2222-2222-222222222222');
update public.profiles set display_name = 'Hacked' where id = '11111111-1111-1111-1111-111111111111';
reset role;

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Ali',
  'a user cannot change someone else''s profile');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run db:test`
Expected: FAIL. `001-profiles` errors with `function tests.create_user(unknown, unknown, unknown) does not exist` (no helpers or tables yet).

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20261006120000_profiles_and_families.sql`:

```sql
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
```

- [ ] **Step 5: Write the test helpers**

Create `supabase/seed.sql`. It must come after the migration, because its SQL-language helpers are checked against `public.profiles` and `public.families` when created. Check that `supabase/config.toml` has `[db.seed]` with `enabled = true` and `sql_paths = ["./seed.sql"]` (the `supabase init` default).

```sql
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

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;
```

- [ ] **Step 6: Apply and run the tests**

```bash
npm run db:reset
npm run db:test
```

Expected: `db:reset` finishes with `Seeding data from supabase/seed.sql...`; `db:test` PASS, `001-profiles` 6/6.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json supabase
git commit -m "FEAT-002: Add Supabase project with profiles and families"
```

---

### Task 2: Events with personal/shared access rules

**Files:**
- Create: `supabase/migrations/20261006120100_events.sql`
- Test: `supabase/tests/database/002-events.test.sql`

**Interfaces:**
- Consumes: `public.my_family_id()`, `public.profiles`, `public.families` (Task 1); `tests.*` helpers (Task 1)
- Produces:
  - Table `public.events(id, owner_id, family_id, visibility, title, date, start_time, end_time, people, legacy_people, series_id, created_at, updated_at, updated_by, deleted_at)`
  - Trigger `events_guard`: it sets `family_id` from visibility, sets timestamps and `updated_by`, rejects owner changes and non-creator un-sharing (`42501`), and raises `P0001 not_in_family` when sharing without a family
  - Clients may `select`, `insert` and `update`; `delete` is revoked

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/002-events.test.sql`:

```sql
begin;
select plan(17);

-- Alice and Bob are a family; Cara is outside it.
select tests.create_user('11111111-1111-1111-1111-111111111111', 'alice@test.nz', 'Alice');
select tests.create_user('22222222-2222-2222-2222-222222222222', 'bob@test.nz', 'Bob');
select tests.create_user('33333333-3333-3333-3333-333333333333', 'cara@test.nz', 'Cara');
select tests.add_to_family('22222222-2222-2222-2222-222222222222', tests.make_family('11111111-1111-1111-1111-111111111111'));

select tests.login_as('11111111-1111-1111-1111-111111111111');
insert into public.events (id, owner_id, title, date)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alice personal', '2026-10-12');
insert into public.events (id, owner_id, visibility, title, date)
values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'shared', 'Family dinner', '2026-10-12');
insert into public.events (id, owner_id, visibility, title, date)
values ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'shared', 'Swim lesson', '2026-10-13');
reset role;

select is(
  (select family_id from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  tests.family_of('11111111-1111-1111-1111-111111111111'),
  'sharing an event attaches the creator''s family');

select is(
  (select updated_by from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the server records who saved the event');

-- Bob, a family member
select tests.login_as('22222222-2222-2222-2222-222222222222');

select is(
  (select array_agg(title order by title) from public.events),
  array['Family dinner', 'Swim lesson'],
  'a family member sees shared events but not personal ones');

update public.events set title = 'Family dinner at 7', updated_at = '2000-01-01'
 where id = 'aaaaaaaa-0000-0000-0000-000000000002';

select is(
  (select title from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'Family dinner at 7',
  'a family member can edit a shared event');

select cmp_ok(
  (select updated_at from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '>', '2026-01-01'::timestamptz,
  'the client cannot set updated_at');

select is(
  (select updated_by from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'updated_by is whoever last edited');

select throws_ok(
  $$update public.events set visibility = 'personal' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', null,
  'a member cannot make someone else''s shared event personal');

select throws_ok(
  $$delete from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', null,
  'events cannot be hard-deleted');

-- Invisible to Bob, so this changes nothing.
update public.events set title = 'hacked' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

update public.events set deleted_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000003';
select isnt(
  (select deleted_at from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  null,
  'a member can soft-delete a shared event, and the tombstone stays visible for sync');

reset role;
select is(
  (select title from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Alice personal',
  'a member cannot change someone else''s personal event');

-- Cara, outside the family
select tests.login_as('33333333-3333-3333-3333-333333333333');

select is((select count(*)::int from public.events), 0, 'someone outside the family sees nothing');

select throws_ok(
  $$insert into public.events (id, owner_id, title, date)
    values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'Forged', '2026-10-12')$$,
  '42501', null,
  'a user cannot create an event owned by someone else');

select throws_ok(
  $$insert into public.events (id, owner_id, visibility, title, date)
    values (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', 'shared', 'No family', '2026-10-12')$$,
  'P0001', 'not_in_family',
  'sharing needs a family');

select throws_ok(
  $$insert into public.events (id, owner_id, visibility, family_id, title, date)
    values (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', 'shared',
            tests.family_of('11111111-1111-1111-1111-111111111111'), 'Gatecrash', '2026-10-12')$$,
  '42501', null,
  'a user cannot share into another family');

-- Alice, the creator
reset role;
select tests.login_as('11111111-1111-1111-1111-111111111111');

update public.events set visibility = 'personal' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select is(
  (select family_id from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null::uuid,
  'the creator can make a shared event personal, which detaches it from the family');

select throws_ok(
  $$update public.events set owner_id = '22222222-2222-2222-2222-222222222222'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null,
  'an event''s owner cannot be changed');

reset role;
select tests.login_as('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'once personal, the family no longer sees it');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run db:test`
Expected: `002-events` FAIL with `relation "public.events" does not exist`. `001` still passes.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261006120100_events.sql`:

```sql
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
```

- [ ] **Step 4: Apply and run the tests**

```bash
npm run db:reset
npm run db:test
```

Expected: PASS. `002-events` 17/17, earlier files unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "FEAT-002: Add events table with personal/shared row-level security"
```

---

### Task 3: Profiles of family members (closing a Task 1 gap)

Task 1 tested profiles only for users without a family. This task proves members can see each other's profiles but not outsiders'. It's separate so a reviewer can check the policy on its own.

**Files:**
- Modify: `supabase/tests/database/001-profiles.test.sql`

**Interfaces:**
- Consumes: Task 1 policies and helpers. No new SQL objects.

- [ ] **Step 1: Add the tests**

In `001-profiles.test.sql`, change `select plan(6);` to `select plan(8);` and insert before `select * from finish();`:

```sql
-- Family members see each other; outsiders stay hidden.
select tests.create_user('33333333-3333-3333-3333-333333333333', 'cara@test.nz', 'Cara');
select tests.add_to_family('22222222-2222-2222-2222-222222222222', tests.make_family('11111111-1111-1111-1111-111111111111'));

select tests.login_as('22222222-2222-2222-2222-222222222222');
select is(
  (select array_agg(display_name order by display_name) from public.profiles where display_name is not null),
  array['Ali'],
  'a family member sees the other members'' profiles');
select is(
  (select count(*)::int from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  0,
  'profiles outside the family stay hidden');
reset role;
```

(Bob signed up without a display name, so his row is excluded by `display_name is not null`; Alice's is `Ali` after the earlier update.)

- [ ] **Step 2: Run the tests**

Run: `npm run db:test`
Expected: PASS. `001-profiles` 8/8. The policy is already in place, so these pass straight away. If they fail, the `profiles_select` policy from Task 1 is wrong; fix the migration, not the test.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/001-profiles.test.sql
git commit -m "FEAT-002: Test that family members can see each other's profiles"
```

---

### Task 4: Family membership functions

**Files:**
- Create: `supabase/migrations/20261006120200_family_functions.sql`
- Test: `supabase/tests/database/003-family.test.sql`

**Interfaces:**
- Consumes: Tasks 1–2 tables, `my_family_id()`, `generate_invite_code()`
- Produces (callable by `authenticated` via `supabase.rpc`):
  - `create_family(p_name text) returns uuid`; raises `P0001 already_in_family`
  - `join_family(p_code text) returns text`: one of `'joined' | 'invalid_code' | 'rate_limited' | 'already_in_family'` (never raises for these)
  - `leave_family() returns void`
  - `remove_member(p_user uuid) returns void`; raises `P0001 not_family_owner`
  - `regenerate_invite_code() returns text`; raises `P0001 not_family_owner`
- Internal (not callable by clients): `_remove_from_family(p_user uuid)`

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/003-family.test.sql`:

```sql
begin;
select plan(21);

select tests.create_user('11111111-1111-1111-1111-111111111111', 'alice@test.nz', 'Alice');
select tests.create_user('22222222-2222-2222-2222-222222222222', 'bob@test.nz', 'Bob');
select tests.create_user('33333333-3333-3333-3333-333333333333', 'cara@test.nz', 'Cara');
select tests.create_user('44444444-4444-4444-4444-444444444444', 'dan@test.nz', 'Dan');
-- Alice and Bob picked the same tag before either joined a family.
update public.profiles set tag = 'AZ'
 where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

-- Alice creates a family
select tests.login_as('11111111-1111-1111-1111-111111111111');

select isnt(public.create_family('Sheng'), null::uuid, 'a user can create a family');

select throws_ok(
  $$select public.create_family('Again')$$,
  'P0001', 'already_in_family',
  'a user can only be in one family');

select matches(
  tests.invite_code_of('11111111-1111-1111-1111-111111111111'),
  '^[A-HJ-NP-Z2-9]{8}$',
  'invite codes are 8 characters without 0, O, 1 or I');

-- Bob joins
reset role;
select tests.login_as('22222222-2222-2222-2222-222222222222');

select is(public.join_family('WRONGCOD'), 'invalid_code', 'an unknown code is rejected');

select is(
  public.join_family(' ' || lower(tests.invite_code_of('11111111-1111-1111-1111-111111111111')) || ' '),
  'joined',
  'codes ignore case and surrounding spaces');

select is(
  public.join_family(tests.invite_code_of('11111111-1111-1111-1111-111111111111')),
  'already_in_family',
  'joining twice is refused');

select is(
  (select tag from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'a joiner''s tag is cleared when a member already uses it');

select is((select count(*)::int from public.profiles), 2, 'members see each other''s profiles');

select is((select name from public.families), 'Sheng', 'members see their family');

select throws_ok(
  $$select public.remove_member('11111111-1111-1111-1111-111111111111')$$,
  'P0001', 'not_family_owner',
  'only the owner can remove members');

-- Cara guesses codes
reset role;
select tests.login_as('33333333-3333-3333-3333-333333333333');
select public.join_family('WRONG' || g) from generate_series(1, 5) g;

select is(
  public.join_family(tests.invite_code_of('11111111-1111-1111-1111-111111111111')),
  'rate_limited',
  'five failed codes in an hour blocks joining, even with the right code');

select is((select count(*)::int from public.families), 0, 'outsiders cannot see the family');

-- Bob shares an event, then Alice removes him
reset role;
select tests.login_as('22222222-2222-2222-2222-222222222222');
insert into public.events (id, owner_id, visibility, title, date)
values ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'shared', 'Bob''s BBQ', '2026-10-17');

reset role;
select tests.login_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$select public.remove_member('22222222-2222-2222-2222-222222222222')$$,
  'the owner can remove a member');

select is(
  (select title from public.events where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'Bob''s BBQ',
  'a removed member''s shared events stay with the family');

reset role;
select tests.login_as('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.events), 0, 'a removed member loses access to the events they shared');

-- Regenerating the invite code
reset role;
create temp table old_code as select tests.invite_code_of('11111111-1111-1111-1111-111111111111') as code;
grant select on old_code to authenticated;

select tests.login_as('11111111-1111-1111-1111-111111111111');
select public.regenerate_invite_code();

reset role;
select tests.login_as('44444444-4444-4444-4444-444444444444');

select is(public.join_family((select code from old_code)), 'invalid_code', 'the old code stops working');

select is(
  public.join_family(tests.invite_code_of('11111111-1111-1111-1111-111111111111')),
  'joined',
  'the new code works');

-- Alice (owner) leaves: Dan inherits the family
reset role;
select tests.login_as('11111111-1111-1111-1111-111111111111');
select public.leave_family();
reset role;

select is(
  (select owner_id from public.families where id = tests.family_of('44444444-4444-4444-4444-444444444444')),
  '44444444-4444-4444-4444-444444444444'::uuid,
  'when the owner leaves, the longest-standing member becomes owner');

-- Dan, now the last member, shares an event and leaves
select tests.login_as('44444444-4444-4444-4444-444444444444');
insert into public.events (id, owner_id, visibility, title, date)
values ('dddddddd-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'shared', 'Dan''s gig', '2026-10-20');
select public.leave_family();
reset role;

select is((select count(*)::int from public.families), 0, 'the family is deleted when its last member leaves');

select is(
  (select visibility from public.events where id = 'dddddddd-0000-0000-0000-000000000001'),
  'personal',
  'the last member keeps their shared events, as personal events');

select is(
  (select count(*)::int from public.events where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'events left behind by earlier members are deleted with the family');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run db:test`
Expected: `003-family` FAIL with `function public.create_family(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261006120200_family_functions.sql`:

```sql
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
create function public._remove_from_family(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  fam uuid;
  next_owner uuid;
begin
  select family_id into fam from public.profiles where id = p_user;
  if fam is null then
    return;
  end if;
  perform 1 from public.families where id = fam for update;

  update public.profiles set family_id = null, joined_family_at = null where id = p_user;

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
  if public.my_family_id() is not null then
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
  if public.my_family_id() is not null then
    return 'already_in_family';
  end if;
  if (select count(*) from public.join_attempts
       where user_id = uid and attempted_at > now() - interval '1 hour') >= 5 then
    return 'rate_limited';
  end if;

  select id into fam from public.families where invite_code = upper(btrim(p_code));
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
  perform public._remove_from_family(p_user);
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

revoke execute on function public._remove_from_family(uuid) from public, anon, authenticated;
revoke execute on function public.create_family(text), public.join_family(text), public.leave_family(),
  public.remove_member(uuid), public.regenerate_invite_code() from public, anon;
grant execute on function public.create_family(text), public.join_family(text), public.leave_family(),
  public.remove_member(uuid), public.regenerate_invite_code() to authenticated;
```

- [ ] **Step 4: Apply and run the tests**

```bash
npm run db:reset
npm run db:test
```

Expected: PASS. `003-family` 21/21, earlier files unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "FEAT-002: Add family create/join/leave/remove and invite code functions"
```

---

### Task 5: Account deletion, CI, and doc updates

**Files:**
- Create: `supabase/migrations/20261006120300_delete_account.sql`
- Test: `supabase/tests/database/004-delete-account.test.sql`
- Create: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/specs/2026-10-06-accounts-family-sharing-design.md` (§4), `docs/specs/infrastructure.md` (§2.3), `docs/registry/FEAT-002-accounts-family-sharing.md`

**Interfaces:**
- Consumes: `_remove_from_family` (Task 4), events and profiles (Tasks 1–2)
- Produces: `delete_account() returns void`, callable by `authenticated`. It deletes the caller's personal events and auth user; their shared events stay with `owner_id = null`

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/004-delete-account.test.sql`:

```sql
begin;
select plan(8);

select tests.create_user('11111111-1111-1111-1111-111111111111', 'alice@test.nz', 'Alice');
select tests.create_user('22222222-2222-2222-2222-222222222222', 'bob@test.nz', 'Bob');
select tests.create_user('33333333-3333-3333-3333-333333333333', 'cara@test.nz', 'Cara');
select tests.add_to_family('22222222-2222-2222-2222-222222222222', tests.make_family('11111111-1111-1111-1111-111111111111'));

-- Alice (family owner) deletes her account
select tests.login_as('11111111-1111-1111-1111-111111111111');
insert into public.events (id, owner_id, title, date)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alice dentist', '2026-10-12');
insert into public.events (id, owner_id, visibility, title, date)
values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'shared', 'Family picnic', '2026-10-18');
select public.delete_account();
reset role;

select is(
  (select count(*)::int from auth.users where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'the account is deleted');

select is(
  (select count(*)::int from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'personal events are deleted');

select is(
  (select owner_id from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  null::uuid,
  'shared events stay, with no owner (shown as "Former member")');

select is(
  (select owner_id from public.families where id = tests.family_of('22222222-2222-2222-2222-222222222222')),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'ownership passes to the remaining member');

select tests.login_as('22222222-2222-2222-2222-222222222222');
update public.events set title = 'Family picnic (moved)' where id = 'aaaaaaaa-0000-0000-0000-000000000002';

select is(
  (select title from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'Family picnic (moved)',
  'members can still edit a former member''s shared event');

select throws_ok(
  $$update public.events set visibility = 'personal' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', null,
  'nobody can make a former member''s event personal');

-- Cara, alone in her family, deletes her account
reset role;
select tests.make_family('33333333-3333-3333-3333-333333333333');
select tests.login_as('33333333-3333-3333-3333-333333333333');
insert into public.events (id, owner_id, visibility, title, date)
values ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'shared', 'Solo plan', '2026-10-19');
select public.delete_account();
reset role;

select is((select count(*)::int from public.families), 1, 'a family whose only member deletes their account is removed');

select is(
  (select count(*)::int from public.events where id = 'cccccccc-0000-0000-0000-000000000001'),
  0,
  'and their events go with it');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run db:test`
Expected: `004-delete-account` FAIL with `function public.delete_account() does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261006120300_delete_account.sql`:

```sql
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
  delete from public.events where owner_id = uid and visibility = 'personal';
  -- Cascades to profiles; events.owner_id and updated_by become null.
  delete from auth.users where id = uid;
end $$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
```

- [ ] **Step 4: Apply and run the tests**

```bash
npm run db:reset
npm run db:test
```

Expected: PASS. Every file: `001` 8/8, `002` 17/17, `003` 21/21, `004` 8/8.

- [ ] **Step 5: Add CI**

This needs Plan 1's `lint`, `typecheck` and `test` scripts. If Plan 1 isn't merged yet, rebase this branch on it first.

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --ci

  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase db start
      # Re-applies migrations, then seed.sql (the test helpers)
      - run: supabase db reset
      - run: supabase test db
```

- [ ] **Step 6: Update the spec, infrastructure doc and registry**

In `docs/superpowers/specs/2026-10-06-accounts-family-sharing-design.md` §4, replace the first three bullets (select / insert / delete) with:

```markdown
- **select / update:** (`visibility = 'personal'` AND `owner_id = auth.uid()`) OR (`visibility = 'shared'` AND `family_id = my_family_id()`). Creators reach their own shared events through the second clause, so leaving the family removes their access (D7). Updates use the same rule for the new row.
- **insert:** `owner_id = auth.uid()`; if shared, `family_id = my_family_id()` (the trigger fills it in when omitted).
- **delete:** soft delete only (`deleted_at`). Hard `DELETE` is revoked from clients.
- **Last member leaves:** their shared events become personal and the family is deleted, along with events earlier ex-members left in it.
- **join_family** returns a status (`joined` | `invalid_code` | `rate_limited` | `already_in_family`) instead of raising, so failed attempts are recorded.
```

In `docs/specs/infrastructure.md` §2.3, change the tests bullet to: `` `supabase/tests/database/*.test.sql`: pgTAP tests for every access rule; helpers in `supabase/seed.sql` (local only). Run with `npm run db:reset && npm run db:test`. ``

In `docs/registry/FEAT-002-accounts-family-sharing.md`, set `Status` to `In progress` and `Updated` to today. Under the acceptance criteria, tick `pgTAP tests cover every access rule` and leave the rest unticked. Update the FEAT-002 row in `docs/registry/INDEX.md` to `In progress`.

- [ ] **Step 7: Commit**

```bash
git add supabase .github docs
git commit -m "FEAT-002: Add account deletion, CI for app and database tests"
```

- [ ] **Step 8: Push and check CI**

```bash
git push -u origin HEAD
```

Open a PR. Both CI jobs (`app`, `database`) must pass.
