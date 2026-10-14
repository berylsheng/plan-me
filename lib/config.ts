export type SupabaseConfig = { ok: true; url: string; publishableKey: string } | { ok: false; missing: string[] };

const URL_KEY = 'EXPO_PUBLIC_SUPABASE_URL';
const PUBLISHABLE_KEY = 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

/** The server settings a build needs, or the names of the ones it lacks. */
export function readSupabaseConfig(env: Record<string, string | undefined>): SupabaseConfig {
  const url = env[URL_KEY]?.trim();
  const publishableKey = env[PUBLISHABLE_KEY]?.trim();
  if (url && publishableKey) return { ok: true, url, publishableKey };
  return { ok: false, missing: [...(url ? [] : [URL_KEY]), ...(publishableKey ? [] : [PUBLISHABLE_KEY])] };
}
