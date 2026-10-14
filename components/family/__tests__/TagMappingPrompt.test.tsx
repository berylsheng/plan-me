import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { FamilyContext, type FamilyValue } from '@/context/FamilyProvider';
import type { EventRecord } from '@/lib/events/rows';
import { readTagAnswers } from '@/lib/family/tagMapping';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { FAKE_BOB, fakeFamilyValue } from '@/test-utils/fakeFamily';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { TagMappingPrompt } from '../TagMappingPrompt';

const idle = { state: 'idle' as const, pending: 0, lastSyncedAt: null };
const swim: EventRecord = {
  id: '8f9a3c3e-1f0b-4c56-9f1e-2b8d3a4c5e6f',
  dateKey: '2026-11-03',
  name: 'Swim',
  startTime: '07:00',
  endTime: '',
  people: ['AZ'],
  ownerId: 'user-1',
  visibility: 'personal',
  memberIds: [],
  updatedAt: null,
};

function renderPrompt(family: FamilyValue = fakeFamilyValue(), storage = memoryStorage()) {
  render(
    <AuthProvider client={fakeAuthClient(fakeSession()).client}>
      <EventsProvider storage={storage} createEngine={createFakeEngine}>
        <FamilyContext.Provider value={family}>
          <TagMappingPrompt storage={storage} />
        </FamilyContext.Provider>
      </EventsProvider>
    </AuthProvider>,
  );
  return storage;
}

const engine = () => FakeEngine.instances[0];

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('TagMappingPrompt', () => {
  it('asks who an old tag is and moves it to that member', async () => {
    const storage = renderPrompt();
    await waitFor(() => expect(engine()).toBeDefined());
    await act(async () => { engine().options.onChange({ [swim.id]: swim }, idle); });
    expect(await screen.findByText('Who is @AZ?')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Bob' }));
    await waitFor(() => expect(engine().updated).toHaveLength(1));
    expect(engine().updated[0]).toMatchObject({ id: swim.id, memberIds: [FAKE_BOB.id], people: undefined });
    expect(await readTagAnswers(storage, 'user-1')).toEqual({ AZ: FAKE_BOB.id });
  });

  it('keeps the tag as text when it is no one, and does not ask again', async () => {
    const storage = renderPrompt();
    await waitFor(() => expect(engine()).toBeDefined());
    await act(async () => { engine().options.onChange({ [swim.id]: swim }, idle); });
    fireEvent.press(await screen.findByRole('button', { name: 'No one, keep it as text' }));
    await waitFor(() => expect(screen.queryByText('Who is @AZ?')).toBeNull());
    expect(engine().updated).toHaveLength(0);
    expect(await readTagAnswers(storage, 'user-1')).toEqual({ AZ: null });
  });

  it("does not prompt for a tag on another member's shared event", async () => {
    const bobRecord: EventRecord = {
      ...swim,
      id: 'bob-record-id',
      ownerId: FAKE_BOB.id,
      visibility: 'shared',
    };
    // Only Bob's record is present: the prompt should not appear.
    renderPrompt();
    await waitFor(() => expect(engine()).toBeDefined());
    await act(async () => {
      engine().options.onChange({ [bobRecord.id]: bobRecord }, idle);
    });
    await act(async () => {});
    expect(screen.queryByText('Who is @AZ?')).toBeNull();
    expect(engine().updated).toHaveLength(0);
  });

  it("asks about your own tag even when a shared event from another member has the same tag", async () => {
    const bobRecord: EventRecord = {
      ...swim,
      id: 'bob-record-id',
      ownerId: FAKE_BOB.id,
      visibility: 'shared',
    };
    // Both user-1's and Bob's records are present.
    const storage = renderPrompt();
    await waitFor(() => expect(engine()).toBeDefined());
    await act(async () => {
      engine().options.onChange({ [swim.id]: swim, [bobRecord.id]: bobRecord }, idle);
    });
    expect(await screen.findByText('Who is @AZ?')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Bob' }));
    await waitFor(() => expect(engine().updated).toHaveLength(1));
    // Only user-1's event was updated; Bob's event is unchanged.
    expect(engine().updated[0].id).toBe(swim.id);
    expect(await readTagAnswers(storage, 'user-1')).toEqual({ AZ: FAKE_BOB.id });
  });

  it('waits until you are in a family', async () => {
    renderPrompt(fakeFamilyValue({ family: null }));
    await waitFor(() => expect(engine()).toBeDefined());
    await act(async () => { engine().options.onChange({ [swim.id]: swim }, idle); });
    await act(async () => {});
    expect(screen.queryByText('Who is @AZ?')).toBeNull();
  });
});
