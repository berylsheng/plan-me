import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { FamilyContext } from '@/context/FamilyProvider';
import { MorningSummaryProvider } from '@/context/MorningSummaryProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { fakeFamilyValue } from '@/test-utils/fakeFamily';
import { fakeNotifier } from '@/test-utils/fakeNotifier';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { SettingsScreen } from '../SettingsScreen';

jest.mock('@/lib/profile/pickAvatar', () => ({ pickAvatar: jest.fn() }));

function renderSettings() {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fakeAuthClient(fakeSession('alice@test.nz')).client}>
          <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
            <FamilyContext.Provider value={fakeFamilyValue()}>
              <MorningSummaryProvider notifier={fakeNotifier().notifier} storage={memoryStorage()}>
                <Slot />
              </MorningSummaryProvider>
            </FamilyContext.Provider>
          </EventsProvider>
        </AuthProvider>
      ),
      settings: SettingsScreen,
      'settings/password': () => <Text>Password screen</Text>,
      'settings/delete-account': () => <Text>Delete screen</Text>,
    },
    { initialUrl: '/settings' },
  );
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('Settings', () => {
  it('shows your email, profile and account actions', async () => {
    renderSettings();
    expect(await screen.findByText('alice@test.nz')).toBeTruthy();
    expect(screen.getByLabelText('Your tag')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(await screen.findByText('Morning summary')).toBeTruthy();
  });

  it('opens Change password', async () => {
    renderSettings();
    fireEvent.press(await screen.findByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password screen')).toBeTruthy();
  });

  it('opens Delete account', async () => {
    renderSettings();
    fireEvent.press(await screen.findByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText('Delete screen')).toBeTruthy();
  });
});
