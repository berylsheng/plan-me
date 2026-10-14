import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyFailure, type Failure } from './failures';
import { type EventRow, isEventRow } from './rows';

export const EVENT_COLUMNS =
  'id, owner_id, family_id, visibility, title, date, start_time, end_time, people, legacy_people, series_id, repeat, updated_at, deleted_at';

/** PostgREST returns at most 1000 rows per request by default. */
export const PAGE_SIZE = 1000;

export type PullResult = { ok: true; rows: EventRow[] } | { ok: false; reason: Failure };

/** Every event this user can see that isn't deleted, page by page. */
export async function fetchVisibleEvents(client: SupabaseClient, pageSize = PAGE_SIZE): Promise<PullResult> {
  const rows: EventRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error, status } = await client
      .from('events')
      .select(EVENT_COLUMNS)
      .is('deleted_at', null)
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) return { ok: false, reason: classifyFailure(error, status) };
    const page: unknown[] = data ?? [];
    for (const value of page) {
      if (isEventRow(value)) rows.push(value);
    }
    if (page.length < pageSize) return { ok: true, rows };
  }
}
