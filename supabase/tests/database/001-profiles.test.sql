begin;
select plan(8);

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

select * from finish();
rollback;
