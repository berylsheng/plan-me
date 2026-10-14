import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, Slot, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { FamilyContext, type FamilyValue } from '@/context/FamilyProvider';
import { addDays, type RepeatRule } from '@/lib/events/repeat';
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

async function renderEditor(id: string, family: FamilyValue = fakeFamilyValue()) {
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
}

async function openEditor(records: EventRecord[], id: string, family: FamilyValue = fakeFamilyValue()) {
  await renderEditor(id, family);
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

  it("keeps the form open when a new repeat can't be stored", async () => {
    const series = weekly();
    await openEditor(series, series[1].id);
    engine().applyResult = false;
    fireEvent.press(screen.getByRole('radio', { name: 'Fortnightly' }));
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeTruthy();
    expect(screen.queryByText('This event was deleted.')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Fortnightly' })).toBeChecked();
  });

  it('does not say the event was deleted while a new repeat is being saved', async () => {
    const series = weekly();
    await openEditor(series, series[1].id);
    let finish!: (saved: boolean) => void;
    engine().applyImpl = changes => {
      // The engine shows the replaced events as gone before the save resolves.
      const left = series.filter(r => !changes.remove.includes(r.id));
      engine().options.onChange(Object.fromEntries(left.map(r => [r.id, r])), idle);
      return new Promise(resolve => { finish = resolve; });
    };
    fireEvent.press(screen.getByRole('radio', { name: 'Fortnightly' }));
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(screen.queryByText('This event was deleted.')).toBeNull();
    await act(async () => finish(true));
    expect(await screen.findByText('Planner')).toBeTruthy();
  });

  it('says it could not save when saving goes wrong', async () => {
    await openEditor([event()], uuid(1));
    engine().applyImpl = () => Promise.reject(new Error('disk full'));
    fireEvent.changeText(screen.getByLabelText('Name'), 'Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('waits for the events to load before saying the event is gone', async () => {
    await renderEditor(uuid(1));
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByText('This event was deleted.')).toBeNull();
    act(() => engine().options.onChange({ [uuid(1)]: event() }, idle));
    expect(await screen.findByLabelText('Name')).toBeTruthy();
  });

  it('says the event is gone when it is not there once the events have loaded', async () => {
    await renderEditor(uuid(5));
    act(() => engine().options.onChange({ [uuid(1)]: event() }, idle));
    expect(await screen.findByText('This event was deleted.')).toBeTruthy();
  });

  it('asks before throwing away changes when you swipe or press back', async () => {
    renderRouter(
      {
        _layout: () => (
          <AuthProvider client={fakeAuthClient(fakeSession()).client}>
            <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
              <FamilyContext.Provider value={fakeFamilyValue()}>
                <Stack screenOptions={{ headerShown: false }} />
              </FamilyContext.Provider>
            </EventsProvider>
          </AuthProvider>
        ),
        index: () => <Text>Planner</Text>,
        'event/[id]/edit': EditEventScreen,
      },
      { initialUrl: '/' },
    );
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ [uuid(1)]: event() }, idle));
    act(() => router.push(`/event/${uuid(1)}/edit`));
    fireEvent.changeText(await screen.findByLabelText('Name'), 'Swim club');

    act(() => router.back());
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    expect(screen.getByLabelText('Name').props.value).toBe('Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());
    expect(screen.getByText('Planner')).toBeTruthy();
    expect(engine().applied).toHaveLength(0);
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
    expect(screen.getByRole('radio', { name: 'Only me' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Former member' })).toBeChecked();
    fireEvent.changeText(screen.getByLabelText('Name'), 'Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    fireEvent.press(screen.getByRole('button', { name: 'This event only' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(engine().applied[0].update[0]).toMatchObject({ ownerId: FAKE_BOB.id, visibility: 'shared', memberIds: ['someone-who-left'] });
  });

  it("lets a family member rename someone's series that runs longer than a year", async () => {
    // Made before the one-year limit, with no stored rule: weekly for 18 months.
    const old = Array.from({ length: 78 }, (_, i) =>
      event({ id: uuid(100 + i), dateKey: addDays('2026-10-13', i * 7), occurrenceId: uuid(98), ownerId: FAKE_BOB.id, visibility: 'shared' }));
    await openEditor(old, old[0].id);
    fireEvent.changeText(screen.getByLabelText('Name'), 'Swim club');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    fireEvent.press(screen.getByRole('button', { name: 'This and all future' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(screen.queryByText('End within a year of the event.')).toBeNull();
    expect(engine().applied[0].update).toHaveLength(78);
  });

  it("doesn't call the creator a former member before the family has loaded", async () => {
    const series = weekly({ ownerId: FAKE_BOB.id, visibility: 'shared' });
    await openEditor(series, series[1].id, fakeFamilyValue({ me: null, members: [], memberById: new Map(), memberByTag: new Map() }));
    expect(screen.getByText('Only the person who made this event can change how this repeats.')).toBeTruthy();
  });

  it('lets the creator make their shared event personal', async () => {
    await openEditor([event({ visibility: 'shared' })], uuid(1));
    const onlyMe = screen.getByRole('radio', { name: 'Only me' });
    expect(onlyMe).not.toBeDisabled();
    fireEvent.press(onlyMe);
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(engine().applied[0].update[0]).toMatchObject({ visibility: 'personal' });
  });

  it('lets you edit your shared event before the family has loaded', async () => {
    await openEditor([event({ visibility: 'shared' })], uuid(1), fakeFamilyValue({ me: null, members: [], memberById: new Map(), memberByTag: new Map() }));
    expect(screen.getByRole('radio', { name: 'Only me' })).not.toBeDisabled();
  });

  it('says so when the event is deleted while you edit it', async () => {
    await openEditor([event()], uuid(1));
    act(() => engine().options.onChange({}, idle));
    expect(await screen.findByText('This event was deleted.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Planner')).toBeTruthy();
    expect(engine().applied).toHaveLength(0);
  });

  it('moves only the last event of a series, without asking or touching the others', async () => {
    const series = weekly();
    await openEditor(series, series[3].id);
    fireEvent.press(screen.getByRole('button', { name: 'Date' }));
    fireEvent.press(screen.getByText('Pick 21/10/2026'));
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(engine().applied).toHaveLength(1));
    expect(screen.queryByText('Change which events?')).toBeNull();
    expect(engine().applied[0].update).toHaveLength(1);
    expect(engine().applied[0].update[0]).toMatchObject({ id: series[3].id, dateKey: '2026-10-21', occurrenceId: undefined, repeat: undefined });
    expect(engine().applied[0].remove).toEqual([]);
    expect(engine().applied[0].create).toEqual([]);
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
