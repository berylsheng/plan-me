begin;
select plan(18);

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

select throws_ok(
  $$update public.events set id = gen_random_uuid()
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null,
  'an event''s id cannot be changed');

reset role;
select tests.login_as('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.events where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'once personal, the family no longer sees it');

select * from finish();
rollback;
