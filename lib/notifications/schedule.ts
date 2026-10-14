import { toNZDateKey } from '@/lib/dates';
import { addDays } from '@/lib/events/repeat';
import type { EventRecord } from '@/lib/events/rows';

import { type Summary, summaryFor } from './summary';

export type PlannedSummary = Summary & { dateKey: string; fireAt: Date };

/** Notifications are written when scheduled, so the app schedules this many days ahead. */
export const SUMMARY_DAYS = 14;

/** One summary per day with events, from today, at `time` ('HH:mm') local time; past times are skipped. */
export function plannedSummaries(
  records: Record<string, EventRecord>,
  { time, now, days = SUMMARY_DAYS }: { time: string; now: Date; days?: number },
): PlannedSummary[] {
  const all = Object.values(records);
  const [hour, minute] = time.split(':').map(Number);
  const today = toNZDateKey(now);
  const planned: PlannedSummary[] = [];
  for (let i = 0; i < days; i++) {
    const dateKey = addDays(today, i);
    const [y, m, d] = dateKey.split('-').map(Number);
    const fireAt = new Date(y, m - 1, d, hour, minute, 0, 0);
    if (fireAt <= now) continue;
    const summary = summaryFor(dateKey, all);
    if (summary) planned.push({ dateKey, fireAt, ...summary });
  }
  return planned;
}
