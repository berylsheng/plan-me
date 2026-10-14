import { SplashScreen, Stack } from 'expo-router';
import React, { useEffect } from 'react';

import { useAuth } from '@/context/AuthProvider';

/** The planner needs a session; sign-in screens need none; email links work either way. */
export function RootNavigator() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  // Keep the splash screen up until we know whether someone is signed in.
  if (isLoading) return null;

  const signedIn = user !== null;
  // Every route is public unless listed in a Stack.Protected group. New signed-in routes (family/, settings/) must go in the first group.
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="family/create" options={{ title: 'Create a family' }} />
        <Stack.Screen name="family/join" options={{ title: 'Join a family' }} />
        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings/password" options={{ title: 'Change password' }} />
        <Stack.Screen name="settings/delete-account" options={{ title: 'Delete account' }} />
        <Stack.Screen name="event/[id]/edit" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" options={{ title: 'Signing in' }} />
      <Stack.Screen name="reset-password" options={{ title: 'New password' }} />
    </Stack>
  );
}
