import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { FamilyContext, type FamilyValue } from '@/context/FamilyProvider';
import type { EventRecord } from '@/lib/events/rows';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { FAKE_BOB, fakeFamilyValue } from '@/test-utils/fakeFamily';
import { memoryStorage } from '@/test-utils/memoryStorage';

import Planner from '../index';

// The month calendar only opens in a modal; it isn't needed here.
jest.mock('react-native-calendars', () => ({ Calendar: () => null }));

const mockPush = jest.fn();
let mockParams: { date?: string; at?: string } = {};
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    router: { ...actual.router, push: (...args: unknown[]) => mockPush(...args) },
    useLocalSearchParams: () => mockParams,
  };
});

const idle = { state: 'idle' as const, pending: 0, lastSyncedAt: null };

function renderPlanner(family: FamilyValue = fakeFamilyValue()) {
  render(
    <AuthProvider client={fakeAuthClient(fakeSession()).client}>
      <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
        <FamilyContext.Provider value={family}>
          <Planner />
        </FamilyContext.Provider>
      </EventsProvider>
    </AuthProvider>,
  );
}

const engine = () => FakeEngine.instances[0];
const type = (text: string) => fireEvent.changeText(screen.getByLabelText('New event'), text);

beforeEach(async () => {
  FakeEngine.reset();
  mockParams = {};
  mockPush.mockClear();
  await AsyncStorage.clear();
});

describe('Planner with a family', () => {
  it('adds a shared event for a tagged member', async () => {
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    fireEvent.press(screen.getByRole('radio', { name: 'Family' }));
    type('6pm dinner @BE');
    fireEvent.press(screen.getByText('Add'));
    await waitFor(() => expect(engine().created).toHaveLength(1));
    expect(engine().created[0][0]).toMatchObject({ visibility: 'shared', memberIds: [FAKE_BOB.id] });
  });

  it('adds personal events by default and keeps an unmapped @AZ', async () => {
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    type('6pm swim @AZ');
    fireEvent.press(screen.getByText('Add'));
    await waitFor(() => expect(engine().created).toHaveLength(1));
    expect(engine().created[0][0]).toMatchObject({ visibility: 'personal', memberIds: [], people: ['AZ'] });
  });

  it('shows your tag and a repeat in the placeholder', async () => {
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    expect(screen.getByPlaceholderText('e.g. 6pm swim @AL, weekly for 4 weeks')).toBeTruthy();
  });

  it('opens tips from the input row, but not in Modify mode', async () => {
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    fireEvent.press(screen.getByRole('button', { name: 'Tips' }));
    expect(screen.getByText('What you can type')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.press(screen.getByText('Modify'));
    expect(screen.getByRole('button', { name: 'Tips' })).toBeDisabled();
  });

  it('opens on the day a morning summary was for', async () => {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date()).split('-').map(Number);
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date(y, m - 1, d + 1, 12));
    mockParams = { date: tomorrow };
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    const gym: EventRecord = {
      id: 'aaaaaaaa-1111-4222-8333-444444444444', dateKey: tomorrow, name: 'Gym', startTime: '06:00', endTime: '',
      ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null,
    };
    act(() => engine().options.onChange({ [gym.id]: gym }, idle));
    expect(await screen.findByText('Gym')).toBeTruthy();
  });

  it('switches to the Today view when a summary is tapped', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    const later = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date(y, m - 1, d + 2, 12));
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    const swim: EventRecord = {
      id: 'aaaaaaaa-1111-4222-8333-555555555555', dateKey: today, name: 'Swim', startTime: '07:00', endTime: '',
      ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null,
    };
    const gym: EventRecord = { ...swim, id: 'aaaaaaaa-1111-4222-8333-666666666666', dateKey: later, name: 'Gym' };
    act(() => engine().options.onChange({ [swim.id]: swim, [gym.id]: gym }, idle));
    fireEvent.press(screen.getByText('All'));
    expect(await screen.findByText('Swim')).toBeTruthy();
    expect(screen.getByText('Gym')).toBeTruthy();

    // A tap changes the route's params, which re-renders the planner; Modify → Done re-renders it here.
    mockParams = { date: later };
    fireEvent.press(screen.getByText('Modify'));
    fireEvent.press(screen.getByText('Done'));
    await waitFor(() => expect(screen.queryByText('Swim')).toBeNull());
    expect(screen.getByText('Gym')).toBeTruthy();
  });

  it('goes back to the day when the same summary is tapped again', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    const later = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date(y, m - 1, d + 2, 12));
    mockParams = { date: later, at: '1' };
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    const gym: EventRecord = {
      id: 'aaaaaaaa-1111-4222-8333-777777777777', dateKey: later, name: 'Gym', startTime: '06:00', endTime: '',
      ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null,
    };
    act(() => engine().options.onChange({ [gym.id]: gym }, idle));
    expect(await screen.findByText('Gym')).toBeTruthy();

    // Move to today, then tap the same summary again (same date, a new tap).
    fireEvent.press(screen.getByText('Today'));
    await waitFor(() => expect(screen.queryByText('Gym')).toBeNull());
    mockParams = { date: later, at: '2' };
    fireEvent.press(screen.getByText('Modify'));
    fireEvent.press(screen.getByText('Done'));
    expect(await screen.findByText('Gym')).toBeTruthy();
  });

  it('hides the toggle without a family', async () => {
    renderPlanner(fakeFamilyValue({ family: null, members: [], memberById: new Map(), memberByTag: new Map() }));
    await waitFor(() => expect(engine()).toBeDefined());
    expect(screen.queryByRole('radio', { name: 'Family' })).toBeNull();
  });

  it("shows 'Shared · You' for your own shared event when the family has not loaded", async () => {
    renderPlanner(fakeFamilyValue({ me: null, members: [], memberById: new Map(), memberByTag: new Map() }));
    await waitFor(() => expect(engine()).toBeDefined());
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
    const myRecord: EventRecord = {
      id: 'aabbccdd-1111-2222-3333-444455556666',
      dateKey: today,
      name: 'My swim',
      startTime: '08:00',
      endTime: '',
      ownerId: 'user-1',
      visibility: 'shared',
      memberIds: [],
      updatedAt: '2026-10-12T00:00:00Z',
    };
    act(() => engine().options.onChange({ [myRecord.id]: myRecord }, idle));
    expect(await screen.findByText('Shared · You')).toBeTruthy();
  });

  it("shows who shared an event", async () => {
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
    const record: EventRecord = {
      id: '8f9a3c3e-1f0b-4c56-9f1e-2b8d3a4c5e6f',
      dateKey: today,
      name: 'Dinner',
      startTime: '18:00',
      endTime: '',
      ownerId: FAKE_BOB.id,
      visibility: 'shared',
      memberIds: ['someone-who-left'],
      updatedAt: '2026-10-12T00:00:00Z',
    };
    act(() => engine().options.onChange({ [record.id]: record }, idle));
    expect(await screen.findByText('Shared · Bob')).toBeTruthy();
  });

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
});
