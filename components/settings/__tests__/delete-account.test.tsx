import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Alert } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { memoryStorage } from '@/test-utils/memoryStorage';

import DeleteAccountScreen from '../../../app/settings/delete-account';

function renderScreen() {
  const fake = fakeAuthClient(fakeSession());
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
            <Slot />
          </EventsProvider>
        </AuthProvider>
      ),
      'settings/delete-account': DeleteAccountScreen,
    },
    { initialUrl: '/settings/delete-account' },
  );
  return fake;
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

describe('Delete account', () => {
  it('explains what happens', async () => {
    renderScreen();
    expect(await screen.findByText(/Your personal events and your photo are deleted/)).toBeTruthy();
    expect(screen.getByText(/Events you shared stay with your family/)).toBeTruthy();
  });

  it('disables the button while the status is loading', async () => {
    renderScreen();
    // Engine has not fired onChange yet — status is still 'loading'
    const button = await screen.findByRole('button', { name: 'Delete my account' });
    expect(button).toBeDisabled();
  });

  it('asks to confirm before deleting', async () => {
    renderScreen();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    await act(async () => {
      FakeEngine.instances[0].options.onChange({}, { state: 'idle', pending: 0, lastSyncedAt: null });
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    expect(alert).toHaveBeenCalledWith('Delete your account?', expect.any(String), expect.any(Array));
  });

  it('warns about unsynced changes', async () => {
    renderScreen();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    await act(async () => {
      FakeEngine.instances[0].options.onChange({}, { state: 'idle', pending: 2, lastSyncedAt: null });
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    expect(alert.mock.calls[0][1]).toMatch(/2 changes haven't synced/);
  });
});
