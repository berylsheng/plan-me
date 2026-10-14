begin;
select plan(7);

select tests.create_user('11111111-1111-1111-1111-111111111111', 'alice@test.nz', 'Alice');
select tests.login_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into public.events (id, owner_id, title, date, series_id, repeat)
    values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Swim', '2026-10-13',
            'cccccccc-0000-0000-0000-000000000001', '{"every": 1, "unit": "week", "until": "2026-11-09"}')$$,
  'a valid repeat rule is saved');

select lives_ok(
  $$insert into public.events (id, owner_id, title, date)
    values ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Dentist', '2026-10-14')$$,
  'an event without a rule is saved');

select throws_ok(
  $$insert into public.events (id, owner_id, title, date, repeat)
    values ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Swim', '2026-10-13',
            '{"every": 0, "unit": "week", "until": "2026-11-09"}')$$,
  '23514', null, 'every must be from 1 to 99');

select throws_ok(
  $$insert into public.events (id, owner_id, title, date, repeat)
    values ('bbbbbbbb-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Swim', '2026-10-13',
            '{"every": 1, "unit": "year", "until": "2026-11-09"}')$$,
  '23514', null, 'unit must be day, week or month');

select throws_ok(
  $$insert into public.events (id, owner_id, title, date, repeat)
    values ('bbbbbbbb-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Swim', '2026-10-13',
            '{"every": 1, "unit": "week", "until": "2026-02-30"}')$$,
  '23514', null, 'until must be a real date');

select throws_ok(
  $$insert into public.events (id, owner_id, title, date, repeat)
    values ('bbbbbbbb-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Swim', '2026-10-13',
            '{"every": 1, "unit": "week", "until": "2026-11-09", "extra": true}')$$,
  '23514', null, 'a rule has exactly every, unit and until');

select is(
  (select repeat->>'until' from public.events where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  '2026-11-09',
  'the rule reads back');

select * from finish();
rollback;
