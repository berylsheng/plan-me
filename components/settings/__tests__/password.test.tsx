import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import ChangePasswordScreen from '../../../app/settings/password';

function renderScreen(fake = fakeAuthClient(fakeSession('alice@test.nz'))) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      settings: () => <Text>Settings screen</Text>,
      'settings/password': ChangePasswordScreen,
    },
    { initialUrl: '/settings/password' },
  );
  return fake;
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

describe('Change password', () => {
  it('checks the new password before calling the server', async () => {
    const fake = renderScreen();
    fill('Current password', 'old-pass1');
    fill('New password', 'short');
    fill('Confirm new password', 'short');
    fireEvent.press(await screen.findByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/at least 8 characters/)).toBeTruthy();
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('changes the password and says so', async () => {
    const fake = renderScreen();
    fill('Current password', 'old-pass1');
    fill('New password', 'new-pass2');
    fill('Confirm new password', 'new-pass2');
    fireEvent.press(await screen.findByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'new-pass2' }));
    expect(await screen.findByText('Your password is changed.')).toBeTruthy();
  });
});
