import { AuthApiError } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import SignUpScreen from '../../../app/(auth)/sign-up';

function renderSignUp(fake = fakeAuthClient()) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      'sign-up': SignUpScreen,
      'sign-in': () => <Text>Sign-in screen</Text>,
    },
    { initialUrl: '/sign-up' },
  );
  return fake;
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

const fillValidForm = () => {
  fill('Your name (optional)', 'Alice');
  fill('Email', 'Alice@test.nz');
  fill('Password', 'family26');
  fill('Confirm password', 'family26');
};

describe('Sign-up screen', () => {
  it('shows every form problem at once', async () => {
    const fake = renderSignUp();
    fill('Email', 'alice');
    fill('Password', 'short');
    fill('Confirm password', 'other');
    fireEvent.press(await screen.findByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
    expect(screen.getByText("Passwords don't match.")).toBeTruthy();
    expect(fake.auth.signUp).not.toHaveBeenCalled();
  });

  it('asks you to check your email after signing up', async () => {
    const fake = renderSignUp();
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(screen.getByText(/alice@test\.nz/)).toBeTruthy();
    expect(fake.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@test.nz', options: expect.objectContaining({ data: { display_name: 'Alice' } }) }),
    );
  });

  it('tells you to sign in if the email already has an account', async () => {
    const fake = fakeAuthClient();
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: new AuthApiError('x', 422, 'user_already_exists') });
    renderSignUp(fake);
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists. Sign in instead.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Check your email')).toBeNull());
  });
});
