import { AuthApiError } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Slot } from 'expo-router';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import SignInScreen from '../../../app/(auth)/sign-in';

function renderSignIn(fake = fakeAuthClient()) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      'sign-in': SignInScreen,
      'forgot-password': () => <Text>Forgot screen</Text>,
      'sign-up': () => <Text>Sign-up screen</Text>,
    },
    { initialUrl: '/sign-in' },
  );
  return fake;
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

describe('Sign-in screen', () => {
  it('checks the form before calling the server', async () => {
    const fake = renderSignIn();
    fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with the normalised email', async () => {
    const fake = renderSignIn();
    fill('Email', ' Alice@Test.NZ ');
    fill('Password', 'family26');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'alice@test.nz', password: 'family26' }));
  });

  it('shows the server problem and lets you try again', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('x', 400, 'invalid_credentials'),
    });
    renderSignIn(fake);
    fill('Email', 'alice@test.nz');
    fill('Password', 'wrong');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('explains a dropped connection and re-enables the button', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Network request failed'));
    renderSignIn(fake);
    fill('Email', 'alice@test.nz');
    fill('Password', 'family26');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText("Can't reach the server. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('offers to resend the confirmation email when the account is unconfirmed', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('x', 400, 'email_not_confirmed'),
    });
    renderSignIn(fake);
    fill('Email', 'alice@test.nz');
    fill('Password', 'family26');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Resend confirmation email' }));
    expect(await screen.findByText('We sent a new confirmation email.')).toBeTruthy();
    expect(fake.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'alice@test.nz' }));
  });
});
