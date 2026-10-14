begin;
select plan(34);

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

select throws_ok(
  $$select public.regenerate_invite_code()$$,
  'P0001', 'not_family_owner',
  'only the owner can regenerate the invite code');

update public.families set name = 'Hijacked';
reset role;
select is(
  (select name from public.families where id = tests.family_of('11111111-1111-1111-1111-111111111111')),
  'Sheng',
  'a member cannot rename the family');

select tests.login_as('11111111-1111-1111-1111-111111111111');
update public.families set name = 'Sheng whanau';
reset role;
select is(
  (select name from public.families where id = tests.family_of('11111111-1111-1111-1111-111111111111')),
  'Sheng whanau',
  'the owner can rename the family');

-- Cara guesses codes
reset role;
select tests.login_as('33333333-3333-3333-3333-333333333333');
select is(
  (select array_agg(public.join_family('WRONG' || g) order by g) from generate_series(1, 5) g),
  array_fill('invalid_code'::text, array[5]),
  'the first five wrong codes in an hour are each reported as invalid');

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

update public.events set title = 'Mine now';
update public.events set visibility = 'personal';
reset role;
select is(
  (select title || '/' || visibility from public.events where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'Bob''s BBQ/shared',
  'a removed member cannot edit or take back the events they shared');

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

-- Grants and guards
reset role;
select tests.login_as('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$select public._remove_from_family('22222222-2222-2222-2222-222222222222')$$,
  '42501', null,
  'app users cannot call the internal removal helper');
select throws_ok(
  $$select count(*) from public.join_attempts$$,
  '42501', null,
  'app users cannot read join attempts');
reset role;

set local role anon;
select throws_ok(
  $$select public.join_family('ABCDEFGH')$$,
  '42501', null,
  'anonymous users cannot call family functions');
select throws_ok($$select count(*) from public.events$$,   '42501', null, 'anonymous users cannot read events');
select throws_ok($$select count(*) from public.profiles$$, '42501', null, 'anonymous users cannot read profiles');
select throws_ok($$select count(*) from public.families$$, '42501', null, 'anonymous users cannot read families');
reset role;

select tests.login_as('44444444-4444-4444-4444-444444444444');
select is(public.create_family('Dan solo') is not null, true, 'a user can create a family again after leaving');
select throws_ok(
  $$select public.remove_member('44444444-4444-4444-4444-444444444444')$$,
  'P0001', 'not_family_owner',
  'an owner cannot remove themselves (they leave instead)');
reset role;

select * from finish();
rollback;
