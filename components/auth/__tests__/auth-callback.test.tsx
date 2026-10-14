import { AuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';
import { screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import AuthCallbackScreen from '../../../app/auth-callback';

function renderCallback(fake: ReturnType<typeof fakeAuthClient>, initialUrl: string) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      'auth-callback': AuthCallbackScreen,
      'sign-in': () => <Text>Sign-in screen</Text>,
      index: () => <Text>Planner</Text>,
    },
    { initialUrl },
  );
}

describe('Email confirmation link', () => {
  it('signs you in and opens the planner', async () => {
    // fakeAuthClient(fakeSession()) provides the session that arrives via SIGNED_IN in production.
    const fake = fakeAuthClient(fakeSession());
    renderCallback(fake, '/auth-callback?code=abc');
    expect(await screen.findByText('Planner')).toBeTruthy();
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  // The usual case: opened signed out, the exchange signs you in. supabase-js reports
  // SIGNED_IN before the exchange returns; the screen must wait for the session either way.
  it.each([
    ['before the exchange returns', false],
    ['after the exchange returns', true],
  ])('opens the planner when the session arrives %s', async (_label, late) => {
    const fake = fakeAuthClient();
    const session = fakeSession();
    fake.auth.exchangeCodeForSession.mockImplementationOnce(async () => {
      if (late) setTimeout(() => fake.emit('SIGNED_IN', session), 10);
      else fake.emit('SIGNED_IN', session);
      return { data: { session, user: session.user }, error: null } as Awaited<
        ReturnType<typeof fake.client.auth.exchangeCodeForSession>
      >;
    });
    renderCallback(fake, '/auth-callback?code=abc');
    expect(await screen.findByText('Planner')).toBeTruthy();
  });

  it('says the email is confirmed when the link was opened on another device', async () => {
    const fake = fakeAuthClient();
    fake.auth.exchangeCodeForSession.mockRejectedValueOnce(new AuthPKCECodeVerifierMissingError());
    renderCallback(fake, '/auth-callback?code=abc');
    expect(await screen.findByText('Your email is confirmed. Sign in to continue.')).toBeTruthy();
  });

  it('explains an expired link', async () => {
    renderCallback(fakeAuthClient(), '/auth-callback?error=access_denied&error_code=otp_expired');
    expect(await screen.findByText(/This link has expired/)).toBeTruthy();
    expect(screen.getByText('Back to sign in')).toBeTruthy();
  });

  it('offers a way back to the planner when a link error occurs while signed in', async () => {
    renderCallback(fakeAuthClient(fakeSession()), '/auth-callback?error=access_denied&error_code=otp_expired');
    expect(await screen.findByText(/This link has expired/)).toBeTruthy();
    expect(screen.getByText('Back to the planner')).toBeTruthy();
  });
});
