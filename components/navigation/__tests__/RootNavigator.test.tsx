import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import AuthLayout from '../../../app/(auth)/_layout';
import { RootNavigator } from '../RootNavigator';

const stub = (label: string) => {
  function Stub() {
    return <Text>{label}</Text>;
  }
  return Stub;
};

function renderApp(fake: ReturnType<typeof fakeAuthClient>, initialUrl = '/') {
  return renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <RootNavigator />
        </AuthProvider>
      ),
      '(tabs)/_layout': () => <Slot />,
      '(tabs)/index': stub('Planner'),
      '(auth)/_layout': AuthLayout,
      '(auth)/sign-in': stub('Sign-in screen'),
      '(auth)/sign-up': stub('Sign-up screen'),
      '(auth)/forgot-password': stub('Forgot screen'),
      'auth-callback': stub('Callback screen'),
      'reset-password': stub('Reset screen'),
      'family/create': stub('Create family screen'),
      'family/join': stub('Join family screen'),
      'settings/index': stub('Settings screen'),
      'settings/password': stub('Password screen'),
      'settings/delete-account': stub('Delete account screen'),
      'event/[id]/edit': stub('Edit screen'),
    },
    { initialUrl },
  );
}

describe('RootNavigator', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  afterEach(async () => {
    await AsyncStorage.clear();
  });

  it('shows sign-in when signed out', async () => {
    renderApp(fakeAuthClient(null));
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Planner')).toBeNull();
  });

  it('shows the planner when signed in', async () => {
    renderApp(fakeAuthClient(fakeSession()));
    expect(await screen.findByText('Planner')).toBeTruthy();
  });

  it('keeps signed-out people out of Settings', async () => {
    renderApp(fakeAuthClient(null), '/settings');
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Settings screen')).toBeNull();
  });

  it('keeps signed-out people out of the planner even by URL', async () => {
    renderApp(fakeAuthClient(null), '/family/create');
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
  });

  it('goes to sign-in when the session ends', async () => {
    const fake = fakeAuthClient(fakeSession());
    renderApp(fake);
    await screen.findByText('Planner');
    act(() => fake.emit('SIGNED_OUT', null));
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Planner')).toBeNull();
  });

  it('keeps signed-out people out of editing an event', async () => {
    renderApp(fakeAuthClient(null), '/event/aaaaaaaa-0000-4000-8000-000000000001/edit');
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Edit screen')).toBeNull();
  });

  it('lets signed-in people edit an event', async () => {
    renderApp(fakeAuthClient(fakeSession()), '/event/aaaaaaaa-0000-4000-8000-000000000001/edit');
    expect(await screen.findByText('Edit screen')).toBeTruthy();
  });

  it('lets email links open whether or not you are signed in', async () => {
    renderApp(fakeAuthClient(null), '/reset-password');
    expect(await screen.findByText('Reset screen')).toBeTruthy();
  });

  it('shows the callback screen when signed in and following an auth link', async () => {
    renderApp(fakeAuthClient(fakeSession()), '/auth-callback');
    expect(await screen.findByText('Callback screen')).toBeTruthy();
  });

  it('redirects to the planner when signed in and navigating to sign-in', async () => {
    renderApp(fakeAuthClient(fakeSession()), '/sign-in');
    expect(await screen.findByText('Planner')).toBeTruthy();
  });

  it('redirects signed-out users to sign-in when opening /family/create', async () => {
    renderApp(fakeAuthClient(null), '/family/create');
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Create family screen')).toBeNull();
  });

  it('shows the planner offline for the last user on the phone', async () => {
    await AsyncStorage.setItem('planme:lastUser', JSON.stringify({ id: 'user-1', email: 'alice@test.nz' }));
    const fake = fakeAuthClient(null);
    fake.auth.getSession.mockReturnValueOnce(new Promise<never>(() => {}));
    renderApp(fake);
    expect(await screen.findByText('Planner')).toBeTruthy();
  });
});
