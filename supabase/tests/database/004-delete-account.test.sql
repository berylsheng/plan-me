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
