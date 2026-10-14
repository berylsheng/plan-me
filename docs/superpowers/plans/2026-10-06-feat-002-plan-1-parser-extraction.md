# Plan 1: Parser extraction and tests (FEAT-002 phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the pure parsing, date, and storage-shape logic out of `app/(tabs)/index.tsx` into tested modules under `lib/`, and make the project type-check, with no change in behaviour.

**Architecture:** Each concern becomes a small pure module (`lib/dates.ts`, `lib/parse/*`, `lib/events/*`). These are moved, not rewritten: function bodies stay as they are, gaining types and two injectable parameters (`now`, `newId`) so they can be tested. `index.tsx` keeps all UI and state and calls these modules. Jest tests record **current** behaviour, including two known bugs, so later phases can change things safely.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript 5.9, chrono-node 2.9, Jest + jest-expo.

**Spec:** [2026-10-06-accounts-family-sharing-design.md](../specs/2026-10-06-accounts-family-sharing-design.md) §5 (`lib/parse/`) and §9 Phase A. Roadmap: [2026-10-06-feat-002-roadmap.md](2026-10-06-feat-002-roadmap.md).

## Global Constraints

- **No behaviour change.** Moved function bodies stay logically identical. The only allowed differences: types, injected `now` / `newId` / `knownTags` parameters with defaults that reproduce today's behaviour, and not mutating arrays from previous React state.
- Read the Expo SDK 54 docs (https://docs.expo.dev/versions/v54.0.0/) before adding any package (AGENTS.md). The Jest setup below follows https://docs.expo.dev/develop/unit-testing/.
- Dates are NZ (`Pacific/Auckland`). Stored date keys are `yyyy-mm-dd`; display stays as it is today.
- The AsyncStorage key `planMeTasks` and its stored shape do not change.
- No `any`, no `@ts-ignore` / `@ts-expect-error` in new or touched code.
- Every commit message starts with the registry ID: `CHG-004:` (refactor) or the bug ID.
- Windows dev machine: use `npx expo install … "--" --dev` for dev dependencies, as the Expo docs say.

## Review Focus

1. **Events saved by older app versions** (a `time` field, tags inside the name, a missing name or id) must still load, or users lose data on upgrade. Pinned in Task 4 (`migrateStoredItems` tests).
2. **Editing must round-trip:** turning an event back into a sentence and re-parsing it should give the same event, or every edit silently changes the time or name. Pinned in Task 4 (round-trip test). Evening times (20:00+) don't round-trip today — logged as BUG-005 and pinned as current behaviour.
3. **Recurring occurrences must share one `occurrenceId`**, or "delete this and all future" stops working. Pinned in Task 4 (`draftToEvents` test).
4. **Lower-case tags** (`@gs`) must still attach the person. Pinned in Task 3.
5. **A time with no date** ("dentist 9am") goes on the *selected* day, not today. Pinned in Task 3.

## File structure

| File | Responsibility |
|---|---|
| `jest.global-setup.js` | Forces `TZ=Pacific/Auckland` for every test worker |
| `lib/dates.ts` | NZ date keys, time formatting, week ranges |
| `lib/parse/preprocess.ts` | Expands shorthand time ranges before chrono |
| `lib/parse/recurrence.ts` | Finds "weekly for 4 months" etc. and generates dates |
| `lib/parse/tags.ts` | Pulls `@TAG` mentions out of text, for a given tag list |
| `lib/parse/parseEventInput.ts` | Turns a whole sentence into an `EventDraft` (no ids, no state) |
| `lib/events/types.ts` | `LocalEvent`, `ItemsByDate` |
| `lib/events/items.ts` | Sorting, migration of stored data, draft → events, event → sentence |
| `lib/**/__tests__/*.test.ts` | Jest tests next to the code |
| `app/(tabs)/index.tsx` | UI and state only; calls the modules above |

---

### Task 1: Jest setup and `lib/dates.ts`

**Files:**
- Modify: `package.json` (scripts, jest config, dev dependencies)
- Create: `jest.global-setup.js`
- Create: `lib/dates.ts`
- Test: `lib/__tests__/dates.test.ts`
- Create: `docs/registry/CHG-004-extract-parsers.md`; Modify: `docs/registry/INDEX.md`

**Interfaces:**
- Produces:
  - `NZ_TZ: 'Pacific/Auckland'`
  - `formatTime(date: Date): string` → `'HH:mm'`
  - `toNZDateKey(date: Date): string` → `'yyyy-mm-dd'` in NZ time
  - `getNZMonthYear(date: Date): string` → e.g. `'October 2026'`
  - `getWeekRange(dateKey: string): { start: string; end: string }` → Monday–Sunday keys
  - `getWeekDays(dateKey: string): string[]` → 7 keys, Monday first

- [ ] **Step 1: Install Jest**

```bash
npx expo install jest-expo jest @types/jest "--" --dev
```

Expected: `jest-expo`, `jest`, and `@types/jest` added to `devDependencies`.

- [ ] **Step 2: Configure Jest and the scripts**

In `package.json`, set `scripts` to the following (`android`, `ios`, `web`, `start`, `postinstall`, `reset-project` are unchanged; `lint` gains `lib`; `test`, `test:watch`, `typecheck` are new):

```json
  "scripts": {
    "postinstall": "patch-package",
    "start": "expo start",
    "reset-project": "node ./scripts/reset-project.js",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web",
    "lint": "expo lint app components lib",
    "test": "jest",
    "test:watch": "jest --watchAll",
    "typecheck": "tsc --noEmit"
  },
```

Add a top-level `jest` key to `package.json` (the `transformIgnorePatterns` value is copied from the Expo docs):

```json
  "jest": {
    "preset": "jest-expo",
    "globalSetup": "<rootDir>/jest.global-setup.js",
    "testPathIgnorePatterns": ["/node_modules/", "/supabase/"],
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)"
    ]
  },
```

Create `jest.global-setup.js`:

```js
// The app treats the device clock as NZ time (week ranges use local dates),
// so tests run in NZ time whatever the machine is set to.
module.exports = async () => {
  process.env.TZ = 'Pacific/Auckland';
};
```

- [ ] **Step 3: Write the failing test**

Create `lib/__tests__/dates.test.ts`:

```ts
import { formatTime, getNZMonthYear, getWeekDays, getWeekRange, toNZDateKey } from '../dates';

it('runs in NZ time', () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Auckland');
});

describe('toNZDateKey', () => {
  it('uses the NZ calendar date, not UTC', () => {
    // 11:30 UTC on 6 Oct is 00:30 on 7 Oct in NZ daylight time (UTC+13)
    expect(toNZDateKey(new Date('2026-10-06T11:30:00Z'))).toBe('2026-10-07');
    expect(toNZDateKey(new Date('2026-10-06T10:59:00Z'))).toBe('2026-10-06');
  });
});

describe('formatTime', () => {
  it('zero-pads hours and minutes', () => {
    expect(formatTime(new Date(2026, 9, 6, 7, 5))).toBe('07:05');
  });
});

describe('getNZMonthYear', () => {
  it('shows the full month and year', () => {
    expect(getNZMonthYear(new Date(2026, 9, 6))).toBe('October 2026');
  });
});

describe('getWeekRange', () => {
  it('runs Monday to Sunday', () => {
    expect(getWeekRange('2026-10-07')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
  });

  it('keeps a Sunday in the week that ends on it', () => {
    expect(getWeekRange('2026-10-11')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
  });
});

describe('getWeekDays', () => {
  it('lists the seven days, Monday first', () => {
    expect(getWeekDays('2026-10-07')).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx jest lib/__tests__/dates.test.ts`
Expected: FAIL with `Cannot find module '../dates'`.

- [ ] **Step 5: Create `lib/dates.ts` by moving the functions out of `index.tsx`**

Copy the bodies of `formatTime`, `toNZDateKey`, `getNZMonthYear`, `getWeekRange`, `getWeekDays` and the `NZ_TZ` constant from `app/(tabs)/index.tsx` into a new file. **Don't delete them from `index.tsx` yet** (Task 5 does that):

```ts
export const NZ_TZ = 'Pacific/Auckland';

export const formatTime = (date: Date): string => {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

export const toNZDateKey = (date: Date): string => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

export const getNZMonthYear = (date: Date): string => {
  return new Intl.DateTimeFormat('en-NZ', { timeZone: NZ_TZ, month: 'long', year: 'numeric' }).format(date);
};

export const getWeekRange = (dateKey: string): { start: string; end: string } => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(monday.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { start: toNZDateKey(monday), end: toNZDateKey(sunday) };
};

export const getWeekDays = (dateKey: string): string[] => {
  const { start } = getWeekRange(dateKey);
  const [y, m, d] = start.split('-').map(Number);
  const mon = new Date(y, m - 1, d);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(mon);
    day.setDate(day.getDate() + i);
    return toNZDateKey(day);
  });
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest lib/__tests__/dates.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Add the registry item**

Create `docs/registry/CHG-004-extract-parsers.md`:

```markdown
# CHG-004: Extract parsers into `lib/` with tests

| Field | Value |
|---|---|
| Type | Change |
| Status | In progress |
| Priority | High |
| Created | 06/10/2026 |
| Updated | 06/10/2026 |
| Released in | — |

## Summary
FEAT-002 phase A. Move date, parsing, and storage-shape logic out of `app/(tabs)/index.tsx` into `lib/`, add Jest, and make `tsc --noEmit` pass. No behaviour change.

## Details
- [ ] Jest + jest-expo, NZ timezone in tests
- [ ] `lib/dates.ts`, `lib/parse/*`, `lib/events/*` with tests
- [ ] `index.tsx` uses them; `npm run typecheck` reports 0 errors

## Links
- Plan: [plan 1](../superpowers/plans/2026-10-06-feat-002-plan-1-parser-extraction.md)
- Related: FEAT-002, BUG-003, BUG-004
```

In `docs/registry/INDEX.md`, add this row as the last line of the **Changes** table:

```markdown
| [CHG-004](CHG-004-extract-parsers.md) | Extract parsers into `lib/` with tests | In progress | High | 06/10/2026 | — |
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json jest.global-setup.js lib/dates.ts lib/__tests__/dates.test.ts docs/registry/CHG-004-extract-parsers.md docs/registry/INDEX.md
git commit -m "CHG-004: Add Jest and extract NZ date helpers into lib/dates"
```

---

### Task 2: `preprocessInput` and `parseRecurrence`, recording BUG-003 and BUG-004

**Files:**
- Create: `lib/parse/preprocess.ts`, `lib/parse/recurrence.ts`
- Test: `lib/parse/__tests__/preprocess.test.ts`, `lib/parse/__tests__/recurrence.test.ts`
- Create: `docs/registry/BUG-003-hyphen-dates-read-as-times.md`, `docs/registry/BUG-004-recurrence-extra-occurrence.md`; Modify: `docs/registry/INDEX.md`

**Interfaces:**
- Consumes: `toNZDateKey` from `lib/dates.ts` (tests only)
- Produces:
  - `preprocessInput(raw: string): string`
  - `type Recurrence = { cleanText: string; generateDates: (startDate: Date) => Date[] }`
  - `parseRecurrence(text: string): Recurrence | null`. `generateDates` returns the dates *after* `startDate` (not including it)

- [ ] **Step 1: Write the failing tests**

Create `lib/parse/__tests__/preprocess.test.ts`:

```ts
import { preprocessInput } from '../preprocess';

describe('preprocessInput', () => {
  it.each([
    ['2-5pm dancing', '2pm-5pm dancing'],
    ['11-4pm', '11am-4pm'],           // start > end with pm → start is am
    ['11-4 lunch', '11am-4pm lunch'], // no suffix, start > end → crosses noon
    ['12-2pm', '12pm-2pm'],
    ['5:15-6:15pm', '5:15pm-6:15pm'],
    ['11:30-2:45pm', '11:30am-2:45pm'],
    ['2-5', '2-5'],                   // no suffix, start < end → left alone
  ])('%s → %s', (input, expected) => {
    expect(preprocessInput(input)).toBe(expected);
  });

  // BUG-003: hyphenated dates are read as time ranges. Recorded as-is; fix separately.
  it.each([
    ['12-10 party', '12pm-10pm party'],
    ['10-06', '10am-06pm'],
  ])('BUG-003 current behaviour: %s → %s', (input, expected) => {
    expect(preprocessInput(input)).toBe(expected);
  });
});
```

Create `lib/parse/__tests__/recurrence.test.ts`:

```ts
import { toNZDateKey } from '../../dates';
import { parseRecurrence } from '../recurrence';

const keys = (dates: Date[]) => dates.map(toNZDateKey);

describe('parseRecurrence', () => {
  it('returns null when there is no recurrence phrase', () => {
    expect(parseRecurrence('dinner tomorrow 6pm')).toBeNull();
  });

  it('removes the phrase (and its leading comma) from the text', () => {
    expect(parseRecurrence('swim, 13 October 7am, weekly for 4 weeks')?.cleanText).toBe('swim, 13 October 7am');
  });

  // BUG-004: each case makes one occurrence more than the phrase says, because these
  // dates come on top of the start date. Recorded as-is; fix separately.
  it('weekly for 4 weeks gives 4 dates after the start (BUG-004: 5 events in total)', () => {
    const r = parseRecurrence('swim weekly for 4 weeks')!;
    expect(keys(r.generateDates(new Date(2026, 9, 13, 7)))).toEqual([
      '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10',
    ]);
  });

  it('every 2 weeks for 2 months uses 60 days', () => {
    const r = parseRecurrence('gym every 2 weeks for 2 months')!;
    expect(keys(r.generateDates(new Date(2026, 9, 15, 6)))).toEqual([
      '2026-10-29', '2026-11-12', '2026-11-26', '2026-12-10',
    ]);
  });

  it('monthly for 3 months steps by calendar month', () => {
    const r = parseRecurrence('rent, monthly for 3 months')!;
    expect(keys(r.generateDates(new Date(2026, 10, 1)))).toEqual([
      '2026-12-01', '2027-01-01', '2027-02-01',
    ]);
  });

  it('is case-insensitive', () => {
    expect(parseRecurrence('yoga Daily For 2 Weeks')?.cleanText).toBe('yoga');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest lib/parse`
Expected: FAIL with `Cannot find module '../preprocess'` and `Cannot find module '../recurrence'`.

- [ ] **Step 3: Create the modules by moving the code**

Create `lib/parse/preprocess.ts` (body copied from `index.tsx`, now exported):

```ts
// Expand shorthand time ranges before chrono parses them.
// Handles both bare hours (2-5pm) and times with minutes (5:15-6:15pm).
// "2-5pm"        → "2pm-5pm"
// "11-4pm"       → "11am-4pm"    (start > end with pm → start must be am)
// "11-4"         → "11am-4pm"    (no suffix, start > end → crosses noon)
// "11:30-2:45pm" → "11:30am-2:45pm"
// "5:15-6:15pm"  → "5:15pm-6:15pm"
export const preprocessInput = (raw: string): string => {
  // Pattern: H[:MM]-H[:MM] am/pm
  let out = raw.replace(/\b(\d{1,2}(?::\d{2})?)-(\d{1,2}(?::\d{2})?)\s*(am|pm)\b/gi, (_, s: string, e: string, mer: string) => {
    const startH = parseInt(s, 10), endH = parseInt(e, 10), m = mer.toLowerCase();
    if (startH === 12) return `${s}${m}-${e}${m}`;
    if (startH > endH && m === 'pm') return `${s}am-${e}${m}`;
    return `${s}${m}-${e}${m}`;
  });
  // Pattern: H[:MM]-H[:MM] with no am/pm suffix
  out = out.replace(/\b(\d{1,2}(?::\d{2})?)-(\d{1,2}(?::\d{2})?)\b(?!\s*(?:am|pm))/gi, (match: string, s: string, e: string) => {
    const startH = parseInt(s, 10), endH = parseInt(e, 10);
    if (startH > endH) return `${startH === 12 ? `${s}pm` : `${s}am`}-${e}pm`;
    return match;
  });
  return out;
};
```

Create `lib/parse/recurrence.ts`. The body is copied unchanged; only the return type is corrected, since the old annotation `{ cleanText, dates }` didn't match what the function returns:

```ts
export type Recurrence = {
  /** The input with the recurrence phrase removed. */
  cleanText: string;
  /** Dates after `startDate` (not including it) for the remaining occurrences. */
  generateDates: (startDate: Date) => Date[];
};

// Parse recurrence patterns like "weekly for 4 months", "daily for 2 weeks", "every 2 weeks for 6 months"
export const parseRecurrence = (text: string): Recurrence | null => {
  const pattern = /,?\s*(?:(daily|weekly|fortnightly|monthly)|every\s+(\d+)\s+(days?|weeks?|months?))\s+for\s+(\d+)\s+(weeks?|months?)/i;
  const match = text.match(pattern);
  if (!match) return null;

  const keyword = (match[1] || '').toLowerCase();
  const everyN = match[2] ? parseInt(match[2], 10) : 0;
  const everyUnit = (match[3] || '').toLowerCase().replace(/s$/, '');
  const duration = parseInt(match[4], 10);
  const durationUnit = match[5].toLowerCase().replace(/s$/, '');

  let intervalDays = 7;
  if (keyword === 'daily' || everyUnit === 'day') intervalDays = everyN || 1;
  else if (keyword === 'weekly' || everyUnit === 'week') intervalDays = (everyN || 1) * 7;
  else if (keyword === 'fortnightly') intervalDays = 14;
  else if (keyword === 'monthly' || everyUnit === 'month') intervalDays = -1;

  const totalDays = durationUnit === 'month' ? duration * 30 : duration * 7;
  const cleanText = text.replace(match[0], '').trim();

  return {
    cleanText,
    generateDates: (startDate: Date): Date[] => {
      const dates: Date[] = [];
      let current = new Date(startDate);

      if (intervalDays === -1) {
        // monthly recurrence
        const totalMonths = durationUnit === 'month' ? duration : Math.ceil(duration / 4);
        for (let i = 1; i <= totalMonths; i++) {
          const next = new Date(current);
          next.setMonth(next.getMonth() + i * (everyN || 1));
          dates.push(next);
        }
      } else {
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + totalDays);
        current = new Date(startDate);
        current.setDate(current.getDate() + intervalDays);
        while (current <= endDate) {
          dates.push(new Date(current));
          current.setDate(current.getDate() + intervalDays);
        }
      }
      return dates;
    },
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest lib/parse`
Expected: PASS (9 preprocess cases, 6 recurrence tests). These record existing behaviour. The expected values were checked by running the original `index.tsx` code. If one fails, compare the moved body with `index.tsx` character by character; don't change the expectation.

- [ ] **Step 5: Record the two bugs in the registry**

Create `docs/registry/BUG-003-hyphen-dates-read-as-times.md`:

```markdown
# BUG-003: Hyphenated dates are read as time ranges

| Field | Value |
|---|---|
| Type | Bug |
| Status | Proposed |
| Priority | Medium |
| Created | 06/10/2026 |
| Updated | 06/10/2026 |
| Released in | — |

## Summary
`preprocessInput` treats any `N-N` as a time range, so day-month dates written with a hyphen become times.

## Details
- Steps: select 8 October, type `12-10 party`, press Add.
- Expected: "party" on 12 October (or a prompt asking what was meant).
- Actual: "party" from 12:00 to 22:00 on 8 October. `10-06` becomes `10am-06pm`.
- Pinned by `lib/parse/__tests__/preprocess.test.ts` ("BUG-003 current behaviour"). Update those cases when fixing.

## Links
- Related: CHG-004
```

Create `docs/registry/BUG-004-recurrence-extra-occurrence.md`:

```markdown
# BUG-004: Recurring events get one occurrence too many

| Field | Value |
|---|---|
| Type | Bug |
| Status | Proposed |
| Priority | Medium |
| Created | 06/10/2026 |
| Updated | 06/10/2026 |
| Released in | — |

## Summary
`generateDates` counts the duration from the start date and the start date is added on top, so every recurrence creates one extra event.

## Details
- Steps: type `swim, 13 October 7am, weekly for 4 weeks`.
- Expected: 4 swims (13, 20, 27 Oct, 3 Nov). Decide whether "for 4 weeks" means 4 occurrences or a 4-week window.
- Actual: 5 swims (adds 10 Nov). `monthly for 3 months` gives 4 events; `every 2 weeks for 2 months` gives 5.
- Pinned by `lib/parse/__tests__/recurrence.test.ts`. Update those cases when fixing.

## Links
- Related: CHG-004
```

In `docs/registry/INDEX.md`, add these rows as the last lines of the **Bugs** table:

```markdown
| [BUG-003](BUG-003-hyphen-dates-read-as-times.md) | Hyphenated dates are read as time ranges | Proposed | Medium | 06/10/2026 | — |
| [BUG-004](BUG-004-recurrence-extra-occurrence.md) | Recurring events get one occurrence too many | Proposed | Medium | 06/10/2026 | — |
```

- [ ] **Step 6: Commit**

```bash
git add lib/parse docs/registry
git commit -m "CHG-004: Extract time-range and recurrence parsing; log BUG-003 and BUG-004"
```

---

### Task 3: Tag extraction and `parseEventInput`

**Files:**
- Create: `lib/parse/tags.ts`, `lib/parse/parseEventInput.ts`
- Test: `lib/parse/__tests__/tags.test.ts`, `lib/parse/__tests__/parseEventInput.test.ts`

**Interfaces:**
- Consumes: `preprocessInput` (Task 2), `parseRecurrence` (Task 2), `formatTime` and `toNZDateKey` (Task 1)
- Produces:
  - `DEFAULT_TAGS: readonly ['AZ', 'GS']`
  - `extractTags(text: string, knownTags: readonly string[]): { text: string; tags: string[] }`. Tags are returned upper-case; `text` has the mentions removed but is **not** trimmed
  - `type EventDraft = { name: string; startTime: string; endTime: string; people: string[]; dateKeys: string[]; isRecurring: boolean }`
  - `type ParseResult = { ok: true; draft: EventDraft } | { ok: false; error: 'no-date-or-time' }`
  - `type ParseOptions = { selectedDateKey: string; knownTags?: readonly string[]; now?: Date }`
  - `parseEventInput(input: string, options: ParseOptions): ParseResult`

- [ ] **Step 1: Write the failing tests**

Create `lib/parse/__tests__/tags.test.ts`:

```ts
import { DEFAULT_TAGS, extractTags } from '../tags';

describe('extractTags', () => {
  it('finds known tags in any case and returns them upper-case', () => {
    const result = extractTags('dinner @az @GS', DEFAULT_TAGS);
    expect(result.tags).toEqual(['AZ', 'GS']);
    expect(result.text.trim()).toBe('dinner');
  });

  it('only matches whole tags', () => {
    expect(extractTags('meet @AZX', ['AZ']).tags).toEqual([]);
  });

  it('accepts a family-specific tag list', () => {
    expect(extractTags('lunch @ZQ', ['ZQ']).tags).toEqual(['ZQ']);
  });

  it('ignores tags that are not 2-4 letters, so they cannot inject regex syntax', () => {
    expect(extractTags('a @A.B', ['A.B'])).toEqual({ text: 'a @A.B', tags: [] });
  });

  it('does nothing with an empty tag list', () => {
    expect(extractTags('lunch @AZ', [])).toEqual({ text: 'lunch @AZ', tags: [] });
  });
});
```

Create `lib/parse/__tests__/parseEventInput.test.ts`. The expected values came from running the original `handleAddTask` logic:

```ts
import { parseEventInput } from '../parseEventInput';

// Tuesday 6 October 2026, 9am NZ. The calendar has Thursday 8 October selected.
const now = new Date(2026, 9, 6, 9, 0);
const opts = { selectedDateKey: '2026-10-08', now };

const draftOf = (input: string) => {
  const result = parseEventInput(input, opts);
  if (!result.ok) throw new Error(`expected "${input}" to parse`);
  return result.draft;
};

describe('parseEventInput', () => {
  it('reads date, time range, name and people', () => {
    expect(draftOf('12 October, 6-8pm, dancing @AZ')).toEqual({
      name: 'dancing', startTime: '18:00', endTime: '20:00', people: ['AZ'],
      dateKeys: ['2026-10-12'], isRecurring: false,
    });
  });

  it('puts a time with no date on the selected day, not today', () => {
    expect(draftOf('dentist 9am')).toEqual({
      name: 'dentist', startTime: '09:00', endTime: '', people: [],
      dateKeys: ['2026-10-08'], isRecurring: false,
    });
  });

  it('expands shorthand ranges that cross noon', () => {
    expect(draftOf('11-4 lunch')).toMatchObject({ name: 'lunch', startTime: '11:00', endTime: '16:00' });
  });

  it('accepts lower-case tags', () => {
    expect(draftOf('lunch 14 October @gs')).toEqual({
      name: 'lunch', startTime: '', endTime: '', people: ['GS'],
      dateKeys: ['2026-10-14'], isRecurring: false,
    });
  });

  it('names an event with only a date and time "Busy"', () => {
    expect(draftOf('12 October 6pm').name).toBe('Busy');
  });

  it('expands recurrence into date keys, starting with the first date', () => {
    expect(draftOf('swim, 13 October 7am, weekly for 4 weeks')).toEqual({
      name: 'swim', startTime: '07:00', endTime: '', people: [],
      dateKeys: ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'], // BUG-004
      isRecurring: true,
    });
  });

  it('uses the tag list it is given', () => {
    const result = parseEventInput('lunch 14 October @ZQ', { ...opts, knownTags: ['ZQ'] });
    expect(result.ok && result.draft.people).toEqual(['ZQ']);
  });

  it('rejects a sentence with no date or time', () => {
    expect(parseEventInput('hello', opts)).toEqual({ ok: false, error: 'no-date-or-time' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest lib/parse/__tests__/tags.test.ts lib/parse/__tests__/parseEventInput.test.ts`
Expected: FAIL with `Cannot find module '../tags'` and `Cannot find module '../parseEventInput'`.

- [ ] **Step 3: Create `lib/parse/tags.ts`**

```ts
// The two people tagged before families existed. Family member tags replace these in FEAT-002.
export const DEFAULT_TAGS = ['AZ', 'GS'] as const;

const SAFE_TAG = /^[A-Za-z]{2,4}$/;

/** Remove `@TAG` mentions for the given tags. Returned tags are upper-case; text is not trimmed. */
export const extractTags = (text: string, knownTags: readonly string[]): { text: string; tags: string[] } => {
  const safe = knownTags.filter(t => SAFE_TAG.test(t));
  if (safe.length === 0) return { text, tags: [] };

  const tags: string[] = [];
  const stripped = text.replace(new RegExp(`@(${safe.join('|')})\\b`, 'gi'), (_, tag: string) => {
    tags.push(tag.toUpperCase());
    return '';
  });
  return { text: stripped, tags };
};
```

- [ ] **Step 4: Create `lib/parse/parseEventInput.ts` by moving the parsing half of `handleAddTask`**

The logic is the same as `handleAddTask` in `index.tsx`, from "Extract person tags" down to building the list of dates. Two changes: chrono gets the `now` reference, and the result is returned instead of being written to state:

```ts
import * as chrono from 'chrono-node';

import { formatTime, toNZDateKey } from '../dates';
import { preprocessInput } from './preprocess';
import { parseRecurrence } from './recurrence';
import { DEFAULT_TAGS, extractTags } from './tags';

export type EventDraft = {
  name: string;
  startTime: string; // 'HH:mm' or ''
  endTime: string; // 'HH:mm' or ''
  people: string[];
  dateKeys: string[]; // the first date, then any recurring dates
  isRecurring: boolean;
};

export type ParseResult =
  | { ok: true; draft: EventDraft }
  | { ok: false; error: 'no-date-or-time' };

export type ParseOptions = {
  /** Used when the sentence has a time but no date. */
  selectedDateKey: string;
  knownTags?: readonly string[];
  /** Reference time for relative dates such as "tomorrow". */
  now?: Date;
};

export const parseEventInput = (
  input: string,
  { selectedDateKey, knownTags = DEFAULT_TAGS, now = new Date() }: ParseOptions,
): ParseResult => {
  const { text: withoutTags, tags: people } = extractTags(input, knownTags);
  const tagStripped = withoutTags.replace(/,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').trim();

  // Check for recurrence pattern before other processing
  const recurrence = parseRecurrence(tagStripped);
  const textForParsing = recurrence ? recurrence.cleanText : tagStripped;

  // Normalise shorthand ranges before chrono sees them
  const processedInput = preprocessInput(textForParsing);
  const parsedResults = chrono.parse(processedInput, now);

  const dateResult = parsedResults.find(r => r.start.isCertain('day') || r.start.isCertain('month'));
  const timeResult = parsedResults.find(r => r.start.isCertain('hour'));
  if (!dateResult && !timeResult) return { ok: false, error: 'no-date-or-time' };

  // Use parsed date, or fall back to the currently selected date on the calendar
  let baseDateObj: Date;
  let dateKey: string;
  if (dateResult) {
    baseDateObj = dateResult.start.date();
    dateKey = toNZDateKey(baseDateObj);
  } else {
    dateKey = selectedDateKey;
    const [y, m, d] = dateKey.split('-').map(Number);
    baseDateObj = new Date(y, m - 1, d);
  }

  const startTime = new Date(baseDateObj);
  if (timeResult && timeResult !== dateResult) {
    const t = timeResult.start.date();
    startTime.setHours(t.getHours(), t.getMinutes(), 0, 0);
  }

  let startTimeStr = '';
  let endTimeStr = '';
  if (timeResult?.start.isCertain('hour')) {
    startTimeStr = formatTime(startTime);
    const endSource = timeResult.end ?? dateResult?.end;
    if (endSource) {
      const endTime = new Date(baseDateObj);
      const e = endSource.date();
      endTime.setHours(e.getHours(), e.getMinutes(), 0, 0);
      endTimeStr = formatTime(endTime);
    }
  }

  // Strip parsed text from processedInput (not original) so positions match
  let name = processedInput;
  for (const r of parsedResults) {
    name = name.replace(r.text, '');
  }
  name = name.replace(/^[\s,]+|[\s,]+$/g, '').trim() || 'Busy';

  // The base date + any recurring dates
  const dateKeys = [dateKey];
  if (recurrence) {
    for (const d of recurrence.generateDates(baseDateObj)) dateKeys.push(toNZDateKey(d));
  }

  return {
    ok: true,
    draft: { name, startTime: startTimeStr, endTime: endTimeStr, people, dateKeys, isRecurring: recurrence !== null },
  };
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest lib/parse`
Expected: PASS, all parse tests (5 tags, 8 parseEventInput, plus Task 2's).

- [ ] **Step 6: Commit**

```bash
git add lib/parse
git commit -m "CHG-004: Extract tag extraction and sentence parsing into lib/parse"
```

---

### Task 4: Event types and storage helpers

**Files:**
- Create: `lib/events/types.ts`, `lib/events/items.ts`
- Test: `lib/events/__tests__/items.test.ts`

**Interfaces:**
- Consumes: `extractTags`, `DEFAULT_TAGS` (Task 3); `EventDraft`, `parseEventInput` (Task 3, the latter in tests only)
- Produces:
  - `type LocalEvent = { id: string; dateKey: string; name: string; startTime: string; endTime: string; people?: string[]; occurrenceId?: string }`
  - `type ItemsByDate = Record<string, LocalEvent[]>`
  - `newEventId(): string`
  - `sortItems(items: ItemsByDate): ItemsByDate`
  - `migrateStoredItems(stored: Record<string, StoredEvent[]>, newId?: () => string, knownTags?: readonly string[]): ItemsByDate`, returned sorted
  - `draftToEvents(draft: EventDraft, newId: () => string, seriesId: string | null): LocalEvent[]`
  - `eventToSentence(item: LocalEvent): string`

- [ ] **Step 1: Write the failing tests**

Create `lib/events/__tests__/items.test.ts`:

```ts
import { parseEventInput } from '../../parse/parseEventInput';
import { draftToEvents, eventToSentence, migrateStoredItems, sortItems } from '../items';
import type { LocalEvent } from '../types';

const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const event = (overrides: Partial<LocalEvent>): LocalEvent => ({
  id: 'x', dateKey: '2026-10-12', name: 'dancing', startTime: '', endTime: '', ...overrides,
});

describe('sortItems', () => {
  it('orders dates, then events by start time and end time, untimed first', () => {
    const sorted = sortItems({
      '2026-10-07': [
        event({ id: 'b', startTime: '10:00' }),
        event({ id: 'a' }),
        event({ id: 'c', startTime: '09:00', endTime: '11:00' }),
        event({ id: 'd', startTime: '09:00', endTime: '10:00' }),
      ],
      '2026-10-06': [],
    });
    expect(Object.keys(sorted)).toEqual(['2026-10-06', '2026-10-07']);
    expect(sorted['2026-10-07'].map(e => e.id)).toEqual(['a', 'd', 'c', 'b']);
  });
});

describe('migrateStoredItems', () => {
  it('upgrades the oldest shape: no id, a single time field, tags inside the name', () => {
    expect(migrateStoredItems({ '2026-10-06': [{ time: '09:00-10:00', name: 'gym @AZ' }] }, counter())).toEqual({
      '2026-10-06': [{
        id: 'id-1', dateKey: '2026-10-06', name: 'gym', startTime: '09:00', endTime: '10:00', people: ['AZ'],
      }],
    });
  });

  it('leaves current events alone', () => {
    const current = event({ id: 'keep', dateKey: '2026-10-07', name: 'swim', startTime: '07:00', people: ['GS'], occurrenceId: '1_occ' });
    expect(migrateStoredItems({ '2026-10-07': [current] }, counter())).toEqual({ '2026-10-07': [current] });
  });

  it('copes with a missing name and adds no people when there are no tags', () => {
    const [migrated] = migrateStoredItems({ '2026-10-06': [{ id: 'y', startTime: '', endTime: '' }] }, counter())['2026-10-06'];
    expect(migrated).toEqual({ id: 'y', dateKey: '2026-10-06', name: '', startTime: '', endTime: '' });
    expect(migrated).not.toHaveProperty('people');
  });
});

describe('draftToEvents', () => {
  const draft = {
    name: 'swim', startTime: '07:00', endTime: '', people: [] as string[],
    dateKeys: ['2026-10-13', '2026-10-20'], isRecurring: true,
  };

  it('makes one event per date, all sharing the series id', () => {
    expect(draftToEvents(draft, counter(), 's1')).toEqual([
      { id: 'id-1', dateKey: '2026-10-13', name: 'swim', startTime: '07:00', endTime: '', occurrenceId: 's1' },
      { id: 'id-2', dateKey: '2026-10-20', name: 'swim', startTime: '07:00', endTime: '', occurrenceId: 's1' },
    ]);
  });

  it('adds people and leaves out occurrenceId for a one-off event', () => {
    const [one] = draftToEvents({ ...draft, people: ['AZ'], dateKeys: ['2026-10-13'], isRecurring: false }, counter(), null);
    expect(one.people).toEqual(['AZ']);
    expect(one).not.toHaveProperty('occurrenceId');
  });
});

describe('eventToSentence', () => {
  it('writes date, time range, name and tags', () => {
    expect(eventToSentence(event({ startTime: '18:00', endTime: '20:00', people: ['AZ'] })))
      .toBe('12 October, 18:00-20:00, dancing @AZ');
  });

  it('drops the empty time part', () => {
    expect(eventToSentence(event({}))).toBe('12 October, dancing');
  });

  it('round-trips through the parser unchanged', () => {
    const original = event({ startTime: '18:00', endTime: '20:00', people: ['AZ'] });
    const result = parseEventInput(eventToSentence(original), { selectedDateKey: '2026-10-08', now: new Date(2026, 9, 6, 9) });
    expect(result.ok && result.draft).toMatchObject({
      name: 'dancing', startTime: '18:00', endTime: '20:00', people: ['AZ'], dateKeys: ['2026-10-12'],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest lib/events`
Expected: FAIL with `Cannot find module '../items'`.

- [ ] **Step 3: Create `lib/events/types.ts`**

```ts
/** An event as stored on the device under the AsyncStorage key `planMeTasks`. */
export type LocalEvent = {
  id: string;
  dateKey: string; // 'yyyy-mm-dd', NZ time
  name: string;
  startTime: string; // 'HH:mm' or ''
  endTime: string; // 'HH:mm' or ''
  people?: string[]; // person tags, e.g. 'AZ'
  occurrenceId?: string; // shared by every occurrence of one recurring event
};

/** Events grouped by date key, each day sorted by start time. */
export type ItemsByDate = Record<string, LocalEvent[]>;
```

- [ ] **Step 4: Create `lib/events/items.ts`**

`sortItems` and the `eventToSentence` formatting are moved from `index.tsx` (`sortItems` and `handleEditItem`); `migrateStoredItems` is the migration loop from `loadData`; `draftToEvents` is the event-building loop from `handleAddTask`.

```ts
import type { EventDraft } from '../parse/parseEventInput';
import { DEFAULT_TAGS, extractTags } from '../parse/tags';
import type { ItemsByDate, LocalEvent } from './types';

/** Anything older app versions may have saved. */
export type StoredEvent = Partial<LocalEvent> & { time?: string };

export const newEventId = (): string => Date.now().toString() + Math.random().toString(36).slice(2);

export const sortItems = (itemsObj: ItemsByDate): ItemsByDate => {
  const sorted: ItemsByDate = {};
  for (const key of Object.keys(itemsObj).sort()) {
    sorted[key] = [...itemsObj[key]].sort((a, b) => {
      const startCmp = (a.startTime || '').localeCompare(b.startTime || '');
      if (startCmp !== 0) return startCmp;
      return (a.endTime || '').localeCompare(b.endTime || '');
    });
  }
  return sorted;
};

/** Bring events saved by older app versions up to the current shape. */
export const migrateStoredItems = (
  stored: Record<string, StoredEvent[]>,
  newId: () => string = newEventId,
  knownTags: readonly string[] = DEFAULT_TAGS,
): ItemsByDate => {
  const migrated: ItemsByDate = {};
  for (const dateKey of Object.keys(stored)) {
    migrated[dateKey] = stored[dateKey].map(({ time, ...item }) => {
      // Older versions kept "HH:mm-HH:mm" in a single `time` field
      let { startTime, endTime } = item;
      if (time !== undefined && startTime === undefined) {
        const parts = time.split('-');
        startTime = parts[0] || '';
        endTime = parts[1] || '';
      }
      const event: LocalEvent = {
        ...item,
        id: item.id ?? newId(),
        dateKey: item.dateKey ?? dateKey,
        name: item.name ?? '',
        startTime: startTime ?? '',
        endTime: endTime ?? '',
      };
      // Older versions kept person tags inside the name
      if (!event.people) {
        const { text, tags } = extractTags(event.name, knownTags);
        event.name = text.trim();
        if (tags.length > 0) event.people = tags;
      }
      return event;
    });
  }
  return sortItems(migrated);
};

/** One event per date in the draft; recurring ones share `seriesId` as their occurrenceId. */
export const draftToEvents = (draft: EventDraft, newId: () => string, seriesId: string | null): LocalEvent[] =>
  draft.dateKeys.map(dateKey => {
    const event: LocalEvent = {
      id: newId(),
      dateKey,
      name: draft.name,
      startTime: draft.startTime,
      endTime: draft.endTime,
    };
    if (draft.people.length > 0) event.people = draft.people;
    if (seriesId) event.occurrenceId = seriesId;
    return event;
  });

/** The sentence the input box shows when editing an event. */
export const eventToSentence = (item: LocalEvent): string => {
  const [y, m, d] = item.dateKey.split('-').map(Number);
  const monthName = new Date(y, m - 1, d).toLocaleString('en-NZ', { month: 'long' });
  const datePart = `${d} ${monthName}`;
  const timePart = item.endTime ? `${item.startTime}-${item.endTime}` : item.startTime;
  const peoplePart = item.people?.map(t => `@${t}`).join(' ') || '';
  return `${datePart}, ${timePart}, ${item.name} ${peoplePart}`
    .replace(/,\s*,/g, ',')
    .replace(/^,\s*|,\s*$/g, '')
    .trim();
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest`
Expected: PASS, every suite (dates, preprocess, recurrence, tags, parseEventInput, items).

- [ ] **Step 6: Commit**

```bash
git add lib/events
git commit -m "CHG-004: Extract event types, sorting, migration and edit-sentence helpers"
```

---

### Task 5: Make `index.tsx` use `lib/` and type-check

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `docs/specs/architecture.md`, `docs/registry/CHG-004-extract-parsers.md`, `docs/registry/INDEX.md`

**Interfaces:**
- Consumes: everything produced by Tasks 1–4.
- Produces: no new API. `npm run typecheck` passes with 0 errors (45 today, all in this file).

- [ ] **Step 1: Confirm the starting point**

Run: `npm run typecheck`
Expected: FAIL, `Found 45 errors in the same file` (all in `app/(tabs)/index.tsx`).

- [ ] **Step 2: Replace the imports and delete the moved functions**

Replace the first five import lines with:

```ts
import React, { useState, useEffect, useCallback, useRef, useMemo, useContext, createContext } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Pressable, Image, SectionList, Modal, PanResponder } from 'react-native';
import { Calendar, type DateData } from 'react-native-calendars';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getNZMonthYear, getWeekDays, getWeekRange, toNZDateKey } from '@/lib/dates';
import { draftToEvents, eventToSentence, migrateStoredItems, newEventId, sortItems } from '@/lib/events/items';
import type { ItemsByDate, LocalEvent } from '@/lib/events/types';
import { parseEventInput } from '@/lib/parse/parseEventInput';
```

Delete everything from the line `// Expand shorthand time ranges before chrono parses them.` down to and including the closing `};` of `getWeekDays` (the line just before `const DAY_LABELS`). That removes `preprocessInput`, `NZ_TZ`, `parseRecurrence`, `formatTime`, `toNZDateKey`, `getNZMonthYear`, `sortItems`, `getWeekRange`, `getWeekDays`. Keep `DAY_LABELS`.

- [ ] **Step 3: Type the contexts, icons, and event row**

Replace the context and icon declarations at the top with:

```ts
type DisplayEvent = LocalEvent & { _isPast: boolean };

const EditModeContext = createContext(false);
const HandlersContext = createContext<{ onEdit: (item: LocalEvent) => void; onDelete: (item: LocalEvent) => void }>({
  onEdit: () => {},
  onDelete: () => {},
});
type ViewMode = 'today' | 'week' | 'all';

const PERSON_ICONS: Record<string, number> = {
  AZ: require('../../assets/images/icon_az.png'),
  GS: require('../../assets/images/icon_gs.png'),
};
```

Change the `EventItem` signature line to:

```ts
const EventItem = React.memo(function EventItem({ item }: { item: DisplayEvent }) {
```

and in its body change `item.people?.map((tag: string) => (` to `item.people?.map(tag => (`.

- [ ] **Step 4: Type state and the simple handlers**

In `App`, make these exact replacements:

| Find | Replace with |
|---|---|
| `const [items, setItems] = useState({});` | `const [items, setItems] = useState<ItemsByDate>({});` |
| `const [editingItem, setEditingItem] = useState(null);` | `const [editingItem, setEditingItem] = useState<LocalEvent \| null>(null);` |
| `const editingItemRef = useRef(null);` | `const editingItemRef = useRef<LocalEvent \| null>(null);` |
| `const handleDayPress = useCallback((day) => {` | `const handleDayPress = useCallback((day: DateData) => {` |
| `const saveData = async (newItems) => {` | `const saveData = async (newItems: ItemsByDate) => {` |
| `const deleteSingleItem = useCallback((item) => {` | `const deleteSingleItem = useCallback((item: LocalEvent) => {` |
| `const deleteFutureOccurrences = useCallback((item) => {` | `const deleteFutureOccurrences = useCallback((item: LocalEvent) => {` |
| `const handleDeleteItem = useCallback((item) => {` | `const handleDeleteItem = useCallback((item: LocalEvent) => {` |
| `const marks = {};` | `const marks: Record<string, { marked?: boolean; dotColor?: string; selected?: boolean; selectedColor?: string }> = {};` |
| `const sections: { title: string, dateKey: string, data: any[] }[] = [];` | `const sections: { title: string; dateKey: string; data: DisplayEvent[] }[] = [];` |

- [ ] **Step 5: Replace `loadData`**

Replace the whole `loadData` function with:

```ts
  const loadData = async () => {
    try {
      const storedData = await AsyncStorage.getItem('planMeTasks');
      if (storedData) {
        const sorted = migrateStoredItems(JSON.parse(storedData));
        setItems(sorted);
        saveData(sorted);
      }
    } catch (e) {
      console.error("Failed to load data", e);
    }
  };
```

- [ ] **Step 6: Replace `handleAddTask`**

Replace everything from `const handleAddTask = () => {` to the `};` that follows `setInputText('');` with the code below. The one intentional difference: new events are added to copies of the day arrays instead of being pushed into arrays from the previous state.

```ts
  const handleAddTask = () => {
    if (!inputText.trim()) return;

    const result = parseEventInput(inputText, { selectedDateKey: selectedDateRef.current });
    if (!result.ok) {
      Alert.alert("Oops!", "I couldn't find a date or time in that sentence.");
      return;
    }

    const seriesId = result.draft.isRecurring ? Date.now().toString() + '_occ' : null;

    setItems(prev => {
      const newItems = { ...prev };

      const editing = editingItemRef.current;
      if (editing) {
        const oldDate = editing.dateKey;
        if (newItems[oldDate]) {
          newItems[oldDate] = newItems[oldDate].filter(i => i.id !== editing.id);
          if (newItems[oldDate].length === 0) delete newItems[oldDate];
        }
        editingItemRef.current = null;
        setEditingItem(null);
      }

      for (const item of draftToEvents(result.draft, newEventId, seriesId)) {
        newItems[item.dateKey] = [...(newItems[item.dateKey] ?? []), item];
      }

      const sorted = sortItems(newItems);
      saveData(sorted);
      return sorted;
    });
    setInputText('');
  };
```

- [ ] **Step 7: Replace `handleEditItem`**

```ts
  const handleEditItem = useCallback((item: LocalEvent) => {
    editingItemRef.current = item;
    setEditingItem(item);
    setInputText(eventToSentence(item));
  }, []);
```

- [ ] **Step 8: Type-check, lint, and test**

Run: `npm run typecheck`
Expected: PASS, no output. If any error remains, fix it with a narrower type, not `any` or a suppression comment.

Run: `npm run lint`
Expected: no errors (the existing `react-hooks/exhaustive-deps` warning on the `loadData` effect may stay).

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 9: Smoke-test the app on a device**

Run: `npx expo start`, open the app on your phone (dev build or Expo Go), and check:
- [ ] Events saved before this change are still there
- [ ] `12 October, 6-8pm, dancing @AZ` → 18:00–20:00 "dancing" on 12 Oct with the AZ avatar
- [ ] `dentist 9am` with 8 Oct selected → 09:00 on 8 Oct
- [ ] `swim, 13 October 7am, weekly for 4 weeks` → 5 swims; delete the second with "this and all future" → only 13 Oct remains
- [ ] Modify → Edit on "dancing" shows `12 October, 18:00-20:00, dancing @AZ`; Save without changes → the event is unchanged
- [ ] `hello` → the "Oops!" alert
- [ ] Today / Week / All, swiping weeks, and the month picker behave as before

- [ ] **Step 10: Update docs and the registry**

In `docs/specs/architecture.md`:
- In §2.1, replace the line `  (tabs)/index.tsx      The whole planner (parsing, storage, UI) — ~690 lines` with:

```
  (tabs)/index.tsx      Planner UI and state
lib/
  dates.ts              NZ date keys, week ranges
  parse/                preprocess, recurrence, tags, parseEventInput (pure, Jest-tested)
  events/               LocalEvent types, sorting, stored-data migration, edit sentence
```

- In §2.5, replace the first two bullets with `- Parsing is pure and unit tested (\`lib/parse\`); UI and AsyncStorage access are still in \`index.tsx\` until FEAT-002 phase D.`

In `docs/registry/CHG-004-extract-parsers.md`, set `Status` to `Done`, tick all three checkboxes, and set `Updated` to today's date. In `docs/registry/INDEX.md`, set the CHG-004 row's status to `Done`.

- [ ] **Step 11: Commit**

```bash
git add "app/(tabs)/index.tsx" docs
git commit -m "CHG-004: Use lib/ parsers in the planner screen and make it type-check"
```
