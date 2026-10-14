import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { SplashScreen } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import 'react-native-reanimated';

import { RootNavigator } from '@/components/navigation/RootNavigator';
import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { FamilyProvider } from '@/context/FamilyProvider';
import { MorningSummaryProvider } from '@/context/MorningSummaryProvider';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MissingConfig } from '@/components/app/MissingConfig';
import { supabase, supabaseConfig } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  if (!supabase) return <MissingConfig missing={supabaseConfig.ok ? [] : supabaseConfig.missing} />;

  return (
    <AuthProvider client={supabase}>
      <EventsProvider>
        <FamilyProvider>
          <MorningSummaryProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <RootNavigator />
              <StatusBar style="auto" />
            </ThemeProvider>
          </MorningSummaryProvider>
        </FamilyProvider>
      </EventsProvider>
    </AuthProvider>
  );
}
