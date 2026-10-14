import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { MorningSummaryProvider, useMorningSummary } from '@/context/MorningSummaryProvider';
import { toNZDateKey } from '@/lib/dates';
import { addDays } from '@/lib/events/repeat';
import type { EventRecord } from '@/lib/events/rows';
import type { Permission } from '@/lib/notifications/notifier';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { fakeNotifier } from '@/test-utils/fakeNotifier';
import { memoryStorage } from '@/test-utils/memoryStorage';

const idle = { state: 'idle' as const, pending: 0, lastSyncedAt: null };
const tomorrow = addDays(toNZDateKey(new Date()), 1);
const record = (id: string, name: string): EventRecord => ({
  id, dateKey: tomorrow, name, startTime: '09:00', endTime: '', ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null,
});
const mockNavigate = jest.fn();
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, router: { ...actual.router, navigate: (...args: unknown[]) => mockNavigate(...args) } };
});

const engine = () => FakeEngine.instances[0];
let appStateListeners: ((state: AppStateStatus) => void)[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function setup({ enabled = true, permission = 'granted' }: { enabled?: boolean; permission?: Permission } = {}) {
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
  mockNavigate.mockReset();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (state: AppStateStatus) => void);
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MorningSummaryProvider', () => {
  it('schedules the days ahead once the setting is loaded', async () => {
    const { fake, result } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ a: record('a', 'Swim') }, idle));
    // A run before the events arrive schedules nothing; wait for the one that has them.
    await waitFor(() => expect(fake.calls.scheduled.at(-1)?.length).toBeGreaterThan(0));
    expect(fake.calls.scheduled.at(-1)?.[0]).toMatchObject({ dateKey: tomorrow, title: 'Today: 1 event', body: '9:00 am Swim' });
    expect(result.current.settings).toEqual({ enabled: true, time: '07:00' });
    expect(fake.calls.handler).toBe(1);
  });

  it('reschedules once after a burst of changes', async () => {
    const { fake } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ a: record('a', 'Swim') }, idle));
    await waitFor(() => expect(fake.calls.scheduled.at(-1)?.length).toBeGreaterThan(0));
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

  it("doesn't cancel the summaries while sign-in is still loading", async () => {
    const { fake } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ a: record('a', 'Swim') }, idle));
    await waitFor(() => expect(fake.log).toContain('schedule:1'));
    // Only the reschedule's own cancel comes before the first schedule.
    expect(fake.log.slice(0, fake.log.indexOf('schedule:1'))).toEqual(['cancel']);
  });

  it('waits for the events to load before rescheduling', async () => {
    const { fake, result } = setup();
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    await sleep(100);
    expect(fake.log).toEqual([]);
  });

  it('reschedules when the app comes back to the foreground', async () => {
    const { fake } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ a: record('a', 'Swim') }, idle));
    await waitFor(() => expect(fake.log).toContain('schedule:1'));
    await sleep(80);
    const before = fake.calls.scheduled.length;
    act(() => appStateListeners.forEach(listener => listener('active')));
    await waitFor(() => expect(fake.calls.scheduled.length).toBe(before + 1));
  });

  it('clears the message once notifications are allowed in iOS Settings', async () => {
    const { fake, result } = setup({ enabled: false, permission: 'undetermined' });
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({}, idle));
    fake.setRequestResult('denied');
    await act(async () => {
      await result.current.setEnabled(true);
    });
    expect(result.current.permissionDenied).toBe(true);
    fake.setPermission('granted');
    act(() => appStateListeners.forEach(listener => listener('active')));
    await waitFor(() => expect(result.current.permissionDenied).toBe(false));
  });

  it('opens the planner on that day when a summary is tapped', async () => {
    const { fake } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => fake.tap(tomorrow));
    act(() => fake.tap(tomorrow));
    expect(mockNavigate).toHaveBeenCalledTimes(2);
    const [first, second] = mockNavigate.mock.calls.map(call => call[0]);
    expect(first).toMatchObject({ pathname: '/', params: { date: tomorrow } });
    // Each tap is marked, so tapping the same summary again still moves the planner.
    expect(first.params.at).not.toBe(second.params.at);
  });

  it('cancels the summaries when you sign out', async () => {
    const { fake, auth } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    const before = fake.calls.cancelled;
    await act(async () => {
      auth.emit('SIGNED_OUT', null);
    });
    await waitFor(() => expect(fake.calls.cancelled).toBeGreaterThan(before));
    await sleep(80);
    // Nothing is scheduled for the old account after the sign-out cancel.
    expect(fake.log.at(-1)).toBe('cancel');
  });
});
