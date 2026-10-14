import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthApiError } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import type { EventRecord } from '@/lib/events/rows';
import type { EventChanges, SyncEngineLike, SyncEngineOptions } from '@/lib/events/syncEngine';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { SignOutButton } from '../SignOutButton';

class FakeEngine implements SyncEngineLike {
  static last: FakeEngine | null = null;
  pending = 0;
  cleared = false;
  constructor(public options: SyncEngineOptions) {
    FakeEngine.last = this;
  }
  async start() {
    this.options.onChange({}, { state: 'idle', pending: this.pending, lastSyncedAt: null });
  }
  stop() {}
  async sync() {}
  setCanSync() {}
  createResult = true;
  async create(_records: EventRecord[]) {
    return this.createResult;
  }
  async update(_record: EventRecord) {}
  async remove(_ids: string[]) {}
  async clearLocalData() {
    this.cleared = true;
  }
  async apply(_changes: EventChanges): Promise<boolean> { return false; }
}

function renderButton(fake = fakeAuthClient(fakeSession()), pending = 0) {
  const createEngine = (options: SyncEngineOptions) => {
    const engine = new FakeEngine(options);
    engine.pending = pending;
    return engine;
  };
  render(
    <AuthProvider client={fake.client}>
      <EventsProvider storage={memoryStorage()} createEngine={createEngine}>
        <SignOutButton />
      </EventsProvider>
    </AuthProvider>,
  );
  return fake;
}

beforeEach(async () => {
  FakeEngine.last = null;
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('SignOutButton', () => {
  it('signs out this phone and deletes its copy of your events', async () => {
    const fake = renderButton();
    await waitFor(() => expect(FakeEngine.last).not.toBeNull());
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    await waitFor(() => expect(FakeEngine.last?.cleared).toBe(true));
  });

  it('warns before deleting changes that have not synced', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const fake = renderButton(fakeAuthClient(fakeSession()), 2);
    await waitFor(() => expect(FakeEngine.last).not.toBeNull());
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(alert).toHaveBeenCalledWith(
      'Sign out?',
      "2 changes haven't synced yet. Signing out deletes them from this phone.",
      expect.any(Array),
    );
    expect(fake.auth.signOut).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    buttons.find(b => b.text === 'Sign out')?.onPress?.();
    await waitFor(() => expect(fake.auth.signOut).toHaveBeenCalled());
  });

  it('is disabled while status is loading', async () => {
    const fake = fakeAuthClient(fakeSession());
    const createEngine = (options: SyncEngineOptions) => {
      const engine = new FakeEngine(options);
      // Never call onChange — leaves status at initial 'loading'
      engine.start = async () => {};
      return engine;
    };
    render(
      <AuthProvider client={fake.client}>
        <EventsProvider storage={memoryStorage()} createEngine={createEngine}>
          <SignOutButton />
        </EventsProvider>
      </AuthProvider>,
    );
    const button = await screen.findByRole('button', { name: 'Sign out' });
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('explains a failed sign-out', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const fake = fakeAuthClient(fakeSession());
    fake.auth.signOut.mockResolvedValueOnce({ error: new AuthApiError('x', 500, 'unexpected_failure') });
    renderButton(fake);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign out' }).props.accessibilityState?.disabled).not.toBe(true),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Couldn't sign out", expect.any(String)));
  });
});
