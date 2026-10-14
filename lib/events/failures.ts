/** What to do about a failed Supabase request: retry later, wait for a fresh session, or give up on it. */
export type Failure = 'network' | 'auth' | 'rejected';

export function classifyFailure(error: { code?: string } | null, status: number): Failure {
  // 401 covers an expired token and requests made without a session: wait, never drop.
  if (status === 401 || error?.code === 'PGRST301' || error?.code === 'PGRST303') return 'auth';
  // supabase-js reports a failed fetch as status 0.
  // A 404 is treated as network: a missing table or stale schema cache must never empty the queue.
  // A column the database doesn't have yet (PGRST204 from the schema cache, 42703 from Postgres) means
  // this build was installed before the migration was pushed: retry once it's there, never drop.
  if (error?.code === 'PGRST204' || error?.code === '42703') return 'network';
  if (status === 0 || status === 404 || status === 408 || status === 429 || status >= 500) return 'network';
  return 'rejected';
}
