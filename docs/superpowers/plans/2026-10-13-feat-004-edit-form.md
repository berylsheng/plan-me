# FEAT-004 Event Edit Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping Edit opens a full-screen form where every field of an event — including how it repeats and when it ends — can be changed, for one occurrence or this and all future ones.

**Architecture:** Each occurrence of a repeating event keeps the repeat rule in a new nullable `repeat jsonb` column next to its `series_id`. Pure modules (`lib/events/repeat.ts`, `lib/events/editForm.ts`) turn the form into a set of creates, updates and deletes; a new sync-engine method `apply` stores that set in one write, and the existing outbox sends it. The sentence box keeps adding events and now builds the same rule (fixing BUG-004); editing no longer re-parses a sentence (fixing BUG-005).

**Tech Stack:** Expo SDK 54, expo-router 6, React 19.1 / RN 0.81, TypeScript strict, Jest (jest-expo) + RNTL 12.9, Supabase (Postgres, pgTAP), react-native-calendars, `@react-native-community/datetimepicker` 8.4.4.

**Spec:** `docs/superpowers/specs/2026-10-12-event-edit-form-design.md`

## Global Constraints

- Read the Expo SDK 54 docs (https://docs.expo.dev/versions/v54.0.0/) before adding a package; install with `npx expo install`, which picks the SDK 54 version (`@react-native-community/datetimepicker` → 8.4.4).
- Dates show as dd/mm/yyyy, NZ time; date keys stay `yyyy-mm-dd`. NZ English in all copy.
- Event name: required, at most 200 characters. `RepeatRule.every` 1–99; `until` inclusive and at most 1 year after the first date.
- Never connect to the hosted Supabase project, never push, never pass `--include-seed`. Local Supabase only (`npm run db:reset`, `npm run db:test`, `npm run test:integration`).
- Subagents never dispatch subagents.
- Test names containing an apostrophe use double quotes. `jest.mock` factories may only reference variables prefixed `mock` (or `require` inside the factory).
- Every task ends with `npm test`, `npm run typecheck` and `npm run lint` passing. If typecheck rejects a new route because `.expo/types/router.d.ts` is stale, delete that file (it's regenerated, git-ignored).
- Commit messages start `FEAT-004: ` (or `BUG-004: ` / `BUG-005: ` where named), are plain-English sentences, and end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never log or display `AuthResult.code`. Never add the service-role key anywhere.

## Review Focus

1. **Monthly on the 29th–31st** → falls on the month's last day in shorter months and never skips a month (31 Jan → 28 Feb → 31 Mar). Pinned in Task 2.
2. **A family member edits someone else's shared series** → Repeat and Ends on are locked with "Only Bob can change how this repeats."; their other edits keep every event's owner. Pinned in Tasks 6 and 8.
3. **The event is deleted elsewhere while the form is open** → "This event was deleted." with Back; nothing is re-created. Pinned in Task 8.
4. **A series made before this change** (no stored rule, a gap left by "delete this event only") → the form shows Weekly with the right end date, and renaming it doesn't re-create anything. Pinned in Task 6.
5. **The phone can't store the edit** → "Couldn't save. Try again." and the form stays open with the edits. Pinned in Tasks 5 and 8.

---

### Task 1: Store a repeat rule on events

**Files:**
- Create: `supabase/migrations/20261013120000_event_repeat.sql`
- Create: `supabase/tests/database/005-event-repeat.test.sql`

**Interfaces:**
- Produces: column `public.events.repeat jsonb null`, function `public.is_repeat_rule(jsonb) returns boolean`, constraint `events_repeat_shape`.

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/database/005-event-repeat.test.sql`:

```sql
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run db:test`
Expected: FAIL in `005-event-repeat.test.sql` — `column "repeat" of relation "events" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261013120000_event_repeat.sql`:

```sql
-- FEAT-004: the repeat rule of a recurring event, kept on each of its occurrences.

-- { "every": 1-99, "unit": "day" | "week" | "month", "until": "yyyy-mm-dd" } and nothing else.
create function public.is_repeat_rule(r jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(r) is distinct from 'object'
     or not (r ?& array['every', 'unit', 'until'])
     or (r - array['every', 'unit', 'until']) <> '{}'::jsonb then
    return false;
  end if;
  if jsonb_typeof(r->'every') <> 'number' or (r->>'every') !~ '^[0-9]{1,2}$' or (r->>'every')::int < 1 then
    return false;
  end if;
  if jsonb_typeof(r->'unit') <> 'string' or (r->>'unit') not in ('day', 'week', 'month') then
    return false;
  end if;
  if jsonb_typeof(r->'until') <> 'string' or (r->>'until') !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  return to_char((r->>'until')::date, 'YYYY-MM-DD') = r->>'until';
exception when others then
  return false; -- e.g. 2026-02-30
end $$;

alter table public.events add column repeat jsonb;
alter table public.events add constraint events_repeat_shape check (repeat is null or public.is_repeat_rule(repeat));
```

- [ ] **Step 4: Run the database tests**

Run: `npm run db:reset` then `npm run db:test`
Expected: all files pass, including `005-event-repeat.test.sql` (7 tests) and the existing `002-events.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261013120000_event_repeat.sql supabase/tests/database/005-event-repeat.test.sql
git commit -m "FEAT-004: Store how a recurring event repeats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Repeat rules and date helpers

**Files:**
- Create: `lib/events/repeat.ts`
- Create: `lib/events/__tests__/repeat.test.ts`
- Modify: `lib/dates.ts` (add two display helpers)
- Create: `lib/__tests__/dates.test.ts` (or add to the existing dates test if there is one — `ls lib/__tests__` first)

**Interfaces:**
- Produces (`lib/events/repeat.ts`):
  - `type RepeatUnit = 'day' | 'week' | 'month'`
  - `type RepeatRule = { every: number; unit: RepeatUnit; until: string }`
  - `type RepeatPreset = 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'custom'`
  - `MAX_EVERY = 99`
  - `isDateKey(v: unknown): v is string`, `isRepeatRule(v: unknown): v is RepeatRule`
  - `addDays(key: string, n: number): string`, `addMonths(key: string, n: number): string`, `daysBetween(from: string, to: string): number`
  - `latestUntil(start: string): string` (start + 12 months)
  - `occurrenceDates(start: string, rule: RepeatRule): string[]`
  - `inferRule(dates: readonly string[]): RepeatRule | null`
  - `presetOf(rule: Pick<RepeatRule, 'every' | 'unit'> | null): RepeatPreset`
  - `PRESET_RULES: Record<'daily' | 'weekly' | 'fortnightly' | 'monthly', Pick<RepeatRule, 'every' | 'unit'>>`
- Produces (`lib/dates.ts`): `formatDateKey(key: string): string` ('2026-10-13' → '13/10/2026'), `formatClock(time: string): string` ('18:30' → '6:30 pm', '00:05' → '12:05 am', '12:00' → '12:00 pm').

- [ ] **Step 1: Write the failing tests**

`lib/events/__tests__/repeat.test.ts`:

```ts
import {
  addDays,
  addMonths,
  daysBetween,
  inferRule,
  isRepeatRule,
  latestUntil,
  occurrenceDates,
  presetOf,
} from '../repeat';

describe('date key arithmetic', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('keeps the day of month, or the last day when the month is shorter', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2027-01-31', 2)).toBe('2027-03-31');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('counts days between two dates, ignoring daylight saving', () => {
    expect(daysBetween('2026-09-26', '2026-09-28')).toBe(2); // NZ daylight saving starts 27/09/2026
    expect(daysBetween('2026-10-20', '2026-10-13')).toBe(-7);
  });

  it('allows a series to run for at most a year', () => {
    expect(latestUntil('2026-10-13')).toBe('2027-10-13');
  });
});

describe('isRepeatRule', () => {
  it('accepts a rule', () => {
    expect(isRepeatRule({ every: 2, unit: 'week', until: '2026-12-01' })).toBe(true);
  });

  it.each([
    ['every 0', { every: 0, unit: 'week', until: '2026-12-01' }],
    ['every 100', { every: 100, unit: 'week', until: '2026-12-01' }],
    ['every 1.5', { every: 1.5, unit: 'week', until: '2026-12-01' }],
    ['unit year', { every: 1, unit: 'year', until: '2026-12-01' }],
    ['until 30 February', { every: 1, unit: 'week', until: '2026-02-30' }],
    ['no until', { every: 1, unit: 'week' }],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isRepeatRule(value)).toBe(false);
  });
});

describe('occurrenceDates', () => {
  it('starts on the first date and includes the end date', () => {
    expect(occurrenceDates('2026-10-13', { every: 1, unit: 'week', until: '2026-11-03' })).toEqual([
      '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03',
    ]);
  });

  it('steps every N days', () => {
    expect(occurrenceDates('2026-10-13', { every: 3, unit: 'day', until: '2026-10-21' })).toEqual([
      '2026-10-13', '2026-10-16', '2026-10-19',
    ]);
  });

  it('keeps month-end dates on the last day of shorter months, without skipping one', () => {
    expect(occurrenceDates('2027-01-31', { every: 1, unit: 'month', until: '2027-04-30' })).toEqual([
      '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30',
    ]);
  });

  it('stops a year after the first date', () => {
    const dates = occurrenceDates('2026-10-13', { every: 1, unit: 'day', until: '2028-10-13' });
    expect(dates).toHaveLength(366);
    expect(dates[dates.length - 1]).toBe('2027-10-13');
  });

  it('gives nothing when the end is before the start', () => {
    expect(occurrenceDates('2026-10-13', { every: 1, unit: 'week', until: '2026-10-12' })).toEqual([]);
  });
});

describe('presetOf', () => {
  it.each([
    [null, 'none'],
    [{ every: 1, unit: 'day' }, 'daily'],
    [{ every: 1, unit: 'week' }, 'weekly'],
    [{ every: 2, unit: 'week' }, 'fortnightly'],
    [{ every: 1, unit: 'month' }, 'monthly'],
    [{ every: 3, unit: 'week' }, 'custom'],
    [{ every: 2, unit: 'day' }, 'custom'],
  ] as const)('%j is %s', (rule, preset) => {
    expect(presetOf(rule)).toBe(preset);
  });
});

describe('inferRule', () => {
  it('reads a weekly series', () => {
    expect(inferRule(['2026-10-13', '2026-10-20', '2026-10-27'])).toEqual({ every: 1, unit: 'week', until: '2026-10-27' });
  });

  it('uses the smallest gap when an occurrence was deleted', () => {
    expect(inferRule(['2026-10-13', '2026-10-27', '2026-11-03'])).toEqual({ every: 1, unit: 'week', until: '2026-11-03' });
  });

  it('reads months, including month-end dates', () => {
    expect(inferRule(['2027-01-31', '2027-02-28', '2027-03-31'])).toEqual({ every: 1, unit: 'month', until: '2027-03-31' });
  });

  it('reads every N days', () => {
    expect(inferRule(['2026-10-13', '2026-10-16', '2026-10-19'])).toEqual({ every: 3, unit: 'day', until: '2026-10-19' });
  });

  it('gives no rule for a single date', () => {
    expect(inferRule(['2026-10-13'])).toBeNull();
  });
});
```

`lib/__tests__/dates.test.ts` (add these cases):

```ts
import { formatClock, formatDateKey } from '../dates';

describe('display formats', () => {
  it('shows dates as dd/mm/yyyy', () => {
    expect(formatDateKey('2026-10-03')).toBe('03/10/2026');
  });

  it.each([
    ['18:30', '6:30 pm'],
    ['00:05', '12:05 am'],
    ['12:00', '12:00 pm'],
    ['09:00', '9:00 am'],
  ])('shows %s as %s', (time, shown) => {
    expect(formatClock(time)).toBe(shown);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/events/__tests__/repeat.test.ts lib/__tests__/dates.test.ts`
Expected: FAIL — `Cannot find module '../repeat'` and `formatClock is not a function`.

- [ ] **Step 3: Implement**

`lib/events/repeat.ts`:

```ts
/** How a recurring event repeats. Every occurrence of a series carries the same rule. */
export type RepeatUnit = 'day' | 'week' | 'month';
export type RepeatRule = { every: number; unit: RepeatUnit; until: string /* 'yyyy-mm-dd', inclusive */ };
export type RepeatPreset = 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'custom';

export const MAX_EVERY = 99;
const DAY_MS = 86_400_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const UNITS: readonly string[] = ['day', 'week', 'month'];

export const PRESET_RULES = {
  daily: { every: 1, unit: 'day' },
  weekly: { every: 1, unit: 'week' },
  fortnightly: { every: 2, unit: 'week' },
  monthly: { every: 1, unit: 'month' },
} as const satisfies Record<string, Pick<RepeatRule, 'every' | 'unit'>>;

// Date keys are calendar dates: do the arithmetic in UTC so daylight saving never shifts a day.
const toUtc = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const isDateKey = (v: unknown): v is string => typeof v === 'string' && DATE_KEY.test(v) && fromUtc(toUtc(v)) === v;

export function isRepeatRule(v: unknown): v is RepeatRule {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    Number.isInteger(r.every) &&
    (r.every as number) >= 1 &&
    (r.every as number) <= MAX_EVERY &&
    typeof r.unit === 'string' &&
    UNITS.includes(r.unit) &&
    isDateKey(r.until)
  );
}

export const addDays = (key: string, n: number): string => fromUtc(toUtc(key) + n * DAY_MS);

export const daysBetween = (from: string, to: string): number => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

/** The same day of month n months on, or that month's last day when it is shorter. */
export function addMonths(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const index = m - 1 + n;
  const year = y + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(year, month, Math.min(d, lastDay)));
}

/** A series ends at most a year after its first date. */
export const latestUntil = (start: string): string => addMonths(start, 12);

/** The dates of a series: the start, then every step up to and including `until` (at most a year). */
export function occurrenceDates(start: string, rule: RepeatRule): string[] {
  const limit = rule.until < latestUntil(start) ? rule.until : latestUntil(start);
  const dates: string[] = [];
  for (let i = 0; ; i++) {
    // Monthly steps count from the start, so 31 Jan → 28 Feb → 31 Mar.
    const key = rule.unit === 'month' ? addMonths(start, i * rule.every) : addDays(start, i * rule.every * (rule.unit === 'week' ? 7 : 1));
    if (key > limit) return dates;
    dates.push(key);
  }
}

const monthsApart = (from: string, to: string): number => {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};

/** The rule a series without one (made before rules were stored) most likely had. `dates` sorted, unique. */
export function inferRule(dates: readonly string[]): RepeatRule | null {
  if (dates.length < 2) return null;
  const first = dates[0];
  const until = dates[dates.length - 1];
  const months = dates.map(d => monthsApart(first, d));
  if (dates.every((d, i) => months[i] > 0 === i > 0 && addMonths(first, months[i]) === d)) {
    const every = Math.min(...months.slice(1).map((m, i) => m - months[i]));
    return { every: Math.min(every, MAX_EVERY), unit: 'month', until };
  }
  const gap = Math.min(...dates.slice(1).map((d, i) => daysBetween(dates[i], d)));
  if (gap % 7 === 0 && gap / 7 <= MAX_EVERY) return { every: gap / 7, unit: 'week', until };
  return { every: Math.min(gap, MAX_EVERY), unit: 'day', until };
}

export function presetOf(rule: Pick<RepeatRule, 'every' | 'unit'> | null): RepeatPreset {
  if (!rule) return 'none';
  for (const [preset, value] of Object.entries(PRESET_RULES)) {
    if (value.every === rule.every && value.unit === rule.unit) return preset as RepeatPreset;
  }
  return 'custom';
}
```

Append to `lib/dates.ts`:

```ts
/** 'yyyy-mm-dd' → 'dd/mm/yyyy'. */
export const formatDateKey = (key: string): string => {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};

/** 'HH:mm' → '6:30 pm'. */
export const formatClock = (time: string): string => {
  const [h, m] = time.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
```

- [ ] **Step 4: Run the tests**

Run: `npx jest lib/events/__tests__/repeat.test.ts lib/__tests__/dates.test.ts`
Expected: PASS. Then `npm test`, `npm run typecheck`, `npm run lint` pass.

- [ ] **Step 5: Commit**

```bash
git add lib/events/repeat.ts lib/events/__tests__/repeat.test.ts lib/dates.ts lib/__tests__/dates.test.ts
git commit -m "FEAT-004: Work out the dates of a repeating event from its rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The sentence box builds a rule (BUG-004)

**Files:**
- Modify: `lib/events/types.ts` (add `repeat?` to `LocalEvent`)
- Modify: `lib/parse/recurrence.ts`
- Modify: `lib/parse/parseEventInput.ts`
- Modify: `lib/events/items.ts` (`draftToEvents`)
- Test: `lib/parse/__tests__/recurrence.test.ts`, `lib/parse/__tests__/parseEventInput.test.ts`, `lib/events/__tests__/items.test.ts`

**Interfaces:**
- Consumes: `RepeatRule`, `addDays`, `addMonths`, `latestUntil`, `occurrenceDates`, `MAX_EVERY` from Task 2.
- Produces:
  - `LocalEvent.repeat?: RepeatRule`
  - `Recurrence = { cleanText: string; ruleFor: (start: string) => RepeatRule }` (replaces `generateDates`)
  - `EventDraft.repeat: RepeatRule | null` (alongside the existing `isRecurring`, which becomes `repeat !== null`)
  - `draftToEvents` sets `repeat` on each event when `seriesId` is given and `draft.repeat` is set.

Meaning of "for N weeks/months" (BUG-004 ruling): a window starting on the first date; the rule's `until` is the day before the window ends, capped at `latestUntil(start)`. So `weekly for 4 weeks` makes 4 events.

- [ ] **Step 1: Update the tests to the fixed behaviour**

Replace the body of `lib/parse/__tests__/recurrence.test.ts` with:

```ts
import { occurrenceDates } from '../../events/repeat';
import { parseRecurrence } from '../recurrence';

const datesFor = (text: string, start: string) => occurrenceDates(start, parseRecurrence(text)!.ruleFor(start));

describe('parseRecurrence', () => {
  it('returns null when there is no recurrence phrase', () => {
    expect(parseRecurrence('dinner tomorrow 6pm')).toBeNull();
  });

  it('removes the phrase (and its leading comma) from the text', () => {
    expect(parseRecurrence('swim, 13 October 7am, weekly for 4 weeks')?.cleanText).toBe('swim, 13 October 7am');
  });

  it('weekly for 4 weeks makes 4 events (BUG-004)', () => {
    expect(parseRecurrence('swim weekly for 4 weeks')!.ruleFor('2026-10-13')).toEqual({ every: 1, unit: 'week', until: '2026-11-09' });
    expect(datesFor('swim weekly for 4 weeks', '2026-10-13')).toEqual(['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']);
  });

  it('every 2 weeks for 2 months uses calendar months', () => {
    expect(datesFor('gym every 2 weeks for 2 months', '2026-10-15')).toEqual([
      '2026-10-15', '2026-10-29', '2026-11-12', '2026-11-26', '2026-12-10',
    ]);
  });

  it('monthly for 3 months makes 3 events', () => {
    expect(datesFor('rent, monthly for 3 months', '2026-11-01')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });

  it('daily for 2 weeks makes 14 events', () => {
    expect(datesFor('stretch daily for 2 weeks', '2026-10-13')).toHaveLength(14);
  });

  it('fortnightly is every 2 weeks', () => {
    expect(parseRecurrence('swim fortnightly for 2 months')!.ruleFor('2026-10-13')).toMatchObject({ every: 2, unit: 'week' });
  });

  it('stops a year after the first date', () => {
    expect(parseRecurrence('swim weekly for 18 months')!.ruleFor('2026-10-13').until).toBe('2027-10-13');
  });

  it('treats every 0 days as every day', () => {
    expect(parseRecurrence('pills every 0 days for 1 weeks')!.ruleFor('2026-10-13')).toMatchObject({ every: 1, unit: 'day' });
  });

  it('is case-insensitive', () => {
    expect(parseRecurrence('yoga Daily For 2 Weeks')?.cleanText).toBe('yoga');
  });
});
```

In `lib/parse/__tests__/parseEventInput.test.ts`, change the case "expands recurrence into date keys, starting with the first date" to:

```ts
  it('expands recurrence into date keys, starting with the first date', () => {
    expect(draftOf('swim, 13 October 7am, weekly for 4 weeks')).toEqual({
      name: 'swim', startTime: '07:00', endTime: '', people: [],
      dateKeys: ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'],
      isRecurring: true,
      repeat: { every: 1, unit: 'week', until: '2026-11-09' },
    });
  });
```

and add `repeat: null` to every other `toEqual` draft in that file (the non-recurring ones at lines ~17, 24, 35).

In `lib/events/__tests__/items.test.ts`, inside `describe('draftToEvents')`, add `repeat: null` to the drafts it builds, and add:

```ts
  it('puts the rule on each occurrence of a series', () => {
    const rule = { every: 1, unit: 'week', until: '2026-10-20' } as const;
    const events = draftToEvents(
      { name: 'swim', startTime: '07:00', endTime: '', people: [], dateKeys: ['2026-10-13', '2026-10-20'], isRecurring: true, repeat: rule },
      counter(),
      's1',
    );
    expect(events.map(e => e.repeat)).toEqual([rule, rule]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/parse lib/events/__tests__/items.test.ts`
Expected: FAIL — `ruleFor is not a function`, drafts missing `repeat`, and 5 dates instead of 4.

- [ ] **Step 3: Implement**

`lib/events/types.ts`: add `import type { RepeatRule } from './repeat';` and the field `repeat?: RepeatRule; // how the series repeats (FEAT-004)` after `occurrenceId`.

`lib/parse/recurrence.ts`, whole file:

```ts
import { addDays, addMonths, latestUntil, MAX_EVERY, type RepeatRule, type RepeatUnit } from '../events/repeat';

export type Recurrence = {
  /** The input with the recurrence phrase removed. */
  cleanText: string;
  /** The rule for a series starting on `start` ('yyyy-mm-dd'). */
  ruleFor: (start: string) => RepeatRule;
};

const KEYWORDS: Record<string, { every: number; unit: RepeatUnit }> = {
  daily: { every: 1, unit: 'day' },
  weekly: { every: 1, unit: 'week' },
  fortnightly: { every: 2, unit: 'week' },
  monthly: { every: 1, unit: 'month' },
};

// Parse recurrence patterns like "weekly for 4 months", "daily for 2 weeks", "every 2 weeks for 6 months".
// "for N weeks|months" is a window from the first date: the series ends the day before it closes.
export const parseRecurrence = (text: string): Recurrence | null => {
  const pattern = /,?\s*(?:(daily|weekly|fortnightly|monthly)|every\s+(\d+)\s+(days?|weeks?|months?))\s+for\s+(\d+)\s+(weeks?|months?)/i;
  const match = text.match(pattern);
  if (!match) return null;

  const step = match[1]
    ? KEYWORDS[match[1].toLowerCase()]
    : {
        every: Math.min(Math.max(parseInt(match[2], 10), 1), MAX_EVERY),
        unit: match[3].toLowerCase().replace(/s$/, '') as RepeatUnit,
      };
  const duration = parseInt(match[4], 10);
  const inMonths = match[5].toLowerCase().startsWith('month');

  return {
    cleanText: text.replace(match[0], '').trim(),
    ruleFor: (start: string): RepeatRule => {
      const windowEnd = inMonths ? addMonths(start, duration) : addDays(start, duration * 7);
      const until = addDays(windowEnd, -1);
      const cap = latestUntil(start);
      return { ...step, until: until > cap ? cap : until < start ? start : until };
    },
  };
};
```

`lib/parse/parseEventInput.ts`:
- `EventDraft` gains `repeat: RepeatRule | null; // the series' rule, null for a single event` (import the type from `'../events/repeat'`, plus `occurrenceDates`).
- Replace the "base date + any recurring dates" block and the return with:

```ts
  // The base date + any recurring dates
  const rule = recurrence ? recurrence.ruleFor(dateKey) : null;
  const dateKeys = rule ? occurrenceDates(dateKey, rule) : [dateKey];
  const repeat = rule && dateKeys.length > 1 ? rule : null;

  return {
    ok: true,
    draft: { name, startTime: startTimeStr, endTime: endTimeStr, people, dateKeys: repeat ? dateKeys : [dateKey], isRecurring: repeat !== null, repeat },
  };
```

- `baseDateObj` is no longer needed for recurrence; leave it where the time code still uses it.

`lib/events/items.ts`, in `draftToEvents`, after `if (seriesId) event.occurrenceId = seriesId;` add:

```ts
    if (seriesId && draft.repeat) event.repeat = draft.repeat;
```

Update the BUG-004 note: remove the `// BUG-004` comments from the tests you changed. Search for other callers of `generateDates` (`grep -rn generateDates app lib components`) — there should be none left.

- [ ] **Step 4: Run the tests**

Run: `npx jest lib/parse lib/events/__tests__/items.test.ts` → PASS. Then `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add lib/events/types.ts lib/parse lib/events/items.ts lib/events/__tests__/items.test.ts
git commit -m "BUG-004: Make 'weekly for 4 weeks' create 4 events, and keep the rule on each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sync the rule

**Files:**
- Modify: `lib/events/rows.ts`
- Modify: `lib/events/pull.ts` (`EVENT_COLUMNS`)
- Modify: `context/EventsProvider.tsx` (`updateEvent` keeps `repeat`)
- Test: `lib/events/__tests__/rows.test.ts`, `context/__tests__/EventsProvider.test.tsx`, `lib/events/__tests__/syncEngine.integration.test.ts`

**Interfaces:**
- Consumes: `RepeatRule`, `isRepeatRule` (Task 2); `LocalEvent.repeat` (Task 3).
- Produces:
  - `EventRow.repeat?: RepeatRule | null` (optional so rows from older payloads still validate)
  - `isEventRow` accepts `repeat` undefined, null or a valid rule; `isEventRecord` accepts `repeat` undefined or a valid rule
  - `recordFromRow` sets `record.repeat` only when the row has both `series_id` and a rule
  - `updatePayload(r).repeat` = `r.repeat` when the record has a valid series id, else `null` (so `insertPayload` sends it too)
  - `EVENT_COLUMNS` ends `…, series_id, repeat, updated_at, deleted_at`
  - `EventsProvider.updateEvent` passes `repeat: event.repeat`, via a module-level helper `withInput(existing: EventRecord, event: EventInput): EventRecord` that Task 5 reuses.

- [ ] **Step 1: Write the failing tests**

In `lib/events/__tests__/rows.test.ts`:
- Add `repeat: null` to the expected objects in "sends every column the client may set on insert" and "never changes id or owner on update".
- Add:

```ts
describe('repeat rules', () => {
  const rule = { every: 1, unit: 'week', until: '2026-11-24' } as const;
  const series = '11111111-2222-4333-8444-555555555555';

  it('reads the rule of a series', () => {
    expect(recordFromRow({ ...row(), series_id: series, repeat: rule }).repeat).toEqual(rule);
  });

  it('ignores a rule without a series', () => {
    expect(recordFromRow({ ...row(), series_id: null, repeat: rule }).repeat).toBeUndefined();
  });

  it('sends the rule with the series, and null without one', () => {
    expect(updatePayload({ ...record(), occurrenceId: series, repeat: rule }).repeat).toEqual(rule);
    expect(updatePayload({ ...record(), repeat: rule }).repeat).toBeNull();
  });

  it('rejects a stored record with a broken rule', () => {
    expect(isEventRecord({ ...record(), repeat: { every: 0, unit: 'week', until: '2026-11-24' } })).toBe(false);
    expect(isEventRow({ ...row(), repeat: 'weekly' })).toBe(false);
    expect(isEventRow({ ...row(), repeat: null })).toBe(true);
  });
});
```

(`row()` and `record()` are the file's existing fixtures; import `isEventRow`/`isEventRecord` if not imported yet.)

In `context/__tests__/EventsProvider.test.tsx`, next to the existing `updateEvent` test at line ~145, add a test that updating a record that has `occurrenceId` and `repeat` passes both to `engine().updated[0]` — copy the setup of the test at line 145 and assert `expect(engine().updated[0].repeat).toEqual(rule)`.

In `lib/events/__tests__/syncEngine.integration.test.ts`, add to the `describe`:

```ts
  it('keeps the repeat rule of a recurring event through the server', async () => {
    const alice = await phone('engine');
    const rule = { every: 1, unit: 'week' as const, until: '2026-11-24' };
    const first = startEngine(alice);
    await first.engine.start();
    const swim = record(alice.userId, { occurrenceId: randomUUID(), repeat: rule });
    await first.engine.create([swim]);
    await first.engine.sync();

    const second = startEngine(alice);
    await second.engine.start();
    await second.engine.sync(true);
    expect(second.latest().records[swim.id].repeat).toEqual(rule);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/events/__tests__/rows.test.ts context/__tests__/EventsProvider.test.tsx`
Expected: FAIL — payloads lack `repeat`, `recordFromRow` drops it.

- [ ] **Step 3: Implement**

`lib/events/rows.ts`:
- `import { isRepeatRule, type RepeatRule } from './repeat';`
- `EventRow`: add `repeat?: RepeatRule | null; // FEAT-004` after `series_id`.
- `isEventRow`: add `(r.repeat === undefined || r.repeat === null || isRepeatRule(r.repeat)) &&`.
- `isEventRecord`: add `(r.repeat === undefined || isRepeatRule(r.repeat)) &&`.
- `recordFromRow`: after the `series_id` line add `if (row.series_id && row.repeat) record.repeat = row.repeat;`.
- `updatePayload`: add `repeat: seriesOf(r.occurrenceId) && r.repeat ? r.repeat : null,` after `series_id`.

`lib/events/pull.ts`: `EVENT_COLUMNS` becomes
`'id, owner_id, family_id, visibility, title, date, start_time, end_time, people, legacy_people, series_id, repeat, updated_at, deleted_at'`.

`context/EventsProvider.tsx`: add above the component

```tsx
/** An event from the planner laid over the stored record: its fields win, who sees it stays unless given. */
const withInput = (existing: EventRecord, event: EventInput): EventRecord => ({
  ...existing,
  dateKey: event.dateKey,
  name: event.name,
  startTime: event.startTime,
  endTime: event.endTime,
  people: event.people,
  occurrenceId: event.occurrenceId,
  repeat: event.repeat,
  visibility: event.visibility ?? existing.visibility,
  memberIds: event.memberIds ?? existing.memberIds,
});
```

and make `updateEvent` call `void engineRef.current?.update(withInput(existing, event));`. (`TagMappingPrompt` passes spread records, so their rule is kept.)

- [ ] **Step 4: Run the tests**

Run: `npx jest lib/events context` → PASS. Then with local Supabase running: `npm run db:reset` and `npm run test:integration` → PASS (including the new case). Then `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add lib/events/rows.ts lib/events/pull.ts context/EventsProvider.tsx lib/events/__tests__/rows.test.ts context/__tests__/EventsProvider.test.tsx lib/events/__tests__/syncEngine.integration.test.ts
git commit -m "FEAT-004: Sync the repeat rule with each occurrence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Save a whole edit in one write

**Files:**
- Modify: `lib/events/syncEngine.ts` (interface `SyncEngineLike` and class `SyncEngine`)
- Modify: `test-utils/fakeEngine.ts`
- Modify: `lib/events/rows.ts` (export `FormChanges`)
- Modify: `context/EventsProvider.tsx` (new `saveEventChanges`)
- Test: `lib/events/__tests__/syncEngine.test.ts`, `context/__tests__/EventsProvider.test.tsx`

**Interfaces:**
- Consumes: `withInput` (Task 4), `newRecord` (rows.ts), `dropFromClaim` (already used by `deleteEvents`).
- Produces:
  - `export type EventChanges = { remove: string[]; update: EventRecord[]; create: EventRecord[] }` (syncEngine.ts)
  - `SyncEngineLike.apply(changes: EventChanges): Promise<boolean>` — true once stored on the phone
  - `FakeEngine.applied: EventChanges[]`, `FakeEngine.applyResult = true`
  - `export type FormChanges = { remove: string[]; update: EventInput[]; create: EventInput[] }` (exported from `lib/events/rows.ts`, next to `EventInput`; Task 6 and `EventsProvider` import it from there)
  - `EventsValue.saveEventChanges(changes: FormChanges): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

In `lib/events/__tests__/syncEngine.test.ts` (it has `staticClient`, `ok`, `rec`, `engines`, `memoryStorage`; add `loadUserData` to the `../store` import if missing):

```ts
  it('applies an edit that removes, updates and creates events in one save', async () => {
    const storage = memoryStorage();
    let records: Record<string, EventRecord> = {};
    const engine = new SyncEngine({
      client: staticClient(ok), userId: 'user-apply', storage, canSync: false, realtime: false,
      onChange: next => { records = next; },
    });
    engines.push(engine);
    await engine.start();
    const a = rec('user-apply');
    const b = rec('user-apply');
    await engine.create([a, b]);
    const setItem = jest.spyOn(storage, 'setItem');
    const c = rec('user-apply');

    expect(await engine.apply({ remove: [a.id], update: [{ ...b, name: 'Swim club' }], create: [c] })).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(3); // one save: outbox, records, sync state
    expect(Object.keys(records).sort()).toEqual([b.id, c.id].sort());
    expect(records[b.id].name).toBe('Swim club');
    expect(engine.pending).toBe(2); // a was never sent, so its create is cancelled: b's create (folded edit) and c's create
    expect((await loadUserData(storage, 'user-apply')).records[c.id]).toBeDefined();
  });

  it('says when an edit could not be stored on the phone', async () => {
    const storage = memoryStorage();
    const engine = new SyncEngine({ client: staticClient(ok), userId: 'user-apply2', storage, canSync: false, realtime: false, onChange: () => {} });
    engines.push(engine);
    await engine.start();
    jest.spyOn(storage, 'setItem').mockRejectedValue(new Error('disk full'));
    expect(await engine.apply({ remove: [], update: [], create: [rec('user-apply2')] })).toBe(false);
  });
```

(If `engine.pending` counts differently because of how `enqueue` folds ops, assert the real count and explain it in the comment — the point of the test is one save and the right records.)

In `context/__tests__/EventsProvider.test.tsx` add (reuse the file's `setup()` and `engine()` helpers):

```tsx
  it('saves an edit from the form in one go and reports whether it was stored', async () => {
    const { result } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    const swim = { ...fakeRecord(), id: 'aaaaaaaa-0000-4000-8000-000000000001' }; // use the file's existing record helper
    act(() => engine().options.onChange({ [swim.id]: swim }, idle));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.saveEventChanges({
        remove: [],
        update: [{ ...swim, name: 'Swim club' }],
        create: [{ id: 'aaaaaaaa-0000-4000-8000-000000000002', dateKey: '2026-11-10', name: 'Swim club', startTime: '', endTime: '' }],
      });
    });
    expect(saved).toBe(true);
    expect(engine().applied[0].update[0]).toMatchObject({ id: swim.id, name: 'Swim club', ownerId: swim.ownerId });
    expect(engine().applied[0].create[0]).toMatchObject({ ownerId: 'user-1', visibility: 'personal', updatedAt: null });

    engine().applyResult = false;
    await act(async () => {
      saved = await result.current.saveEventChanges({ remove: [swim.id], update: [], create: [] });
    });
    expect(saved).toBe(false);
  });
```

Adapt the record helper and `idle` names to what the file already defines; don't add a second copy.

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/events/__tests__/syncEngine.test.ts context/__tests__/EventsProvider.test.tsx`
Expected: FAIL — `engine.apply is not a function`, `saveEventChanges is not a function`.

- [ ] **Step 3: Implement**

`lib/events/syncEngine.ts`:
- Export `export type EventChanges = { remove: string[]; update: EventRecord[]; create: EventRecord[] };`
- In `SyncEngineLike`, after `remove`: 

```ts
  /** One edit touching several events (deletes, then updates, then creates), stored in one save. True once stored. */
  apply(changes: EventChanges): Promise<boolean>;
```

- In `SyncEngine`, after `remove`:

```ts
  async apply(changes: EventChanges): Promise<boolean> {
    await this.loaded;
    if (this.stopped) return false;
    const deletedAt = this.now().toISOString();
    const records = { ...this.data.records };
    for (const id of changes.remove) {
      delete records[id];
      this.data.outbox = enqueue(this.data.outbox, { opId: newOpId(), kind: 'delete', id, deletedAt }, this.inFlight);
    }
    for (const record of changes.update) {
      this.data.outbox = enqueue(this.data.outbox, { opId: newOpId(), kind: 'update', record }, this.inFlight);
      // As in update(): never resurface a record with a queued delete.
      if (!this.data.outbox.some(op => opEventId(op) === record.id && op.kind === 'delete')) records[record.id] = record;
    }
    for (const record of changes.create) {
      records[record.id] = record;
      this.data.outbox = enqueue(this.data.outbox, { opId: newOpId(), kind: 'insert', record }, this.inFlight);
    }
    this.data.records = records;
    return this.changed();
  }
```

`test-utils/fakeEngine.ts`: import `EventChanges`; add

```ts
  applied: EventChanges[] = [];
  applyResult = true;
  async apply(changes: EventChanges) {
    this.applied.push(changes);
    return this.applyResult;
  }
```

`context/EventsProvider.tsx`:
- Import `FormChanges` from `@/lib/events/rows` (add to `rows.ts`: `/** What saving the edit form does: events to delete, update and create. */ export type FormChanges = { remove: string[]; update: EventInput[]; create: EventInput[] };`).
- `EventsValue` gains `/** Save one edit from the event form; true once it's stored on the phone. */ saveEventChanges: (changes: FormChanges) => Promise<boolean>;`
- Implementation (next to `deleteEvents`), and add it to the memo value and deps:

```tsx
  const saveEventChanges = useCallback(
    async (changes: FormChanges): Promise<boolean> => {
      const engine = engineRef.current;
      if (!userId || !engine) return false;
      // An event deleted elsewhere meanwhile is skipped rather than brought back.
      const update = changes.update.flatMap(event => {
        const existing = recordsRef.current[event.id];
        return existing ? [withInput(existing, event)] : [];
      });
      const saved = await engine.apply({ remove: changes.remove, update, create: changes.create.map(event => newRecord(event, userId)) });
      if (changes.remove.length > 0) void dropFromClaim(storage, userId, changes.remove).catch(() => undefined);
      return saved;
    },
    [storage, userId],
  );
```

Any other `SyncEngineLike` implementations in tests (`grep -rn "implements SyncEngineLike\|SyncEngineLike = {" .` outside node_modules) need `apply` too.

- [ ] **Step 4: Run the tests**

Run: `npx jest lib/events context` → PASS. Then `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add lib/events/syncEngine.ts lib/events/rows.ts test-utils/fakeEngine.ts context/EventsProvider.tsx lib/events/__tests__/syncEngine.test.ts context/__tests__/EventsProvider.test.tsx
git commit -m "FEAT-004: Save an edit that touches several events in one go

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Turn the form into changes

**Files:**
- Create: `lib/events/editForm.ts`
- Create: `lib/events/__tests__/editForm.test.ts`

**Interfaces:**
- Consumes: Task 2 (`RepeatRule`, `RepeatPreset`, `RepeatUnit`, `PRESET_RULES`, `presetOf`, `inferRule`, `occurrenceDates`, `addDays`, `addMonths`, `daysBetween`, `latestUntil`, `MAX_EVERY`); `EventRecord`, `EventInput`, `Visibility` (rows.ts); `FormChanges` (Task 5, from `./rows`).
- Produces:
  - `type EventForm = { name: string; dateKey: string; startTime: string; endTime: string; repeat: RepeatPreset; customEvery: string; customUnit: RepeatUnit; until: string; memberIds: string[]; legacyTags: string[]; shared: boolean }`
  - `type FormErrors = Partial<Record<'name' | 'endTime' | 'customEvery' | 'until', string>>`
  - `type SaveScope = 'this' | 'future'`
  - `seriesOf(records: Record<string, EventRecord>, record: EventRecord): EventRecord[]` (sorted by date; `[record]` when not in a series)
  - `formFromRecord(record: EventRecord, series: EventRecord[]): EventForm`
  - `ruleOf(form: EventForm): RepeatRule | null`
  - `withDate(form: EventForm, dateKey: string): EventForm` (moves `until` by the same number of days)
  - `validateForm(form: EventForm): FormErrors`
  - `sameForm(a: EventForm, b: EventForm): boolean`
  - `ruleChanged(form: EventForm, initial: EventForm): boolean`
  - `needsScope(record: EventRecord, series: EventRecord[], form: EventForm, initial: EventForm): boolean`
  - `planFormSave(input: { form; initial; record; series; scope: SaveScope; newId: () => string }): FormChanges`

Messages (verbatim): `Enter a name.` · `Use at most 200 characters.` · `Add a start time first.` · `End after the start time.` · `Enter a number from 1 to 99.` · `Choose an end date.` · `End on or after the event's date.` · `End within a year of the event.`

- [ ] **Step 1: Write the failing tests**

`lib/events/__tests__/editForm.test.ts`:

```ts
import {
  type EventForm,
  formFromRecord,
  needsScope,
  planFormSave,
  ruleChanged,
  sameForm,
  seriesOf,
  validateForm,
  withDate,
} from '../editForm';
import type { RepeatRule } from '../repeat';
import type { EventRecord } from '../rows';

const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: 'e1', dateKey: '2026-10-13', name: 'Swim', startTime: '07:00', endTime: '08:00',
  ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: '2026-10-12T00:00:00Z', ...overrides,
});
const WEEKLY: RepeatRule = { every: 1, unit: 'week', until: '2026-11-03' };
const DATES = ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'];
const weekly = (repeat: RepeatRule | undefined = WEEKLY) =>
  DATES.map((dateKey, i) => event({ id: `s${i}`, dateKey, occurrenceId: 'series-1', repeat }));
const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};
const open = (record: EventRecord, series: EventRecord[]) => {
  const initial = formFromRecord(record, series);
  return { initial, form: { ...initial } };
};

describe('formFromRecord', () => {
  it('fills in a single event', () => {
    expect(formFromRecord(event({ people: ['AZ'], memberIds: ['user-2'] }), [event()])).toEqual({
      name: 'Swim', dateKey: '2026-10-13', startTime: '07:00', endTime: '08:00',
      repeat: 'none', customEvery: '1', customUnit: 'week', until: '',
      memberIds: ['user-2'], legacyTags: ['AZ'], shared: false,
    });
  });

  it('fills in the rule of a series', () => {
    const series = weekly();
    expect(formFromRecord(series[1], series)).toMatchObject({ repeat: 'weekly', until: '2026-11-03' });
  });

  it('works out the rule of an old series with a deleted occurrence', () => {
    const series = weekly(undefined).filter(r => r.id !== 's1');
    expect(formFromRecord(series[0], series)).toMatchObject({ repeat: 'weekly', until: '2026-11-03' });
  });

  it('finds the series of an event, sorted by date', () => {
    const [s0, s1, s2, s3] = weekly();
    const records = { s2, s0, s3, s1, other: event({ id: 'other' }) };
    expect(seriesOf(records, s1).map(r => r.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect(seriesOf(records, records.other)).toEqual([records.other]);
  });
});

describe('validateForm', () => {
  const valid = formFromRecord(event(), [event()]);

  it('accepts a valid form', () => {
    expect(validateForm(valid)).toEqual({});
  });

  it.each<[string, Partial<EventForm>, Record<string, string>]>([
    ['no name', { name: '  ' }, { name: 'Enter a name.' }],
    ['a long name', { name: 'x'.repeat(201) }, { name: 'Use at most 200 characters.' }],
    ['an end without a start', { startTime: '', endTime: '08:00' }, { endTime: 'Add a start time first.' }],
    ['an end before the start', { startTime: '09:00', endTime: '08:00' }, { endTime: 'End after the start time.' }],
    ['custom every 0', { repeat: 'custom', customEvery: '0', until: '2026-11-03' }, { customEvery: 'Enter a number from 1 to 99.' }],
    ['custom every abc', { repeat: 'custom', customEvery: 'abc', until: '2026-11-03' }, { customEvery: 'Enter a number from 1 to 99.' }],
    ['no end date', { repeat: 'weekly', until: '' }, { until: 'Choose an end date.' }],
    ['an end before the date', { repeat: 'weekly', until: '2026-10-12' }, { until: "End on or after the event's date." }],
    ['an end more than a year on', { repeat: 'weekly', until: '2027-10-14' }, { until: 'End within a year of the event.' }],
  ])('rejects %s', (_label, change, errors) => {
    expect(validateForm({ ...valid, ...change })).toEqual(errors);
  });
});

describe('form helpers', () => {
  it('moves the end date with the date', () => {
    const series = weekly();
    const { form } = open(series[1], series);
    expect(withDate(form, '2026-10-21')).toMatchObject({ dateKey: '2026-10-21', until: '2026-11-04' });
  });

  it('treats member order and hidden custom fields as no change', () => {
    const { initial } = open(event({ memberIds: ['a', 'b'] }), [event()]);
    expect(sameForm(initial, { ...initial, memberIds: ['b', 'a'], customEvery: '5' })).toBe(true);
    expect(sameForm(initial, { ...initial, name: 'Swim club' })).toBe(false);
  });

  it('only counts a new repeat or end date as a rule change', () => {
    const series = weekly();
    const { initial, form } = open(series[1], series);
    expect(ruleChanged(withDate(form, '2026-10-21'), initial)).toBe(false);
    expect(ruleChanged({ ...form, until: '2026-10-27' }, initial)).toBe(true);
    expect(ruleChanged({ ...form, repeat: 'fortnightly' }, initial)).toBe(true);
  });

  it('asks which events to change only when later ones exist and the rule stays', () => {
    const series = weekly();
    const { initial, form } = open(series[1], series);
    expect(needsScope(series[1], series, { ...form, name: 'Swim club' }, initial)).toBe(true);
    expect(needsScope(series[1], series, { ...form, repeat: 'fortnightly' }, initial)).toBe(false);
    expect(needsScope(series[3], series, { ...form, name: 'Swim club' }, initial)).toBe(false);
    expect(needsScope(event(), [event()], { ...form, name: 'Swim club' }, initial)).toBe(false);
  });
});

describe('planFormSave: a single event', () => {
  it('updates the event in place', () => {
    const { initial, form } = open(event(), [event()]);
    const plan = planFormSave({ form: { ...form, name: 'Swim club', shared: true }, initial, record: event(), series: [event()], scope: 'this', newId: ids() });
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]).toMatchObject({ id: 'e1', name: 'Swim club', visibility: 'shared', occurrenceId: undefined, repeat: undefined });
  });

  it('turns it into a series when a repeat is chosen', () => {
    const { initial, form } = open(event(), [event()]);
    const plan = planFormSave({ form: { ...form, repeat: 'weekly', until: '2026-10-27' }, initial, record: event(), series: [event()], scope: 'this', newId: ids() });
    const rule = { every: 1, unit: 'week', until: '2026-10-27' };
    expect(plan.update).toEqual([expect.objectContaining({ id: 'e1', dateKey: '2026-10-13', occurrenceId: 'new-1', repeat: rule })]);
    expect(plan.create.map(e => [e.id, e.dateKey, e.occurrenceId])).toEqual([
      ['new-2', '2026-10-20', 'new-1'],
      ['new-3', '2026-10-27', 'new-1'],
    ]);
    expect(plan.create[0]).toMatchObject({ name: 'Swim', startTime: '07:00', repeat: rule });
  });
});

describe('planFormSave: one occurrence of a series', () => {
  const series = weekly();
  const record = series[1];

  it('this event only: updates it and keeps it in the series', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: { ...form, name: 'Swim club' }, initial, record, series, scope: 'this', newId: ids() });
    expect(plan.update).toEqual([expect.objectContaining({ id: 's1', name: 'Swim club', occurrenceId: 'series-1', repeat: WEEKLY })]);
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it('this event only, on a new date: it leaves the series', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: withDate(form, '2026-10-21'), initial, record, series, scope: 'this', newId: ids() });
    expect(plan.update).toEqual([expect.objectContaining({ id: 's1', dateKey: '2026-10-21', occurrenceId: undefined, repeat: undefined })]);
  });

  it('this and all future: updates this and later ones in place, not earlier ones', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: { ...form, name: 'Swim club', startTime: '06:30' }, initial, record, series, scope: 'future', newId: ids() });
    expect(plan.update.map(e => [e.id, e.name, e.startTime])).toEqual([
      ['s1', 'Swim club', '06:30'],
      ['s2', 'Swim club', '06:30'],
      ['s3', 'Swim club', '06:30'],
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it('this and all future, on a new date: moves them all and ends the earlier run the day before', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: withDate(form, '2026-10-21'), initial, record, series, scope: 'future', newId: ids() });
    const moved = { every: 1, unit: 'week', until: '2026-11-04' };
    expect(plan.update.map(e => [e.id, e.dateKey, e.repeat])).toEqual([
      ['s1', '2026-10-21', moved],
      ['s2', '2026-10-28', moved],
      ['s3', '2026-11-04', moved],
      ['s0', '2026-10-13', { every: 1, unit: 'week', until: '2026-10-19' }],
    ]);
  });

  it('a new repeat replaces this and later occurrences', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: { ...form, repeat: 'fortnightly' }, initial, record, series, scope: 'future', newId: ids() });
    expect(plan.remove).toEqual(['s1', 's2', 's3']);
    expect(plan.update).toEqual([expect.objectContaining({ id: 's0', repeat: { every: 1, unit: 'week', until: '2026-10-19' } })]);
    expect(plan.create.map(e => [e.id, e.dateKey, e.occurrenceId])).toEqual([
      ['new-2', '2026-10-20', 'new-1'],
      ['new-3', '2026-11-03', 'new-1'],
    ]);
    expect(plan.create[0].repeat).toEqual({ every: 2, unit: 'week', until: '2026-11-03' });
  });

  it("doesn't repeat: removes later occurrences and takes this one out of the series", () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: { ...form, repeat: 'none' }, initial, record, series, scope: 'future', newId: ids() });
    expect(plan.remove).toEqual(['s2', 's3']);
    expect(plan.update).toEqual([
      expect.objectContaining({ id: 's1', occurrenceId: undefined, repeat: undefined }),
      expect.objectContaining({ id: 's0', repeat: { every: 1, unit: 'week', until: '2026-10-19' } }),
    ]);
    expect(plan.create).toEqual([]);
  });

  it('renaming an old series without a rule changes nothing else', () => {
    const old = weekly(undefined);
    const { initial, form } = open(old[1], old);
    const plan = planFormSave({ form: { ...form, name: 'Swim club' }, initial, record: old[1], series: old, scope: 'future', newId: ids() });
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.update.map(e => e.id)).toEqual(['s1', 's2', 's3']);
  });

  it("keeps the creator and anyone it can't show when a family member edits", () => {
    const shared = weekly().map(r => ({ ...r, ownerId: 'user-2', visibility: 'shared' as const, memberIds: ['former-member'] }));
    const { initial, form } = open(shared[1], shared);
    const plan = planFormSave({ form: { ...form, name: 'Swim club' }, initial, record: shared[1], series: shared, scope: 'future', newId: ids() });
    expect(plan.update.every(e => (e as EventRecord).ownerId === 'user-2' && e.memberIds?.includes('former-member'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/events/__tests__/editForm.test.ts`
Expected: FAIL — `Cannot find module '../editForm'`.

- [ ] **Step 3: Implement**

`lib/events/editForm.ts`:

```ts
import {
  addDays,
  daysBetween,
  inferRule,
  latestUntil,
  MAX_EVERY,
  occurrenceDates,
  PRESET_RULES,
  presetOf,
  type RepeatPreset,
  type RepeatRule,
  type RepeatUnit,
} from './repeat';
import type { EventInput, EventRecord, FormChanges, Visibility } from './rows';

/** What the edit form shows. Text fields keep what was typed; `until` is '' when not repeating. */
export type EventForm = {
  name: string;
  dateKey: string;
  startTime: string; // 'HH:mm' or ''
  endTime: string;
  repeat: RepeatPreset;
  customEvery: string;
  customUnit: RepeatUnit;
  until: string;
  memberIds: string[];
  legacyTags: string[]; // tags such as 'AZ' not mapped to a member
  shared: boolean;
};

export type FormErrors = Partial<Record<'name' | 'endTime' | 'customEvery' | 'until', string>>;
export type SaveScope = 'this' | 'future';

const MAX_NAME = 200;

/** The occurrences of the event's series, by date; just the event when it doesn't repeat. */
export function seriesOf(records: Record<string, EventRecord>, record: EventRecord): EventRecord[] {
  if (!record.occurrenceId) return [record];
  return Object.values(records)
    .filter(r => r.occurrenceId === record.occurrenceId)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function formFromRecord(record: EventRecord, series: EventRecord[]): EventForm {
  // Series made before rules were stored get one worked out from their dates.
  const rule = record.occurrenceId ? (record.repeat ?? inferRule(series.map(r => r.dateKey))) : null;
  return {
    name: record.name,
    dateKey: record.dateKey,
    startTime: record.startTime,
    endTime: record.endTime,
    repeat: presetOf(rule),
    customEvery: String(rule?.every ?? 1),
    customUnit: rule?.unit ?? 'week',
    until: rule?.until ?? '',
    memberIds: [...record.memberIds],
    legacyTags: [...(record.people ?? [])],
    shared: record.visibility === 'shared',
  };
}

export function ruleOf(form: EventForm): RepeatRule | null {
  if (form.repeat === 'none') return null;
  const step = form.repeat === 'custom' ? { every: Number(form.customEvery), unit: form.customUnit } : PRESET_RULES[form.repeat];
  return { ...step, until: form.until };
}

/** A new date; the end date moves with it so the series keeps its length. */
export const withDate = (form: EventForm, dateKey: string): EventForm => ({
  ...form,
  dateKey,
  until: form.until ? addDays(form.until, daysBetween(form.dateKey, dateKey)) : '',
});

export function validateForm(form: EventForm): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = 'Enter a name.';
  else if (Array.from(name).length > MAX_NAME) errors.name = 'Use at most 200 characters.';
  if (form.endTime && !form.startTime) errors.endTime = 'Add a start time first.';
  else if (form.endTime && form.endTime <= form.startTime) errors.endTime = 'End after the start time.';
  if (form.repeat === 'custom') {
    const every = Number(form.customEvery);
    if (!/^\d+$/.test(form.customEvery) || every < 1 || every > MAX_EVERY) errors.customEvery = 'Enter a number from 1 to 99.';
  }
  if (form.repeat !== 'none') {
    if (!form.until) errors.until = 'Choose an end date.';
    else if (form.until < form.dateKey) errors.until = "End on or after the event's date.";
    else if (form.until > latestUntil(form.dateKey)) errors.until = 'End within a year of the event.';
  }
  return errors;
}

const comparable = (f: EventForm) =>
  JSON.stringify({
    ...f,
    name: f.name.trim(),
    customEvery: f.repeat === 'custom' ? f.customEvery : '',
    customUnit: f.repeat === 'custom' ? f.customUnit : 'week',
    until: f.repeat === 'none' ? '' : f.until,
    memberIds: [...f.memberIds].sort(),
    legacyTags: [...f.legacyTags].sort(),
  });

export const sameForm = (a: EventForm, b: EventForm): boolean => comparable(a) === comparable(b);

/** A different repeat, or an end date that didn't just move with the date. */
export function ruleChanged(form: EventForm, initial: EventForm): boolean {
  const shape = (f: EventForm) => {
    const rule = ruleOf(f);
    return rule ? `${rule.every} ${rule.unit} ${daysBetween(f.dateKey, rule.until)}` : 'none';
  };
  return shape(form) !== shape(initial);
}

/** Ask "this event only / this and all future" only when both would differ. */
export const needsScope = (record: EventRecord, series: EventRecord[], form: EventForm, initial: EventForm): boolean =>
  !!record.occurrenceId && !ruleChanged(form, initial) && series.some(r => r.id !== record.id && r.dateKey > record.dateKey);

type SaveInput = { form: EventForm; initial: EventForm; record: EventRecord; series: EventRecord[]; scope: SaveScope; newId: () => string };

/** The creates, updates and deletes that save the form (spec §3). */
export function planFormSave({ form, initial, record, series, scope, newId }: SaveInput): FormChanges {
  const visibility: Visibility = form.shared ? 'shared' : 'personal';
  const details = {
    name: form.name.trim(),
    startTime: form.startTime,
    endTime: form.endTime,
    people: form.legacyTags.length > 0 ? [...form.legacyTags] : undefined,
    memberIds: [...form.memberIds],
    visibility,
  };
  const rule = ruleOf(form);
  const alone = (dateKey: string): EventInput => ({ ...record, ...details, dateKey, occurrenceId: undefined, repeat: undefined });
  const newSeries = (dates: string[], seriesId: string): EventInput[] =>
    dates.map(dateKey => ({ ...details, id: newId(), dateKey, occurrenceId: seriesId, repeat: rule ?? undefined }));

  if (!record.occurrenceId) {
    const dates = rule ? occurrenceDates(form.dateKey, rule) : [];
    if (dates.length < 2) return { remove: [], update: [alone(form.dateKey)], create: [] };
    const seriesId = newId();
    return {
      remove: [],
      update: [{ ...alone(dates[0]), occurrenceId: seriesId, repeat: rule ?? undefined }],
      create: newSeries(dates.slice(1), seriesId),
    };
  }

  const later = series.filter(r => r.id !== record.id && r.dateKey > record.dateKey);
  const earlier = series.filter(r => r.id !== record.id && r.dateKey < record.dateKey);
  const oldRule = ruleOf(initial);
  // Earlier occurrences become their own run, ending the day before this one was.
  const trimEarlier = (): EventInput[] =>
    earlier.map(r => {
      const base = r.repeat ?? oldRule;
      return { ...r, repeat: base ? { ...base, until: addDays(record.dateKey, -1) } : undefined };
    });

  if (ruleChanged(form, initial)) {
    const dates = rule ? occurrenceDates(form.dateKey, rule) : [];
    if (dates.length < 2) return { remove: later.map(r => r.id), update: [alone(form.dateKey), ...trimEarlier()], create: [] };
    return { remove: [record.id, ...later.map(r => r.id)], update: trimEarlier(), create: newSeries(dates, newId()) };
  }

  const shift = daysBetween(record.dateKey, form.dateKey);
  if (scope === 'this') {
    return { remove: [], update: [shift === 0 ? { ...record, ...details } : alone(form.dateKey)], create: [] };
  }
  const moved = [record, ...later].map(r => ({ ...r, ...details, dateKey: addDays(r.dateKey, shift), repeat: rule ?? undefined }));
  return { remove: [], update: shift === 0 ? moved : [...moved, ...trimEarlier()], create: [] };
}
```

Note the `newSeries` ids: in "turns it into a series" the series id is `new-1` and events `new-2`, `new-3`; in "a new repeat replaces…" `newSeries(dates, newId())` evaluates `newId()` first → series `new-1`, events `new-2`, `new-3`. Keep that order.

- [ ] **Step 4: Run the tests**

Run: `npx jest lib/events/__tests__/editForm.test.ts` → PASS. Then `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add lib/events/editForm.ts lib/events/__tests__/editForm.test.ts
git commit -m "FEAT-004: Work out what saving the edit form changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The form's fields

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npx expo install @react-native-community/datetimepicker`)
- Create: `components/events/form/Chip.tsx`
- Create: `components/events/form/DateField.tsx`
- Create: `components/events/form/TimeField.tsx`
- Create: `components/events/form/RepeatPicker.tsx`
- Create: `components/events/form/PeoplePicker.tsx`
- Create: `components/events/EventForm.tsx`
- Create: `components/events/__tests__/EventForm.test.tsx`

**Interfaces:**
- Consumes: Task 6 (`EventForm`, `FormErrors`, `withDate`), Task 2 (`latestUntil`, `RepeatPreset`, `RepeatUnit`), `formatDateKey`/`formatClock`/`formatTime` (lib/dates), `FormField` (components/auth), `ShareToggle`, `MemberAvatar`, `memberLabel`, `Member`.
- Produces: `EventForm` component —

```ts
type Props = {
  form: EventForm;
  errors: FormErrors;
  onChange: (form: EventForm) => void;
  members: Member[];
  memberById: ReadonlyMap<string, Member>;
  myId: string | null;
  showShare: boolean;
  shareLocked: boolean;
  repeatLockedMessage: string | null; // null = Repeat and Ends on can be changed
};
```

Accessible names the screen tests in Task 8 rely on: text field `Name`; buttons `Date`, `Start time`, `End time`, `Ends on`, `Clear start time`, `Clear end time`; radios `Doesn't repeat`, `Daily`, `Weekly`, `Fortnightly`, `Monthly`, `Custom`, `days`, `weeks`, `months`; text field `Repeat every`; checkboxes per member (`memberLabel`), per former member (`Former member`) and per leftover tag (`@AZ`); switch `Share with family`.

- [ ] **Step 1: Install the time picker**

Read https://docs.expo.dev/versions/v54.0.0/sdk/date-time-picker/ first. Run: `npx expo install @react-native-community/datetimepicker` — expect `8.4.4` in `package.json`. It is in Expo Go; no config plugin is needed.

- [ ] **Step 2: Write the failing tests**

`components/events/__tests__/EventForm.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';

import type { EventForm as Form, FormErrors } from '@/lib/events/editForm';
import { FAKE_BOB, FAKE_ME } from '@/test-utils/fakeFamily';

import { EventForm } from '../EventForm';

jest.mock('react-native-calendars', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Calendar: ({ onDayPress }: { onDayPress: (d: { dateString: string }) => void }) =>
    React.createElement(Text, { onPress: () => onDayPress({ dateString: '2026-11-20' }) }, 'Pick 20/11/2026') };
});
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: ({ onChange }: { onChange: (e: { type: string }, d: Date) => void }) =>
    React.createElement(Text, { onPress: () => onChange({ type: 'set' }, new Date(2026, 9, 13, 18, 30)) }, 'Pick 6:30 pm') };
});

const base: Form = {
  name: 'Swim', dateKey: '2026-10-13', startTime: '07:00', endTime: '', repeat: 'none', customEvery: '1',
  customUnit: 'week', until: '', memberIds: [], legacyTags: ['AZ'], shared: false,
};
const members = [FAKE_ME, FAKE_BOB];

function Harness({ initial = base, errors = {}, repeatLockedMessage = null, onForm }: {
  initial?: Form; errors?: FormErrors; repeatLockedMessage?: string | null; onForm?: (f: Form) => void;
}) {
  const [form, setForm] = useState(initial);
  return (
    <EventForm
      form={form}
      errors={errors}
      onChange={next => { setForm(next); onForm?.(next); }}
      members={members}
      memberById={new Map(members.map(m => [m.id, m]))}
      myId={FAKE_ME.id}
      showShare
      shareLocked={false}
      repeatLockedMessage={repeatLockedMessage}
    />
  );
}

describe('EventForm', () => {
  it('shows the event', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Name').props.value).toBe('Swim');
    expect(screen.getByText('13/10/2026')).toBeTruthy();
    expect(screen.getByText('7:00 am')).toBeTruthy();
    expect(screen.getByRole('radio', { name: "Doesn't repeat" })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Ends on' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: '@AZ' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Bob' })).not.toBeChecked();
  });

  it('picks a date and a time', () => {
    const onForm = jest.fn();
    render(<Harness onForm={onForm} />);
    fireEvent.press(screen.getByRole('button', { name: 'Date' }));
    fireEvent.press(screen.getByText('Pick 20/11/2026'));
    expect(screen.getByText('20/11/2026')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'End time' }));
    fireEvent.press(screen.getByText('Pick 6:30 pm'));
    expect(onForm).toHaveBeenLastCalledWith(expect.objectContaining({ dateKey: '2026-11-20', endTime: '18:30' }));
  });

  it('clears a time', () => {
    const onForm = jest.fn();
    render(<Harness onForm={onForm} />);
    fireEvent.press(screen.getByRole('button', { name: 'Clear start time' }));
    expect(onForm).toHaveBeenLastCalledWith(expect.objectContaining({ startTime: '' }));
  });

  it('chooses a custom repeat and an end date', () => {
    const onForm = jest.fn();
    render(<Harness onForm={onForm} />);
    fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.changeText(screen.getByLabelText('Repeat every'), '3');
    fireEvent.press(screen.getByRole('radio', { name: 'days' }));
    fireEvent.press(screen.getByRole('button', { name: 'Ends on' }));
    fireEvent.press(screen.getByText('Pick 20/11/2026'));
    expect(onForm).toHaveBeenLastCalledWith(expect.objectContaining({ repeat: 'custom', customEvery: '3', customUnit: 'day', until: '2026-11-20' }));
  });

  it('toggles people and removes a leftover tag', () => {
    const onForm = jest.fn();
    render(<Harness onForm={onForm} />);
    fireEvent.press(screen.getByRole('checkbox', { name: 'Bob' }));
    fireEvent.press(screen.getByRole('checkbox', { name: '@AZ' }));
    expect(onForm).toHaveBeenLastCalledWith(expect.objectContaining({ memberIds: [FAKE_BOB.id], legacyTags: [] }));
  });

  it('shows a former member on the event', () => {
    render(<Harness initial={{ ...base, memberIds: ['someone-who-left'] }} />);
    expect(screen.getByRole('checkbox', { name: 'Former member' })).toBeChecked();
  });

  it('locks how it repeats for someone who did not create it', () => {
    render(<Harness initial={{ ...base, repeat: 'weekly', until: '2026-11-03' }} repeatLockedMessage="Only Bob can change how this repeats." />);
    expect(screen.getByText('Only Bob can change how this repeats.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ends on' })).toBeDisabled();
  });

  it('shows errors under their fields', () => {
    render(<Harness errors={{ name: 'Enter a name.', endTime: 'End after the start time.' }} />);
    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(screen.getByText('End after the start time.')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx jest components/events/__tests__/EventForm.test.tsx`
Expected: FAIL — `Cannot find module '../EventForm'`.

- [ ] **Step 4: Implement**

Shared look: match the existing auth form styles (`components/auth/FormField.tsx`: label 14 px semibold `#333`, input border `#ccc` radius 8, error `#c62828`). Blue `#007BFF` as in the planner.

`components/events/form/Chip.tsx`:

```tsx
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

type Props = { label: string; selected: boolean; onPress: () => void; role?: 'radio' | 'checkbox'; disabled?: boolean; children?: React.ReactNode };

/** A pill that is on or off: one choice of several (radio) or one of many (checkbox). */
export function Chip({ label, selected, onPress, role = 'radio', disabled = false, children }: Props) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected, disabled && styles.disabled]}
    >
      {children}
      <Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
  selected: { backgroundColor: '#007BFF', borderColor: '#007BFF' },
  disabled: { opacity: 0.5 },
  text: { fontSize: 14, color: '#333' },
  selectedText: { color: '#fff', fontWeight: '600' },
});
```

`components/events/form/DateField.tsx`:

```tsx
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Calendar } from 'react-native-calendars';

import { formatDateKey } from '@/lib/dates';

type Props = { label: string; value: string; onChange: (dateKey: string) => void; minDate?: string; maxDate?: string; error?: string; disabled?: boolean };

/** A date shown as dd/mm/yyyy; tapping it opens the month calendar. */
export function DateField({ label, value, onChange, minDate, maxDate, error, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.box, error ? styles.boxError : null, disabled ? styles.disabled : null]}
      >
        <Text style={value ? styles.value : styles.placeholder}>{value ? formatDateKey(value) : 'Choose a date'}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Calendar
              current={value || minDate}
              minDate={minDate}
              maxDate={maxDate}
              markedDates={value ? { [value]: { selected: true, selectedColor: '#007BFF' } } : undefined}
              onDayPress={day => {
                onChange(day.dateString);
                setOpen(false);
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  box: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff' },
  boxError: { borderColor: '#c62828' },
  disabled: { opacity: 0.5 },
  value: { fontSize: 16, color: '#333' },
  placeholder: { fontSize: 16, color: '#999' },
  error: { color: '#c62828', marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
});
```

`components/events/form/TimeField.tsx`:

```tsx
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatClock, formatTime } from '@/lib/dates';

type Props = { label: string; value: string; onChange: (time: string) => void; error?: string };

const asDate = (time: string): Date => {
  const [h, m] = (time || '09:00').split(':').map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date;
};

/** An optional time shown as "6:30 pm", picked with the phone's own time picker. */
export function TimeField({ label, value, onChange, error }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={[styles.box, error ? styles.boxError : null]}>
          <Text style={value ? styles.value : styles.placeholder}>{value ? formatClock(value) : 'None'}</Text>
        </Pressable>
        {value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label.toLowerCase()}`} onPress={() => onChange('')} hitSlop={8}>
            <Text style={styles.link}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {open ? (
        <View>
          <DateTimePicker
            mode="time"
            value={asDate(value)}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, date) => {
              // Android shows a dialog that closes itself; iOS shows a wheel until Done.
              if (Platform.OS !== 'ios') setOpen(false);
              if (event.type === 'set' && date) onChange(formatTime(date));
            }}
          />
          {Platform.OS === 'ios' ? (
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.done}>
              <Text style={styles.link}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff' },
  boxError: { borderColor: '#c62828' },
  value: { fontSize: 16, color: '#333' },
  placeholder: { fontSize: 16, color: '#999' },
  link: { color: '#007BFF', fontSize: 16, fontWeight: '600' },
  done: { alignSelf: 'flex-end', padding: 8 },
  error: { color: '#c62828', marginTop: 4 },
});
```

`components/events/form/RepeatPicker.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { RepeatPreset, RepeatUnit } from '@/lib/events/repeat';

import { Chip } from './Chip';

const PRESETS: { value: RepeatPreset; label: string }[] = [
  { value: 'none', label: "Doesn't repeat" },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];
const UNITS: { value: RepeatUnit; label: string }[] = [
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
  { value: 'month', label: 'months' },
];

type Choice = { preset: RepeatPreset; every: string; unit: RepeatUnit };
type Props = Choice & { onChange: (next: Choice) => void; error?: string; lockedMessage: string | null };

export function RepeatPicker({ preset, every, unit, onChange, error, lockedMessage }: Props) {
  const locked = lockedMessage !== null;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Repeat</Text>
      <View style={styles.wrap}>
        {PRESETS.map(p => (
          <Chip key={p.value} label={p.label} selected={preset === p.value} disabled={locked} onPress={() => onChange({ preset: p.value, every, unit })} />
        ))}
      </View>
      {preset === 'custom' ? (
        <View style={styles.custom}>
          <Text style={styles.every}>Every</Text>
          <TextInput
            accessibilityLabel="Repeat every"
            value={every}
            onChangeText={text => onChange({ preset, every: text, unit })}
            keyboardType="number-pad"
            maxLength={2}
            editable={!locked}
            style={[styles.input, error ? styles.inputError : null]}
          />
          {UNITS.map(u => (
            <Chip key={u.value} label={u.label} selected={unit === u.value} disabled={locked} onPress={() => onChange({ preset, every, unit: u.value })} />
          ))}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {lockedMessage ? <Text style={styles.locked}>{lockedMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  custom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  every: { fontSize: 16, color: '#333', marginBottom: 8 },
  input: { width: 56, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 16, backgroundColor: '#fff', marginBottom: 8 },
  inputError: { borderColor: '#c62828' },
  error: { color: '#c62828', marginTop: 4 },
  locked: { color: '#666', marginTop: 4 },
});
```

`components/events/form/PeoplePicker.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MemberAvatar } from '@/components/events/MemberAvatar';
import { memberLabel } from '@/lib/family/tags';
import type { Member } from '@/lib/family/types';

import { Chip } from './Chip';

type People = { memberIds: string[]; legacyTags: string[] };
type Props = People & { members: Member[]; memberById: ReadonlyMap<string, Member>; myId: string | null; onChange: (next: People) => void };

/** Who the event is for: family members to toggle, plus anyone on it the family list doesn't hold. */
export function PeoplePicker({ members, memberById, myId, memberIds, legacyTags, onChange }: Props) {
  // Former members (and members not loaded yet) stay on the event until you remove them.
  const others = memberIds.filter(id => !members.some(m => m.id === id));
  if (members.length === 0 && others.length === 0 && legacyTags.length === 0) return null;
  const toggle = (id: string) =>
    onChange({ memberIds: memberIds.includes(id) ? memberIds.filter(x => x !== id) : [...memberIds, id], legacyTags });
  return (
    <View style={styles.field}>
      <Text style={styles.label}>People</Text>
      <View style={styles.wrap}>
        {members.map(m => (
          <Chip key={m.id} role="checkbox" label={memberLabel(m, myId)} selected={memberIds.includes(m.id)} onPress={() => toggle(m.id)}>
            <MemberAvatar member={m} size={22} />
          </Chip>
        ))}
        {others.map(id => (
          <Chip key={id} role="checkbox" label={memberLabel(memberById.get(id), myId)} selected onPress={() => toggle(id)} />
        ))}
        {legacyTags.map(tag => (
          <Chip key={tag} role="checkbox" label={`@${tag}`} selected onPress={() => onChange({ memberIds, legacyTags: legacyTags.filter(t => t !== tag) })} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
```

`components/events/EventForm.tsx`:

```tsx
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { FormField } from '@/components/auth/FormField';
import { ShareToggle } from '@/components/events/ShareToggle';
import { type EventForm as Form, type FormErrors, withDate } from '@/lib/events/editForm';
import { latestUntil } from '@/lib/events/repeat';
import type { Member } from '@/lib/family/types';

import { DateField } from './form/DateField';
import { PeoplePicker } from './form/PeoplePicker';
import { RepeatPicker } from './form/RepeatPicker';
import { TimeField } from './form/TimeField';

type Props = {
  form: Form;
  errors: FormErrors;
  onChange: (form: Form) => void;
  members: Member[];
  memberById: ReadonlyMap<string, Member>;
  myId: string | null;
  showShare: boolean;
  shareLocked: boolean;
  repeatLockedMessage: string | null;
};

/** Every field of an event. Controlled: the screen owns the form and decides what saving does. */
export function EventForm({ form, errors, onChange, members, memberById, myId, showShare, shareLocked, repeatLockedMessage }: Props) {
  const set = (patch: Partial<Form>) => onChange({ ...form, ...patch });
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <FormField label="Name" kind="plain" value={form.name} onChangeText={name => set({ name })} error={errors.name} />
      <DateField label="Date" value={form.dateKey} onChange={dateKey => onChange(withDate(form, dateKey))} />
      <TimeField label="Start time" value={form.startTime} onChange={startTime => set({ startTime })} />
      <TimeField label="End time" value={form.endTime} onChange={endTime => set({ endTime })} error={errors.endTime} />
      <RepeatPicker
        preset={form.repeat}
        every={form.customEvery}
        unit={form.customUnit}
        error={errors.customEvery}
        lockedMessage={repeatLockedMessage}
        onChange={next => set({ repeat: next.preset, customEvery: next.every, customUnit: next.unit })}
      />
      {form.repeat !== 'none' ? (
        <DateField
          label="Ends on"
          value={form.until}
          minDate={form.dateKey}
          maxDate={latestUntil(form.dateKey)}
          onChange={until => set({ until })}
          error={errors.until}
          disabled={repeatLockedMessage !== null}
        />
      ) : null}
      <PeoplePicker
        members={members}
        memberById={memberById}
        myId={myId}
        memberIds={form.memberIds}
        legacyTags={form.legacyTags}
        onChange={people => set(people)}
      />
      {showShare ? <ShareToggle shared={form.shared} onChange={shared => set({ shared })} disabled={shareLocked} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
});
```

- [ ] **Step 5: Run the tests**

Run: `npx jest components/events/__tests__/EventForm.test.tsx` → PASS. Then `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json components/events/form components/events/EventForm.tsx components/events/__tests__/EventForm.test.tsx
git commit -m "FEAT-004: Add the edit form's fields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The edit screen, and Edit opens it (BUG-005)

**Files:**
- Create: `components/events/EditEventScreen.tsx`
- Create: `app/event/[id]/edit.tsx`
- Modify: `components/navigation/RootNavigator.tsx`
- Modify: `app/(tabs)/index.tsx` (Edit navigates; sentence-edit code removed)
- Modify: `lib/events/items.ts` (remove `eventToSentence` if unused), `lib/events/edits.ts` + `lib/events/__tests__/edits.test.ts` (delete if unused)
- Create: `components/events/__tests__/EditEventScreen.test.tsx`
- Modify: `app/(tabs)/__tests__/planner.test.tsx`, `lib/events/__tests__/items.test.ts`

**Interfaces:**
- Consumes: Task 5 (`saveEventChanges`), Task 6 (`seriesOf`, `formFromRecord`, `validateForm`, `sameForm`, `needsScope`, `planFormSave`, `EventForm`, `FormErrors`, `SaveScope`), Task 7 (`EventForm` component), `useAuth`, `useEvents`, `useFamily`, `memberLabel`, `Notice` (`components/auth/Notice`, props `tone` + children), `newUuid` (`lib/events/ids`).
- Produces: route `/event/[id]/edit` (signed-in only); `EditEventScreen` component.

Copy (verbatim): title `Edit event`; buttons `Cancel`, `Save`; scope panel `Change which events?` with `This event only`, `This and all future`, `Cancel`; discard panel `Discard changes?` with `Keep editing`, `Discard`; `Couldn't save. Try again.`; `This event was deleted.` with `Back`; lock `Only <memberLabel> can change how this repeats.`, or `Only the person who made this event can change how this repeats.` when it has no owner.

Ruling (cosmetic deviation from spec §1 "in the header"): the screen draws its own top bar (Cancel · Edit event · Save) and the route hides the native header, so the buttons are testable and look the same on both platforms.

- [ ] **Step 1: Write the failing screen tests**

`components/events/__tests__/EditEventScreen.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { FamilyContext, type FamilyValue } from '@/context/FamilyProvider';
import type { RepeatRule } from '@/lib/events/repeat';
import type { EventRecord } from '@/lib/events/rows';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { FAKE_BOB, fakeFamilyValue } from '@/test-utils/fakeFamily';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { EditEventScreen } from '../EditEventScreen';

jest.mock('react-native-calendars', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Calendar: ({ onDayPress }: { onDayPress: (d: { dateString: string }) => void }) =>
    React.createElement(Text, { onPress: () => onDayPress({ dateString: '2026-10-21' }) }, 'Pick 21/10/2026') };
});
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));

const idle = { state: 'idle' as const, pending: 0, lastSyncedAt: null };
const WEEKLY: RepeatRule = { every: 1, unit: 'week', until: '2026-11-03' };
const uuid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: uuid(1), dateKey: '2026-10-13', name: 'Swim', startTime: '07:00', endTime: '',
  ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: '2026-10-12T00:00:00Z', ...overrides,
});
const weekly = (overrides: Partial<EventRecord> = {}) =>
  ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'].map((dateKey, i) =>
    event({ id: uuid(10 + i), dateKey, occurrenceId: uuid(99), repeat: WEEKLY, ...overrides }));

const engine = () => FakeEngine.instances[0];

async function openEditor(records: EventRecord[], id: string, family: FamilyValue = fakeFamilyValue()) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fakeAuthClient(fakeSession()).client}>
          <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
            <FamilyContext.Provider value={family}>
              <Slot />
            </FamilyContext.Provider>
          </EventsProvider>
        </AuthProvider>
      ),
      index: () => <Text>Planner</Text>,
      'event/[id]/edit': EditEventScreen,
    },
    { initialUrl: `/event/${id}/edit` },
  );
  await waitFor(() => expect(engine()).toBeDefined());
  act(() => engine().options.onChange(Object.fromEntries(records.map(r => [r.id, r])), idle));
  await screen.findByLabelText('Name');
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('Edit event', () => {
  it('fills in the event, with Save off until something changes', async () => {
    const series = weekly();
    await openEditor(series, series[1].id);
    expect(screen.getByLabelText('Name').props.value).toBe('Swim');
    expect(screen.getByText('20/10/2026')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Weekly' })).toBeChecked();
    expect(screen.getByText('03/11/2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.changeText(screen.getByLabelText('Name'), 'Swim club');
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('saves a single event and goes back', async () => {
    await openEditor([event()], uuid(1));
    fireEvent.changeText(screen.getByLabelText('Name'), 'Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(engine().applied[0].update[0]).toMatchObject({ id: uuid(1), name: 'Swim club' });
    expect(await screen.findByText('Planner')).toBeTruthy();
  });

  it('asks which events to change, then changes this and later ones', async () => {
    const series = weekly();
    await openEditor(series, series[1].id);
    fireEvent.changeText(screen.getByLabelText('Name'), 'Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Change which events?')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'This and all future' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(engine().applied[0].update.map(r => r.id)).toEqual([series[1].id, series[2].id, series[3].id]);
  });

  it('changing how it repeats replaces this and later ones without asking', async () => {
    const series = weekly();
    await openEditor(series, series[1].id);
    fireEvent.press(screen.getByRole('radio', { name: 'Fortnightly' }));
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(screen.queryByText('Change which events?')).toBeNull();
    expect(engine().applied[0].remove).toEqual([series[1].id, series[2].id, series[3].id]);
    expect(engine().applied[0].create.map(r => r.dateKey)).toEqual(['2026-10-20', '2026-11-03']);
  });

  it('shows what is wrong and does not save', async () => {
    await openEditor([event()], uuid(1));
    fireEvent.changeText(screen.getByLabelText('Name'), '  ');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(engine().applied).toHaveLength(0);
  });

  it("keeps the form open when the change can't be stored", async () => {
    await openEditor([event()], uuid(1));
    engine().applyResult = false;
    fireEvent.changeText(screen.getByLabelText('Name'), 'Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeTruthy();
    expect(screen.getByLabelText('Name').props.value).toBe('Swim club');
  });

  it('asks before throwing away changes', async () => {
    await openEditor([event()], uuid(1));
    fireEvent.changeText(screen.getByLabelText('Name'), 'Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Name').props.value).toBe('Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('Planner')).toBeTruthy();
    expect(engine().applied).toHaveLength(0);
  });

  it("locks how someone else's shared series repeats, and keeps who's on it", async () => {
    const series = weekly({ ownerId: FAKE_BOB.id, visibility: 'shared', memberIds: ['someone-who-left'] });
    await openEditor(series, series[1].id);
    expect(screen.getByText('Only Bob can change how this repeats.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Share with family' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Former member' })).toBeChecked();
    fireEvent.changeText(screen.getByLabelText('Name'), 'Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    fireEvent.press(screen.getByRole('button', { name: 'This event only' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(engine().applied[0].update[0]).toMatchObject({ ownerId: FAKE_BOB.id, visibility: 'shared', memberIds: ['someone-who-left'] });
  });

  it('lets the creator make their shared event personal', async () => {
    await openEditor([event({ visibility: 'shared' })], uuid(1));
    const toggle = screen.getByRole('switch', { name: 'Share with family' });
    expect(toggle).not.toBeDisabled();
    fireEvent.press(toggle);
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(engine().applied[0].update[0]).toMatchObject({ visibility: 'personal' });
  });

  it('lets you edit your shared event before the family has loaded', async () => {
    await openEditor([event({ visibility: 'shared' })], uuid(1), fakeFamilyValue({ me: null, members: [], memberById: new Map(), memberByTag: new Map() }));
    expect(screen.getByRole('switch', { name: 'Share with family' })).not.toBeDisabled();
  });

  it('says so when the event is deleted while you edit it', async () => {
    await openEditor([event()], uuid(1));
    act(() => engine().options.onChange({}, idle));
    expect(await screen.findByText('This event was deleted.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Planner')).toBeTruthy();
    expect(engine().applied).toHaveLength(0);
  });

  it('moves the date of this and later ones', async () => {
    const series = weekly();
    await openEditor(series, series[1].id);
    fireEvent.press(screen.getByRole('button', { name: 'Date' }));
    fireEvent.press(screen.getByText('Pick 21/10/2026'));
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    fireEvent.press(screen.getByRole('button', { name: 'This and all future' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(engine().applied[0].update.map(r => r.dateKey)).toEqual(['2026-10-21', '2026-10-28', '2026-11-04', '2026-10-13']);
  });
});
```

In `app/(tabs)/__tests__/planner.test.tsx`:
- Delete the four tests that edit through the sentence box: "lets the creator switch their own shared event to Personal", "makes a new event after Cancel then Add (no update)", "keeps a member with no tag on the event after editing", and the editing half of "shows 'Shared · You' and enables the switch…" (keep its "Shared · You" label check, renamed "shows 'Shared · You' for your own shared event when the family has not loaded"). In "shows who shared an event, and won't let a member make it personal", keep only the `Shared · Bob` label check and rename it "shows who shared an event". Their behaviour is now covered in `EditEventScreen.test.tsx`.
- Add at the top, after the calendars mock:

```tsx
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, router: { ...actual.router, push: (...args: unknown[]) => mockPush(...args) } };
});
```

- Add:

```tsx
  it('opens the edit form from Modify → Edit', async () => {
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
    const record: EventRecord = {
      id: 'eeeeeeee-aaaa-4bbb-8ccc-dddddddddddd', dateKey: today, name: 'Lunch', startTime: '12:00', endTime: '',
      ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null,
    };
    act(() => engine().options.onChange({ [record.id]: record }, idle));
    await screen.findByText('Lunch');
    fireEvent.press(screen.getByText('Modify'));
    fireEvent.press(screen.getByText('Edit'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/event/[id]/edit', params: { id: record.id } });
    expect(screen.queryByText('Save')).toBeNull(); // the input box no longer edits
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest components/events/__tests__/EditEventScreen.test.tsx "app/(tabs)/__tests__/planner.test.tsx"`
Expected: FAIL — `Cannot find module '../EditEventScreen'`; the planner still puts the sentence in the box.

- [ ] **Step 3: Implement the screen**

`components/events/EditEventScreen.tsx`:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/auth/Notice';
import { EventForm } from '@/components/events/EventForm';
import { useAuth } from '@/context/AuthProvider';
import { useEvents } from '@/context/EventsProvider';
import { useFamily } from '@/context/FamilyProvider';
import {
  type EventForm as Form,
  type FormErrors,
  formFromRecord,
  needsScope,
  planFormSave,
  sameForm,
  type SaveScope,
  seriesOf,
  validateForm,
} from '@/lib/events/editForm';
import { newUuid } from '@/lib/events/ids';
import type { EventRecord } from '@/lib/events/rows';
import { memberLabel } from '@/lib/family/tags';

/** The event and its series as they were when the form opened; saving plans against these. */
type Opened = { record: EventRecord; series: EventRecord[]; initial: Form };

function Panel({ title, actions }: { title: string; actions: { label: string; onPress: () => void; strong?: boolean }[] }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {actions.map(a => (
        <Pressable key={a.label} accessibilityRole="button" onPress={a.onPress} style={styles.panelButton}>
          <Text style={[styles.panelButtonText, a.strong && styles.strong]}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { records, saveEventChanges } = useEvents();
  const { family, members, memberById } = useFamily();
  const myId = user?.id ?? null;
  const record = id ? records[id] : undefined;
  const [opened, setOpened] = useState<Opened | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [asking, setAsking] = useState<'scope' | 'discard' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useRef(false);

  useEffect(() => {
    if (opened || !record) return;
    const series = seriesOf(records, record);
    const initial = formFromRecord(record, series);
    setOpened({ record, series, initial });
    setForm(initial);
  }, [opened, record, records]);

  const leave = () => {
    left.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (left.current) return null;
  if (!record || !opened || !form) {
    return (
      <View style={styles.gone}>
        <Text style={styles.goneText}>This event was deleted.</Text>
        <Pressable accessibilityRole="button" onPress={leave} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const { record: original, series, initial } = opened;
  const othersShared = original.visibility === 'shared' && (original.ownerId === null || original.ownerId !== myId);
  const repeatLockedMessage = !othersShared
    ? null
    : original.ownerId
      ? `Only ${memberLabel(memberById.get(original.ownerId), myId)} can change how this repeats.`
      : 'Only the person who made this event can change how this repeats.';
  const dirty = !sameForm(form, initial);

  const commit = async (scope: SaveScope) => {
    setAsking(null);
    setBusy(true);
    const saved = await saveEventChanges(planFormSave({ form, initial, record: original, series, scope, newId: newUuid }));
    setBusy(false);
    if (saved) leave();
    else setMessage("Couldn't save. Try again.");
  };

  const save = () => {
    setMessage(null);
    const problems = validateForm(form);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    if (needsScope(original, series, form, initial)) setAsking('scope');
    else void commit('future');
  };

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" onPress={() => (dirty ? setAsking('discard') : leave())} hitSlop={8}>
          <Text style={styles.barButton}>Cancel</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>Edit event</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save"
          accessibilityState={{ disabled: !dirty || busy }}
          disabled={!dirty || busy}
          onPress={save}
          hitSlop={8}
        >
          <Text style={[styles.barButton, styles.strong, (!dirty || busy) && styles.off]}>Save</Text>
        </Pressable>
      </View>
      {message ? <Notice tone="error">{message}</Notice> : null}
      {asking === 'scope' ? (
        <Panel
          title="Change which events?"
          actions={[
            { label: 'This event only', onPress: () => void commit('this') },
            { label: 'This and all future', onPress: () => void commit('future'), strong: true },
            { label: 'Cancel', onPress: () => setAsking(null) },
          ]}
        />
      ) : null}
      {asking === 'discard' ? (
        <Panel
          title="Discard changes?"
          actions={[
            { label: 'Keep editing', onPress: () => setAsking(null), strong: true },
            { label: 'Discard', onPress: leave },
          ]}
        />
      ) : null}
      <EventForm
        form={form}
        errors={errors}
        onChange={setForm}
        members={members}
        memberById={memberById}
        myId={myId}
        showShare={family !== null}
        shareLocked={othersShared}
        repeatLockedMessage={repeatLockedMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f4' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16, backgroundColor: '#007BFF' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  barButton: { color: '#fff', fontSize: 16 },
  strong: { fontWeight: '700' },
  off: { opacity: 0.5 },
  panel: { margin: 16, padding: 16, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  panelTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 8 },
  panelButton: { paddingVertical: 10 },
  panelButtonText: { fontSize: 16, color: '#007BFF' },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#f4f4f4' },
  goneText: { fontSize: 16, color: '#333' },
  link: { color: '#007BFF', fontSize: 16, fontWeight: '600' },
});
```

`app/event/[id]/edit.tsx`:

```tsx
import { EditEventScreen } from '@/components/events/EditEventScreen';

export default EditEventScreen;
```

`components/navigation/RootNavigator.tsx`: inside the signed-in `Stack.Protected` group, after `settings/delete-account`, add
`<Stack.Screen name="event/[id]/edit" options={{ headerShown: false }} />`.

- [ ] **Step 4: Point the planner at the form and remove the sentence edit**

In `app/(tabs)/index.tsx`:
- `handleEditItem` becomes:

```tsx
  const handleEditItem = useCallback((item: LocalEvent) => {
    router.push({ pathname: '/event/[id]/edit', params: { id: item.id } });
  }, []);
```

- Remove `editShared`, `editKeepRef`, `editingItem`, `editingItemRef`, `editingRecord`, `lockShared`, the "Editing: …" banner, and the `if (editing) { … }` branch of `handleAddTask` (keep the add branch). The `ShareToggle` in the input area becomes `shared={shareNew} onChange={setShareNew} disabled={editMode}`; the Add button always says `Add` and uses `styles.addButton` / `styles.addButtonDisabled` only; the input's `editable={!editMode}`; the input area's disabled style applies when `editMode`. Remove the now-unused styles (`editingBanner`, `editingText`, `editingCancel`, `saveButton`) and imports (`planEdit`, `eventToSentence`, `tagsForEditing`, `Visibility` if unused, `useRef`/`EventRecord` if unused). The user-change reset effect keeps `setShareNew(false)` and `setInputText('')`.
- Then: `grep -rn "eventToSentence\|planEdit\|tagsForEditing" app components lib context --include=*.ts --include=*.tsx`. Delete each function that has no callers left outside its own tests, along with those tests: `eventToSentence` (and the `describe('eventToSentence')` block in `lib/events/__tests__/items.test.ts`, including the BUG-005 pins), `lib/events/edits.ts` with `lib/events/__tests__/edits.test.ts`, and `tagsForEditing` with its tests in `lib/family/__tests__/`.

- [ ] **Step 5: Run the tests**

Run: `npx jest components/events "app/(tabs)"` → PASS. Then `npm test`, `npm run typecheck` (delete `.expo/types/router.d.ts` if it rejects `/event/[id]/edit`), `npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add components/events/EditEventScreen.tsx components/events/__tests__/EditEventScreen.test.tsx "app/event/[id]/edit.tsx" components/navigation/RootNavigator.tsx "app/(tabs)/index.tsx" "app/(tabs)/__tests__/planner.test.tsx" lib
git commit -m "BUG-005: Edit events in a form instead of re-reading a sentence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git add lib` stages the deletions of `edits.ts` and the trimmed tests; check `git status` first so nothing unrelated is included.)

---

### Task 9: Docs and registry

**Files:**
- Create: `docs/registry/FEAT-004-event-edit-form.md`
- Modify: `docs/registry/INDEX.md`, `docs/registry/BUG-004-recurrence-extra-occurrence.md`, `docs/registry/BUG-005-evening-edit-moves-event.md`
- Modify: `docs/specs/features.md`, `docs/specs/architecture.md`, `docs/guides/supabase-hosted-setup.md`, `CHANGELOG.md`

- [ ] **Step 1: Registry**

Read `docs/registry/README.md` for the item format, then create `FEAT-004-event-edit-form.md` in the same shape as `FEAT-002-accounts-family-sharing.md`: Type Feature, Status In testing, Priority High, Created 12/10/2026, Updated 13/10/2026, Released in —. Summary: "Edit opens a full-screen form for every field of an event, including how it repeats and when it ends, for one occurrence or this and all future ones." Details: the design and plan paths; the `repeat` column needs `npx supabase db push` on hosted. Links: Fixes BUG-004, BUG-005; Related FEAT-001, FEAT-002.

`BUG-004`: Status Done, Updated 13/10/2026, add "Fixed in FEAT-004: 'for N weeks/months' is a window from the first date, so `weekly for 4 weeks` makes 4 events." `BUG-005`: Status Done, Updated 13/10/2026, add "Fixed in FEAT-004: editing uses a form, so nothing is re-parsed." Update all three rows (and FEAT-004's new row) in `INDEX.md`.

- [ ] **Step 2: Specs, guide and changelog**

- `docs/specs/features.md`: "Last updated: 13/10/2026". Under Recurring events, replace the list with the phrases and note "`for 4 weeks` means a 4-week window from the first date (4 weekly events). Each occurrence is stored as its own event and keeps the rule." Replace the "Edit and delete" section's Edit line with: "Edit opens a form: name, date (dd/mm/yyyy), start and end time, repeat (Daily, Weekly, Fortnightly, Monthly or every N days, weeks or months) ending on a date at most a year on, people, and sharing. For a repeating event, Save asks "This event only" or "This and all future"; changing the repeat or end date always changes this and all future events. Only the creator of a shared event can change how it repeats." Add FEAT-004 under Planned as "(built; device testing next)".
- `docs/specs/architecture.md`: add `lib/events/repeat.ts`, `lib/events/editForm.ts`, `components/events/EventForm.tsx`, `components/events/form/`, `components/events/EditEventScreen.tsx`, `app/event/[id]/edit.tsx` with one-line descriptions "(built, FEAT-004)"; note the `repeat` column next to `series_id`; remove the line saying Edit puts the sentence back in the input box, and any mention of `edits.ts` / `eventToSentence`.
- `docs/guides/supabase-hosted-setup.md`: in the `db push` step, add "Run it again after pulling FEAT-004: it adds the `repeat` column."
- `CHANGELOG.md`: under Unreleased add "Edit events in a form, including how they repeat and when they end (FEAT-004)", "`weekly for 4 weeks` now makes 4 events (BUG-004)", "Editing an evening event no longer moves it to another year (BUG-005)".

- [ ] **Step 3: Check and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint` (docs-only change; they should still pass).

```bash
git add docs CHANGELOG.md
git commit -m "FEAT-004: Document the edit form and close BUG-004 and BUG-005

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After all tasks

- Full check: `npm test`, `npm run typecheck`, `npm run lint`, `npm run db:reset`, `npm run db:test`, `npm run test:integration`.
- Phone check (the user, with Expo Go): edit a single event's name and time; make it weekly ending in a month; edit one occurrence only; edit "this and all future" with a new date; change Weekly → Fortnightly; edit a family member's shared series (repeat locked); delete an event on another phone while the form is open.
- The user pushes the migration to hosted with `npx supabase db push` before testing on the phone against hosted.
