/** How a recurring event repeats. Every occurrence of a series carries the same rule. */
export type RepeatUnit = 'day' | 'week' | 'month';
export type RepeatRule = { every: number; unit: RepeatUnit; until: string /* 'yyyy-mm-dd', inclusive */ };
export type RepeatPreset = 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'custom';

export const MAX_EVERY = 99;
const DAY_MS = 86_400_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const UNITS: readonly string[] = ['day', 'week', 'month'];

export const PRESET_RULES = {
  daily: { every: 1, unit: 'day' },
  weekly: { every: 1, unit: 'week' },
  fortnightly: { every: 2, unit: 'week' },
  monthly: { every: 1, unit: 'month' },
} as const satisfies Record<string, Pick<RepeatRule, 'every' | 'unit'>>;

// Date keys are calendar dates: do the arithmetic in UTC so daylight saving never shifts a day.
const toUtc = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const isDateKey = (v: unknown): v is string => typeof v === 'string' && DATE_KEY.test(v) && fromUtc(toUtc(v)) === v;

export function isRepeatRule(v: unknown): v is RepeatRule {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    Number.isInteger(r.every) &&
    (r.every as number) >= 1 &&
    (r.every as number) <= MAX_EVERY &&
    typeof r.unit === 'string' &&
    UNITS.includes(r.unit) &&
    isDateKey(r.until)
  );
}

export const addDays = (key: string, n: number): string => fromUtc(toUtc(key) + n * DAY_MS);

export const daysBetween = (from: string, to: string): number => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

/** The same day of month n months on, or that month's last day when it is shorter. */
export function addMonths(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const index = m - 1 + n;
  const year = y + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(year, month, Math.min(d, lastDay)));
}

/** A series ends at most a year after its first date. */
export const latestUntil = (start: string): string => addMonths(start, 12);

/** The dates of a series: the start, then every step up to and including `until` (at most a year). */
export function occurrenceDates(start: string, rule: RepeatRule): string[] {
  const limit = rule.until < latestUntil(start) ? rule.until : latestUntil(start);
  const dates: string[] = [];
  for (let i = 0; ; i++) {
    // Monthly steps count from the start, so 31 Jan → 28 Feb → 31 Mar.
    const key = rule.unit === 'month' ? addMonths(start, i * rule.every) : addDays(start, i * rule.every * (rule.unit === 'week' ? 7 : 1));
    if (key > limit) return dates;
    dates.push(key);
  }
}

const monthsApart = (from: string, to: string): number => {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};

/** The rule a series without one (made before rules were stored) most likely had. `dates` sorted, unique. */
export function inferRule(dates: readonly string[]): RepeatRule | null {
  if (dates.length < 2) return null;
  const first = dates[0];
  const until = dates[dates.length - 1];
  const months = dates.map(d => monthsApart(first, d));
  if (dates.every((d, i) => months[i] > 0 === i > 0 && addMonths(first, months[i]) === d)) {
    const every = Math.min(...months.slice(1).map((m, i) => m - months[i]));
    return { every: Math.min(every, MAX_EVERY), unit: 'month', until };
  }
  const gap = Math.min(...dates.slice(1).map((d, i) => daysBetween(dates[i], d)));
  if (gap % 7 === 0 && gap / 7 <= MAX_EVERY) return { every: gap / 7, unit: 'week', until };
  return { every: Math.min(gap, MAX_EVERY), unit: 'day', until };
}

export function presetOf(rule: Pick<RepeatRule, 'every' | 'unit'> | null): RepeatPreset {
  if (!rule) return 'none';
  for (const [preset, value] of Object.entries(PRESET_RULES)) {
    if (value.every === rule.every && value.unit === rule.unit) return preset as RepeatPreset;
  }
  return 'custom';
}
