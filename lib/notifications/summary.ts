import { formatClock } from '@/lib/dates';
import type { EventRecord } from '@/lib/events/rows';

export type Summary = { title: string; body: string };

/** The notification lists this many events, then "+N more". */
export const MAX_LISTED = 6;

const byTime = (a: EventRecord, b: EventRecord): number => {
  // Timed events first, in time order; untimed ones after, by name.
  if (!a.startTime !== !b.startTime) return a.startTime ? -1 : 1;
  return a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name);
};

/** The morning notification for one NZ date, or null when nothing is planned. */
export function summaryFor(dateKey: string, records: readonly EventRecord[]): Summary | null {
  const day = records.filter(r => r.dateKey === dateKey).sort(byTime);
  if (day.length === 0) return null;
  const parts = day.slice(0, MAX_LISTED).map(r => (r.startTime ? `${formatClock(r.startTime)} ${r.name}` : r.name));
  if (day.length > MAX_LISTED) parts.push(`+${day.length - MAX_LISTED} more`);
  return { title: `Today: ${day.length} ${day.length === 1 ? 'event' : 'events'}`, body: parts.join(' · ') };
}
