import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { LargeSecureStore } from './auth/secureStorage';
import { readSupabaseConfig } from './config';

// Written out by name: Expo only inlines EXPO_PUBLIC_ variables referenced literally.
// Locally they come from .env.local (see .env.example); in EAS builds from `eas env`.
export const supabaseConfig = readSupabaseConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

/** Null when the build has no server settings; the app then shows MissingConfig instead of crashing. */
export const supabase: SupabaseClient | null = supabaseConfig.ok
  ? createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: {
        // SecureStore doesn't exist on web; the web build only matters for quick UI checks.
        storage: Platform.OS === 'web' ? AsyncStorage : new LargeSecureStore(),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    })
  : null;

// supabase-js can't tell whether a phone app is in the foreground, so refresh tokens
// only while it is.
AppState.addEventListener('change', state => {
  if (state === 'active') {
    supabase?.auth.startAutoRefresh();
  } else {
    supabase?.auth.stopAutoRefresh();
  }
});
