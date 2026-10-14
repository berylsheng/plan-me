import { AuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import ResetPasswordScreen from '../../../app/reset-password';

function renderReset(fake: ReturnType<typeof fakeAuthClient>, initialUrl: string) {
  renderRouter(
    {
      _layout: () => (
        <React.StrictMode>
          <AuthProvider client={fake.client}>
            <Slot />
          </AuthProvider>
        </React.StrictMode>
      ),
      'reset-password': ResetPasswordScreen,
      'forgot-password': () => <Text>Forgot screen</Text>,
      index: () => <Text>Planner</Text>,
    },
    { initialUrl },
  );
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

describe('Reset-password screen', () => {
  it('uses the link code exactly once, even under StrictMode', async () => {
    const fake = fakeAuthClient();
    renderReset(fake, '/reset-password?code=abc');
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it('saves the new password and opens the planner', async () => {
    const fake = fakeAuthClient();
    renderReset(fake, '/reset-password?code=abc');
    await screen.findByLabelText('New password');
    act(() => fake.emit('PASSWORD_RECOVERY', fakeSession()));
    fill('New password', 'newfamily27');
    fill('Confirm password', 'newfamily27');
    fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Planner')).toBeTruthy();
    expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'newfamily27' });
  });

  it('checks the new password before saving', async () => {
    const fake = fakeAuthClient();
    renderReset(fake, '/reset-password?code=abc');
    await screen.findByLabelText('New password');
    fill('New password', 'abc');
    fill('Confirm password', 'abc');
    fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    expect(fake.auth.updateUser).not.toHaveBeenCalled();
  });

  it('explains a link opened on another phone and offers a new one', async () => {
    const fake = fakeAuthClient();
    fake.auth.exchangeCodeForSession.mockRejectedValueOnce(new AuthPKCECodeVerifierMissingError());
    renderReset(fake, '/reset-password?code=abc');
    expect(
      await screen.findByText('This link has expired or was opened on a different device. Request a new one on this phone.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Request a new link'));
    expect(await screen.findByText('Forgot screen')).toBeTruthy();
  });

  it('never shows text from the link itself', async () => {
    renderReset(fakeAuthClient(), '/reset-password?error=access_denied&error_code=otp_expired&error_description=Call%200800%20SCAM');
    await waitFor(() => expect(screen.getByText(/This link has expired/)).toBeTruthy());
    expect(screen.queryByText(/SCAM/)).toBeNull();
  });
});
