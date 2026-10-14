import { readSupabaseConfig } from '../config';

describe('readSupabaseConfig', () => {
  it('reads the Supabase URL and publishable key', () => {
    expect(readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toEqual({
      ok: true,
      url: 'https://abc.supabase.co',
      publishableKey: 'sb_publishable_x',
    });
  });

  it('names what is missing or blank', () => {
    expect(readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: ' ' })).toEqual({
      ok: false,
      missing: ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
    });
  });
});
