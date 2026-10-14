# FEAT-005 Morning Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each morning at a chosen time (default 7:00 am), the iPhone shows a local notification summarising that day's events.

**Architecture:** Pure functions build each day's text and the list of the next 14 days' summaries; a thin `Notifier` wraps `expo-notifications`; `MorningSummaryProvider` keeps the per-user setting, watches events and the app coming to the foreground, and (debounced) cancels and re-schedules the app's own summaries. A Settings section turns it on/off and picks the time.

**Tech Stack:** Expo SDK 54, expo-notifications ~0.32.17, expo-router 6, React 19.1 / RN 0.81, TypeScript strict, Jest (jest-expo, TZ Pacific/Auckland) + RNTL 12.9.

**Spec:** `docs/superpowers/specs/2026-10-14-morning-summary-design.md`

## Global Constraints

- iOS only. Read https://docs.expo.dev/versions/v54.0.0/sdk/notifications/ before writing notification code; install with `npx expo install expo-notifications` (→ ~0.32.17).
- Copy (verbatim): section heading `Morning summary`; switch label `Morning summary`; row text `Show today's events each morning`; time label `Time`; title `Today: N events` / `Today: 1 event`; separator ` · `; overflow `+N more`; denied message `Notifications are off for Plan-Me. Turn them on in iOS Settings.`; link `Open Settings`.
- Default setting `{ enabled: false, time: '07:00' }`, stored per user on the phone under `planMe.morningSummary.<userId>`. 14 days scheduled ahead; at most 6 events listed. Notifications carry `data.kind = 'morning-summary'`; only those are ever cancelled.
- Dates are NZ date keys (`yyyy-mm-dd`); fire times are local times on those dates (the app treats the phone clock as NZ time, as elsewhere).
- No server changes. Never connect to hosted Supabase; no push. NZ English.
- Test names with an apostrophe use double quotes; `jest.mock` factories only use `mock`-prefixed variables or `require` inside.
- Every task ends with `npm test`, `npm run typecheck`, `npm run lint` passing, test output free of new warnings.
- Commit messages start `FEAT-005: `, plain-English sentences, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A burst of changes** (a family member's sync bringing many events) → exactly one cancel-and-reschedule, not one per change. Pinned in Task 3.
2. **Signing out or switching accounts** → the previous account's summaries are cancelled and never shown for the next person. Pinned in Task 3.
3. **Permission refused, or turned off later in iOS Settings** → nothing scheduled, switch back to off on refusal, the iOS-Settings message shown. Pinned in Tasks 3 and 4.
4. **Today's time already passed / a day with no events** → no notification for that day; the next days still scheduled. Pinned in Task 1.
5. **Other notifications** (none today, but any future ones) → never cancelled by the summary code. Pinned in Task 2.

---

### Task 1: Build the summary text and the 14-day plan

**Files:**
- Create: `lib/notifications/summary.ts`, `lib/notifications/schedule.ts`
- Test: `lib/notifications/__tests__/summary.test.ts`, `lib/notifications/__tests__/schedule.test.ts`

**Interfaces:**
- Consumes: `formatClock`, `toNZDateKey` (`lib/dates.ts`); `addDays` (`lib/events/repeat.ts`); `EventRecord` (`lib/events/rows.ts`).
- Produces:
  - `type Summary = { title: string; body: string }`; `MAX_LISTED = 6`
  - `summaryFor(dateKey: string, records: readonly EventRecord[]): Summary | null`
  - `type PlannedSummary = Summary & { dateKey: string; fireAt: Date }`; `SUMMARY_DAYS = 14`
  - `plannedSummaries(records: Record<string, EventRecord>, opts: { time: string; now: Date; days?: number }): PlannedSummary[]`

- [ ] **Step 1: Write the failing tests**

`lib/notifications/__tests__/summary.test.ts`:

```ts
import type { EventRecord } from '@/lib/events/rows';

import { summaryFor } from '../summary';

let n = 0;
const event = (overrides: Partial<EventRecord>): EventRecord => ({
  id: `e${++n}`, dateKey: '2026-10-15', name: 'Busy', startTime: '', endTime: '',
  ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null, ...overrides,
});

describe('summaryFor', () => {
  it('lists the day in time order, with untimed events last', () => {
    const records = [
      event({ name: 'Dinner' }),
      event({ name: 'Lunch with Bob', startTime: '12:30' }),
      event({ name: 'Swim', startTime: '07:00', endTime: '08:00' }),
      event({ name: 'Other day', dateKey: '2026-10-16', startTime: '09:00' }),
    ];
    expect(summaryFor('2026-10-15', records)).toEqual({
      title: 'Today: 3 events',
      body: '7:00 am Swim · 12:30 pm Lunch with Bob · Dinner',
    });
  });

  it('says 1 event for one', () => {
    expect(summaryFor('2026-10-15', [event({ name: 'Dentist', startTime: '09:15' })])).toEqual({
      title: 'Today: 1 event',
      body: '9:15 am Dentist',
    });
  });

  it('lists at most 6 and counts the rest', () => {
    const records = Array.from({ length: 8 }, (_, i) => event({ name: `Thing ${i + 1}`, startTime: `0${i + 1}:00` }));
    const summary = summaryFor('2026-10-15', records);
    expect(summary?.title).toBe('Today: 8 events');
    expect(summary?.body.split(' · ')).toHaveLength(7);
    expect(summary?.body.endsWith(' · +2 more')).toBe(true);
  });

  it('gives nothing for an empty day', () => {
    expect(summaryFor('2026-10-15', [event({ dateKey: '2026-10-16' })])).toBeNull();
  });
});
```

`lib/notifications/__tests__/schedule.test.ts`:

```ts
import type { EventRecord } from '@/lib/events/rows';

import { plannedSummaries } from '../schedule';

const event = (id: string, dateKey: string, name: string, startTime = ''): EventRecord => ({
  id, dateKey, name, startTime, endTime: '', ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null,
});
const records = Object.fromEntries(
  [
    event('a', '2026-10-14', 'Swim', '07:30'),
    event('b', '2026-10-15', 'Gym', '06:00'),
    event('c', '2026-10-27', 'Last day in range'),
    event('d', '2026-10-28', 'Out of range'),
  ].map(r => [r.id, r]),
);

describe('plannedSummaries', () => {
  it('plans the days with events over the next 14 days, at the chosen time', () => {
    const planned = plannedSummaries(records, { time: '07:00', now: new Date(2026, 9, 14, 6, 0) });
    expect(planned.map(p => p.dateKey)).toEqual(['2026-10-14', '2026-10-15', '2026-10-27']);
    const first = planned[0].fireAt;
    expect([first.getFullYear(), first.getMonth(), first.getDate(), first.getHours(), first.getMinutes()]).toEqual([2026, 9, 14, 7, 0]);
    expect(planned[1]).toMatchObject({ title: 'Today: 1 event', body: '6:00 am Gym' });
  });

  it("skips today once today's time has passed", () => {
    const planned = plannedSummaries(records, { time: '07:00', now: new Date(2026, 9, 14, 7, 0) });
    expect(planned.map(p => p.dateKey)).toEqual(['2026-10-15', '2026-10-27']);
  });

  it('uses the chosen time', () => {
    const [first] = plannedSummaries(records, { time: '06:45', now: new Date(2026, 9, 14, 5, 0) });
    expect([first.fireAt.getHours(), first.fireAt.getMinutes()]).toEqual([6, 45]);
  });

  it('plans nothing without events', () => {
    expect(plannedSummaries({}, { time: '07:00', now: new Date(2026, 9, 14, 6, 0) })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/notifications`
Expected: FAIL — `Cannot find module '../summary'` / `'../schedule'`.

- [ ] **Step 3: Implement**

`lib/notifications/summary.ts`:

```ts
import { formatClock } from '@/lib/dates';
import type { EventRecord } from '@/lib/events/rows';

export type Summary = { title: string; body: string };

/** The notification lists this many events, then "+N more". */
export const MAX_LISTED = 6;

const byTime = (a: EventRecord, b: EventRecord): number => {
  // Timed events first, in time order; untimed ones after, by name.
  if (!a.startTime !== !b.startTime) return a.startTime ? -1 : 1;
  return a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name);
};

/** The morning notification for one NZ date, or null when nothing is planned. */
export function summaryFor(dateKey: string, records: readonly EventRecord[]): Summary | null {
  const day = records.filter(r => r.dateKey === dateKey).sort(byTime);
  if (day.length === 0) return null;
  const parts = day.slice(0, MAX_LISTED).map(r => (r.startTime ? `${formatClock(r.startTime)} ${r.name}` : r.name));
  if (day.length > MAX_LISTED) parts.push(`+${day.length - MAX_LISTED} more`);
  return { title: `Today: ${day.length} ${day.length === 1 ? 'event' : 'events'}`, body: parts.join(' · ') };
}
```

`lib/notifications/schedule.ts`:

```ts
import { toNZDateKey } from '@/lib/dates';
import { addDays } from '@/lib/events/repeat';
import type { EventRecord } from '@/lib/events/rows';

import { type Summary, summaryFor } from './summary';

export type PlannedSummary = Summary & { dateKey: string; fireAt: Date };

/** Notifications are written when scheduled, so the app schedules this many days ahead. */
export const SUMMARY_DAYS = 14;

/** One summary per day with events, from today, at `time` ('HH:mm') local time; past times are skipped. */
export function plannedSummaries(
  records: Record<string, EventRecord>,
  { time, now, days = SUMMARY_DAYS }: { time: string; now: Date; days?: number },
): PlannedSummary[] {
  const all = Object.values(records);
  const [hour, minute] = time.split(':').map(Number);
  const today = toNZDateKey(now);
  const planned: PlannedSummary[] = [];
  for (let i = 0; i < days; i++) {
    const dateKey = addDays(today, i);
    const [y, m, d] = dateKey.split('-').map(Number);
    const fireAt = new Date(y, m - 1, d, hour, minute, 0, 0);
    if (fireAt <= now) continue;
    const summary = summaryFor(dateKey, all);
    if (summary) planned.push({ dateKey, fireAt, ...summary });
  }
  return planned;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest lib/notifications` → PASS. Then `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications
git commit -m "FEAT-005: Write each morning's summary and plan the next 14 days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The setting and the notifier

**Files:**
- Modify: `package.json`, `package-lock.json`, `app.json` (via `npx expo install expo-notifications`; make sure `"expo-notifications"` is in `expo.plugins`)
- Create: `lib/notifications/settings.ts`, `lib/notifications/notifier.ts`, `test-utils/fakeNotifier.ts`
- Test: `lib/notifications/__tests__/settings.test.ts`, `lib/notifications/__tests__/notifier.test.ts`

**Interfaces:**
- Consumes: `KeyValueStorage` (`lib/events/store.ts`); `PlannedSummary` (Task 1).
- Produces:
  - `type SummarySettings = { enabled: boolean; time: string }`; `DEFAULT_SUMMARY_SETTINGS = { enabled: false, time: '07:00' }`
  - `loadSummarySettings(storage: KeyValueStorage, userId: string): Promise<SummarySettings>` (default on a missing or damaged value)
  - `saveSummarySettings(storage: KeyValueStorage, userId: string, settings: SummarySettings): Promise<void>`
  - `type Permission = 'granted' | 'denied' | 'undetermined'`
  - `interface Notifier { showWhileOpen(): void; permission(): Promise<Permission>; requestPermission(): Promise<Permission>; cancelSummaries(): Promise<void>; scheduleSummaries(planned: PlannedSummary[]): Promise<void> }`
  - `expoNotifier: Notifier`; `SUMMARY_KIND = 'morning-summary'`
  - `fakeNotifier(permission?: Permission)` → `{ notifier: Notifier; calls: { handler: number; requested: number; cancelled: number; scheduled: PlannedSummary[][] }; setPermission(p: Permission): void; setRequestResult(p: Permission): void }`

- [ ] **Step 1: Install**

Read the v54 notifications doc first. Run `npx expo install expo-notifications` (expect `~0.32.17`). If it doesn't add `"expo-notifications"` to `app.json` `expo.plugins`, add the bare string there.

- [ ] **Step 2: Write the failing tests**

`lib/notifications/__tests__/settings.test.ts`:

```ts
import { memoryStorage } from '@/test-utils/memoryStorage';

import { DEFAULT_SUMMARY_SETTINGS, loadSummarySettings, saveSummarySettings } from '../settings';

describe('summary settings', () => {
  it('starts off at 7:00 am', async () => {
    expect(await loadSummarySettings(memoryStorage(), 'user-1')).toEqual({ enabled: false, time: '07:00' });
    expect(DEFAULT_SUMMARY_SETTINGS).toEqual({ enabled: false, time: '07:00' });
  });

  it('keeps each account its own setting', async () => {
    const storage = memoryStorage();
    await saveSummarySettings(storage, 'user-1', { enabled: true, time: '06:30' });
    expect(await loadSummarySettings(storage, 'user-1')).toEqual({ enabled: true, time: '06:30' });
    expect(await loadSummarySettings(storage, 'user-2')).toEqual({ enabled: false, time: '07:00' });
    expect(storage.dump()['planMe.morningSummary.user-1']).toBeDefined();
  });

  it('falls back to the default when the stored value is damaged', async () => {
    const storage = memoryStorage({ 'planMe.morningSummary.user-1': '{"enabled":"yes","time":"25:00"}' });
    expect(await loadSummarySettings(storage, 'user-1')).toEqual({ enabled: false, time: '07:00' });
  });
});
```

`lib/notifications/__tests__/notifier.test.ts`:

```ts
import * as Notifications from 'expo-notifications';

import { expoNotifier, SUMMARY_KIND } from '../notifier';

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

describe('expoNotifier', () => {
  it('reads permission as granted, denied or not asked yet', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    expect(await expoNotifier.permission()).toBe('granted');
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    expect(await expoNotifier.permission()).toBe('denied');
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    expect(await expoNotifier.permission()).toBe('undetermined');
  });

  it('cancels only morning summaries', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      { identifier: 'a', content: { data: { kind: SUMMARY_KIND } } },
      { identifier: 'b', content: { data: { kind: 'something-else' } } },
      { identifier: 'c', content: { data: null } },
    ] as never);
    await expoNotifier.cancelSummaries();
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a');
  });

  it('schedules each summary at its date, marked as a summary', async () => {
    const fireAt = new Date(2026, 9, 15, 7, 0);
    await expoNotifier.scheduleSummaries([{ dateKey: '2026-10-15', fireAt, title: 'Today: 1 event', body: '7:30 am Swim' }]);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Today: 1 event', body: '7:30 am Swim', data: { kind: SUMMARY_KIND, dateKey: '2026-10-15' } },
      trigger: { type: 'date', date: fireAt },
    });
  });

  it('shows summaries as a banner while the app is open', () => {
    expoNotifier.showWhileOpen();
    expect(mocked.setNotificationHandler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx jest lib/notifications/__tests__/settings.test.ts lib/notifications/__tests__/notifier.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`lib/notifications/settings.ts`:

```ts
import type { KeyValueStorage } from '@/lib/events/store';

export type SummarySettings = { enabled: boolean; time: string /* 'HH:mm' */ };

export const DEFAULT_SUMMARY_SETTINGS: SummarySettings = { enabled: false, time: '07:00' };

const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const key = (userId: string) => `planMe.morningSummary.${userId}`;

/** This account's morning summary setting on this phone; the default when there is none or it's damaged. */
export async function loadSummarySettings(storage: KeyValueStorage, userId: string): Promise<SummarySettings> {
  try {
    const raw = await storage.getItem(key(userId));
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (typeof value === 'object' && value !== null) {
      const { enabled, time } = value as Record<string, unknown>;
      if (typeof enabled === 'boolean' && typeof time === 'string' && HH_MM.test(time)) return { enabled, time };
    }
  } catch {
    // Unreadable: use the default.
  }
  return { ...DEFAULT_SUMMARY_SETTINGS };
}

export async function saveSummarySettings(storage: KeyValueStorage, userId: string, settings: SummarySettings): Promise<void> {
  await storage.setItem(key(userId), JSON.stringify(settings));
}
```

`lib/notifications/notifier.ts`:

```ts
import * as Notifications from 'expo-notifications';

import type { PlannedSummary } from './schedule';

export type Permission = 'granted' | 'denied' | 'undetermined';

/** Everything the app does with notifications, so tests can swap in a fake. */
export interface Notifier {
  showWhileOpen(): void;
  permission(): Promise<Permission>;
  requestPermission(): Promise<Permission>;
  cancelSummaries(): Promise<void>;
  scheduleSummaries(planned: PlannedSummary[]): Promise<void>;
}

/** Marks the app's morning summaries, so only they are ever cancelled. */
export const SUMMARY_KIND = 'morning-summary';

const toPermission = (status: Notifications.NotificationPermissionsStatus): Permission =>
  status.granted ? 'granted' : status.canAskAgain ? 'undetermined' : 'denied';

export const expoNotifier: Notifier = {
  showWhileOpen() {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
  },
  async permission() {
    return toPermission(await Notifications.getPermissionsAsync());
  },
  async requestPermission() {
    return toPermission(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
  },
  async cancelSummaries() {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter(n => (n.content.data as { kind?: unknown } | null)?.kind === SUMMARY_KIND);
    await Promise.all(ours.map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  },
  async scheduleSummaries(planned) {
    for (const p of planned) {
      await Notifications.scheduleNotificationAsync({
        content: { title: p.title, body: p.body, data: { kind: SUMMARY_KIND, dateKey: p.dateKey } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.fireAt },
      });
    }
  },
};
```

If the installed version's types differ (field names, enum), follow the installed `.d.ts` and the v54 doc and note it in the report.

`test-utils/fakeNotifier.ts`:

```ts
import type { Notifier, Permission } from '@/lib/notifications/notifier';
import type { PlannedSummary } from '@/lib/notifications/schedule';

/** A notifier that records calls. `setRequestResult` decides what asking for permission returns. */
export function fakeNotifier(permission: Permission = 'granted') {
  let current = permission;
  let requestResult: Permission = permission === 'undetermined' ? 'granted' : permission;
  const calls = { handler: 0, requested: 0, cancelled: 0, scheduled: [] as PlannedSummary[][] };
  const notifier: Notifier = {
    showWhileOpen: () => {
      calls.handler++;
    },
    permission: async () => current,
    requestPermission: async () => {
      calls.requested++;
      current = requestResult;
      return requestResult;
    },
    cancelSummaries: async () => {
      calls.cancelled++;
    },
    scheduleSummaries: async planned => {
      calls.scheduled.push(planned);
    },
  };
  return {
    notifier,
    calls,
    setPermission: (p: Permission) => {
      current = p;
    },
    setRequestResult: (p: Permission) => {
      requestResult = p;
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest lib/notifications` → PASS. Then `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app.json lib/notifications test-utils/fakeNotifier.ts
git commit -m "FEAT-005: Keep the morning summary setting and schedule notifications

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Keep the summaries up to date

**Files:**
- Create: `context/MorningSummaryProvider.tsx`
- Test: `context/__tests__/MorningSummaryProvider.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (`user`), `useEvents` (`records`); Task 1 `plannedSummaries`; Task 2 `Notifier`, `expoNotifier`, `loadSummarySettings`, `saveSummarySettings`, `SummarySettings`, `fakeNotifier`.
- Produces:
  - `MorningSummaryProvider({ children, notifier = expoNotifier, storage = AsyncStorage, delayMs = 2000 })`
  - `useMorningSummary(): { settings: SummarySettings | null; permissionDenied: boolean; setEnabled(on: boolean): Promise<void>; setTime(time: string): Promise<void> }` (throws outside the provider; `settings` is null while loading or signed out)

Behaviour:
- On mount: `notifier.showWhileOpen()` once.
- When the user id changes: forget the old settings; signed out → `cancelSummaries()`; signed in → load that user's settings.
- Reschedule — after `delayMs` of quiet following any change to the user, the settings, `records`, or the app becoming `active` (AppState) — runs one at a time (chain them on a ref promise): `cancelSummaries()`; then, only if enabled and `permission() === 'granted'`, `scheduleSummaries(plannedSummaries(records, { time, now: new Date() }))`. If enabled but permission isn't granted, set `permissionDenied` true (and false when it is granted). Errors are caught and ignored (no logging of codes).
- `setEnabled(true)`: `requestPermission()`; if not granted → `permissionDenied = true`, setting stays off; else save `{ ...settings, enabled: true }`, `permissionDenied = false`. `setEnabled(false)`: save enabled false, `permissionDenied = false`.
- `setTime(time)`: save `{ ...settings, time }`.
- Reads of `records` inside the timer use a ref, so the timer always schedules the latest events.

- [ ] **Step 1: Write the failing tests**

`context/__tests__/MorningSummaryProvider.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { MorningSummaryProvider, useMorningSummary } from '@/context/MorningSummaryProvider';
import { toNZDateKey } from '@/lib/dates';
import { addDays } from '@/lib/events/repeat';
import type { EventRecord } from '@/lib/events/rows';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { fakeNotifier } from '@/test-utils/fakeNotifier';
import { memoryStorage } from '@/test-utils/memoryStorage';

const idle = { state: 'idle' as const, pending: 0, lastSyncedAt: null };
const tomorrow = addDays(toNZDateKey(new Date()), 1);
const record = (id: string, name: string): EventRecord => ({
  id, dateKey: tomorrow, name, startTime: '09:00', endTime: '', ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null,
});
const engine = () => FakeEngine.instances[0];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function setup({ enabled = true, permission = 'granted' as const } = {}) {
  const storage = memoryStorage({ 'planMe.morningSummary.user-1': JSON.stringify({ enabled, time: '07:00' }) });
  const fake = fakeNotifier(permission);
  const auth = fakeAuthClient(fakeSession());
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider client={auth.client}>
      <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
        <MorningSummaryProvider notifier={fake.notifier} storage={storage} delayMs={30}>
          {children}
        </MorningSummaryProvider>
      </EventsProvider>
    </AuthProvider>
  );
  return { fake, storage, auth, ...renderHook(() => useMorningSummary(), { wrapper }) };
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('MorningSummaryProvider', () => {
  it('schedules the days ahead once the setting is loaded', async () => {
    const { fake, result } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ a: record('a', 'Swim') }, idle));
    await waitFor(() => expect(fake.calls.scheduled.length).toBeGreaterThan(0));
    expect(fake.calls.scheduled.at(-1)?.[0]).toMatchObject({ dateKey: tomorrow, title: 'Today: 1 event', body: '9:00 am Swim' });
    expect(result.current.settings).toEqual({ enabled: true, time: '07:00' });
    expect(fake.calls.handler).toBe(1);
  });

  it('reschedules once after a burst of changes', async () => {
    const { fake } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ a: record('a', 'Swim') }, idle));
    await waitFor(() => expect(fake.calls.scheduled.length).toBeGreaterThan(0));
    await sleep(80);
    const before = fake.calls.scheduled.length;
    act(() => {
      engine().options.onChange({ a: record('a', 'Swim'), b: record('b', 'Gym') }, idle);
      engine().options.onChange({ a: record('a', 'Swim'), b: record('b', 'Gym'), c: record('c', 'Run') }, idle);
      engine().options.onChange({ a: record('a', 'Swim'), b: record('b', 'Gym'), c: record('c', 'Run'), d: record('d', 'Yoga') }, idle);
    });
    await sleep(150);
    expect(fake.calls.scheduled.length).toBe(before + 1);
    expect(fake.calls.scheduled.at(-1)?.[0].title).toBe('Today: 4 events');
  });

  it('schedules nothing when the setting is off', async () => {
    const { fake } = setup({ enabled: false });
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ a: record('a', 'Swim') }, idle));
    await waitFor(() => expect(fake.calls.cancelled).toBeGreaterThan(0));
    await sleep(80);
    expect(fake.calls.scheduled).toHaveLength(0);
  });

  it('schedules nothing, and says so, when iOS permission was taken away', async () => {
    const { fake, result } = setup({ permission: 'denied' });
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ a: record('a', 'Swim') }, idle));
    await waitFor(() => expect(result.current.permissionDenied).toBe(true));
    expect(fake.calls.scheduled).toHaveLength(0);
  });

  it('asks for permission when turned on, and stays off when refused', async () => {
    const { fake, result } = setup({ enabled: false, permission: 'undetermined' });
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    fake.setRequestResult('denied');
    await act(async () => {
      await result.current.setEnabled(true);
    });
    expect(fake.calls.requested).toBe(1);
    expect(result.current.settings?.enabled).toBe(false);
    expect(result.current.permissionDenied).toBe(true);
  });

  it('saves a new time and turns it on when allowed', async () => {
    const { fake, result, storage } = setup({ enabled: false, permission: 'undetermined' });
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    await act(async () => {
      await result.current.setEnabled(true);
      await result.current.setTime('06:30');
    });
    expect(result.current.settings).toEqual({ enabled: true, time: '06:30' });
    expect(JSON.parse(storage.dump()['planMe.morningSummary.user-1'])).toEqual({ enabled: true, time: '06:30' });
    expect(fake.calls.requested).toBe(1);
  });

  it('cancels the summaries when you sign out', async () => {
    const { fake, auth } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    const before = fake.calls.cancelled;
    await act(async () => {
      auth.emit('SIGNED_OUT', null);
    });
    await waitFor(() => expect(fake.calls.cancelled).toBeGreaterThan(before));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest context/__tests__/MorningSummaryProvider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`context/MorningSummaryProvider.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { KeyValueStorage } from '@/lib/events/store';
import { expoNotifier, type Notifier } from '@/lib/notifications/notifier';
import { plannedSummaries } from '@/lib/notifications/schedule';
import { loadSummarySettings, saveSummarySettings, type SummarySettings } from '@/lib/notifications/settings';

import { useAuth } from './AuthProvider';
import { useEvents } from './EventsProvider';

type MorningSummaryValue = {
  /** Null while loading or signed out. */
  settings: SummarySettings | null;
  /** True when notifications are refused for the app in iOS. */
  permissionDenied: boolean;
  setEnabled: (on: boolean) => Promise<void>;
  setTime: (time: string) => Promise<void>;
};

const MorningSummaryContext = createContext<MorningSummaryValue | null>(null);

type Props = { children: React.ReactNode; notifier?: Notifier; storage?: KeyValueStorage; delayMs?: number };

/** Keeps the phone's scheduled morning summaries in step with the events and the setting. */
export function MorningSummaryProvider({ children, notifier = expoNotifier, storage = AsyncStorage, delayMs = 2000 }: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { records } = useEvents();
  const [settings, setSettings] = useState<SummarySettings | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [wakes, setWakes] = useState(0);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const queue = useRef<Promise<void>>(Promise.resolve());

  // One at a time, so a cancel never runs in the middle of another schedule.
  const run = useCallback((job: () => Promise<void>) => {
    queue.current = queue.current.then(job).catch(() => undefined);
    return queue.current;
  }, []);

  useEffect(() => {
    notifier.showWhileOpen();
  }, [notifier]);

  useEffect(() => {
    setSettings(null);
    setPermissionDenied(false);
    if (!userId) {
      void run(() => notifier.cancelSummaries());
      return;
    }
    let live = true;
    void loadSummarySettings(storage, userId).then(loaded => {
      if (live) setSettings(loaded);
    });
    return () => {
      live = false;
    };
  }, [userId, storage, notifier, run]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setWakes(n => n + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!userId || !settings) return;
    const timer = setTimeout(() => {
      void run(async () => {
        await notifier.cancelSummaries();
        if (!settings.enabled) return;
        const granted = (await notifier.permission()) === 'granted';
        setPermissionDenied(!granted);
        if (!granted) return;
        await notifier.scheduleSummaries(plannedSummaries(recordsRef.current, { time: settings.time, now: new Date() }));
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [userId, settings, records, wakes, delayMs, notifier, run]);

  const save = useCallback(
    async (next: SummarySettings) => {
      if (!userId) return;
      setSettings(next);
      await saveSummarySettings(storage, userId, next);
    },
    [storage, userId],
  );

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (!settings) return;
      if (on) {
        const granted = (await notifier.requestPermission()) === 'granted';
        setPermissionDenied(!granted);
        if (!granted) return;
      } else {
        setPermissionDenied(false);
      }
      await save({ ...settings, enabled: on });
    },
    [notifier, save, settings],
  );

  const setTime = useCallback(
    async (time: string) => {
      if (settings) await save({ ...settings, time });
    },
    [save, settings],
  );

  const value = useMemo(() => ({ settings, permissionDenied, setEnabled, setTime }), [settings, permissionDenied, setEnabled, setTime]);
  return <MorningSummaryContext.Provider value={value}>{children}</MorningSummaryContext.Provider>;
}

export function useMorningSummary(): MorningSummaryValue {
  const value = useContext(MorningSummaryContext);
  if (!value) throw new Error('useMorningSummary must be used inside <MorningSummaryProvider>');
  return value;
}
```

Note for the "saves a new time" test: `setEnabled` then `setTime` in one `act` — `setTime` must see the enabled value. If the stale `settings` closure makes the second call overwrite `enabled`, keep the latest settings in a ref (`settingsRef`) and build `next` from it in both functions. Prefer the ref from the start.

- [ ] **Step 4: Run the tests**

Run: `npx jest context/__tests__/MorningSummaryProvider.test.tsx` → PASS (no act() warnings). Then `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add context/MorningSummaryProvider.tsx context/__tests__/MorningSummaryProvider.test.tsx
git commit -m "FEAT-005: Keep the morning summaries in step with your events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Settings section, and turning it on in the app

**Files:**
- Create: `components/settings/MorningSummarySettings.tsx`
- Modify: `components/settings/SettingsScreen.tsx` (add the section after `ProfileForm`), `app/_layout.tsx` (wrap with `MorningSummaryProvider` inside `FamilyProvider`), `components/events/form/TimeField.tsx` (add `clearable?: boolean`, default `true`)
- Test: `components/settings/__tests__/MorningSummarySettings.test.tsx`; update `components/settings/__tests__/SettingsScreen.test.tsx` (wrap with `MorningSummaryProvider` using `fakeNotifier().notifier` and `memoryStorage()`)

**Interfaces:**
- Consumes: `useMorningSummary` (Task 3), `TimeField`, `fakeNotifier`, `Linking.openSettings` (react-native).
- Produces: `MorningSummarySettings()` component.

- [ ] **Step 1: Write the failing tests**

`components/settings/__tests__/MorningSummarySettings.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { MorningSummaryProvider } from '@/context/MorningSummaryProvider';
import { type Permission } from '@/lib/notifications/notifier';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { fakeNotifier } from '@/test-utils/fakeNotifier';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { MorningSummarySettings } from '../MorningSummarySettings';

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: ({ onChange }: { onChange: (e: { type: string }, d: Date) => void }) =>
    React.createElement(Text, { onPress: () => onChange({ type: 'set' }, new Date(2026, 9, 14, 6, 30)) }, 'Pick 6:30 am') };
});

function renderSettings(permission: Permission = 'undetermined', enabled = false) {
  const fake = fakeNotifier(permission);
  const storage = memoryStorage({ 'planMe.morningSummary.user-1': JSON.stringify({ enabled, time: '07:00' }) });
  render(
    <AuthProvider client={fakeAuthClient(fakeSession()).client}>
      <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
        <MorningSummaryProvider notifier={fake.notifier} storage={storage} delayMs={10}>
          <MorningSummarySettings />
        </MorningSummaryProvider>
      </EventsProvider>
    </AuthProvider>,
  );
  return { fake, storage };
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('MorningSummarySettings', () => {
  it('is off at first, without a time', async () => {
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Morning summary' });
    expect(toggle.props.value).toBe(false);
    expect(screen.getByText("Show today's events each morning")).toBeTruthy();
    expect(screen.queryByText('Time')).toBeNull();
  });

  it('asks iOS when turned on, then shows the time', async () => {
    const { fake } = renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Morning summary' });
    await act(async () => {
      fireEvent(toggle, 'valueChange', true);
    });
    expect(fake.calls.requested).toBe(1);
    expect(await screen.findByText('7:00 am')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear time' })).toBeNull();
  });

  it('stays off and explains when iOS says no', async () => {
    const { fake } = renderSettings();
    fake.setRequestResult('denied');
    const toggle = await screen.findByRole('switch', { name: 'Morning summary' });
    await act(async () => {
      fireEvent(toggle, 'valueChange', true);
    });
    expect(await screen.findByText('Notifications are off for Plan-Me. Turn them on in iOS Settings.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Morning summary' }).props.value).toBe(false);
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(open).toHaveBeenCalled();
  });

  it('saves a new time', async () => {
    const { storage } = renderSettings('granted', true);
    fireEvent.press(await screen.findByRole('button', { name: 'Time' }));
    await act(async () => {
      fireEvent.press(screen.getByText('Pick 6:30 am'));
    });
    await waitFor(() => expect(JSON.parse(storage.dump()['planMe.morningSummary.user-1'])).toEqual({ enabled: true, time: '06:30' }));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest components/settings/__tests__/MorningSummarySettings.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/events/form/TimeField.tsx`: add `clearable?: boolean` to `Props` (default `true`) and render the Clear button only when `clearable && value`.

`components/settings/MorningSummarySettings.tsx`:

```tsx
import React from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { BLUE } from '@/components/auth/styles';
import { TimeField } from '@/components/events/form/TimeField';
import { useMorningSummary } from '@/context/MorningSummaryProvider';

/** Settings section: turn the morning summary on or off and choose its time. */
export function MorningSummarySettings() {
  const { settings, permissionDenied, setEnabled, setTime } = useMorningSummary();
  if (!settings) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Morning summary</Text>
      <View style={styles.row}>
        <Text style={styles.text}>Show today&apos;s events each morning</Text>
        <Switch accessibilityLabel="Morning summary" value={settings.enabled} onValueChange={on => void setEnabled(on)} />
      </View>
      {settings.enabled ? (
        <TimeField label="Time" value={settings.time} clearable={false} onChange={time => (time ? void setTime(time) : undefined)} />
      ) : null}
      {permissionDenied ? (
        <View>
          <Text style={styles.note}>Notifications are off for Plan-Me. Turn them on in iOS Settings.</Text>
          <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} hitSlop={8}>
            <Text style={styles.link}>Open Settings</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
  text: { flex: 1, fontSize: 16, color: '#333' },
  note: { fontSize: 14, color: '#666', marginTop: 8 },
  link: { color: BLUE, fontSize: 16, fontWeight: '600', marginTop: 6 },
});
```

`components/settings/SettingsScreen.tsx`: import and render `<MorningSummarySettings />` right after `{me ? <ProfileForm me={me} /> : null}`.

`app/_layout.tsx`: import `MorningSummaryProvider` and wrap `<ThemeProvider>…</ThemeProvider>` with `<MorningSummaryProvider>` inside `<FamilyProvider>`.

`components/settings/__tests__/SettingsScreen.test.tsx`: in its `_layout`, wrap `<Slot />` with `<MorningSummaryProvider notifier={fakeNotifier().notifier} storage={memoryStorage()}>`; add one assertion that `Morning summary` is shown.

Any other test that renders `app/_layout.tsx` or `SettingsScreen` needs the same wrapper (`grep -rln "SettingsScreen\|RootLayout" --include=*.test.tsx .`). If `expo-notifications` fails to load under Jest wherever `expoNotifier` is imported without being used, add a `jest.mock('expo-notifications', …)` with no-op functions to `jest.setup.js` and say so in the report.

- [ ] **Step 4: Run the tests**

Run: `npx jest components/settings components/events` → PASS. Then `npm test`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add components/settings components/events/form/TimeField.tsx app/_layout.tsx jest.setup.js
git commit -m "FEAT-005: Turn the morning summary on and choose its time in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs and registry

**Files:**
- Create: `docs/registry/FEAT-005-morning-summary.md`
- Modify: `docs/registry/INDEX.md`, `docs/specs/features.md`, `docs/specs/architecture.md`, `CHANGELOG.md`

- [ ] **Step 1: Write the docs**

- Registry item in the shape of `docs/registry/FEAT-004-event-edit-form.md`: Type Feature, Status In testing, Priority Medium, Created 14/10/2026, Updated 14/10/2026, Released in —. Summary: "Each morning at a time you choose (default 7:00 am), your iPhone shows a notification listing that day's events." Details: built on the phone (local notifications, 14 days ahead), iOS only, on/off and time in Settings, no notification on empty days, may miss shared events added while the app was closed until it is next opened. Links: spec and plan paths; Related FEAT-002, FEAT-003.
- `INDEX.md`: add the FEAT-005 row.
- `features.md`: "Last updated: 14/10/2026"; under Planned add "### Morning summary — FEAT-005 (built; device testing next)" with three bullets (what, where to turn it on, the closed-app limit).
- `architecture.md`: add `lib/notifications/` (summary, schedule, settings, notifier), `context/MorningSummaryProvider.tsx`, `components/settings/MorningSummarySettings.tsx` with "(built, FEAT-005)".
- `CHANGELOG.md` under Unreleased → Added: "FEAT-005: A morning summary notification of the day's events, set in Settings."

- [ ] **Step 2: Check and commit**

Run `npm test`, `npm run typecheck`, `npm run lint`.

```bash
git add docs CHANGELOG.md
git commit -m "FEAT-005: Document the morning summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After all tasks

- Full check: `npm test`, `npm run typecheck`, `npm run lint`.
- Phone check (iPhone, Expo Go): turn Morning summary on (allow), set the time to two minutes from now with an event today → the notification arrives with the right text; turn it off → nothing; deny permission in iOS Settings → the message appears; sign out → nothing arrives.
