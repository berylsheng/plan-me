import { addDays, addMonths, latestUntil, MAX_EVERY, type RepeatRule, type RepeatUnit } from '../events/repeat';

export type Recurrence = {
  /** The input with the recurrence phrase removed. */
  cleanText: string;
  /** The rule for a series starting on `start` ('yyyy-mm-dd'). */
  ruleFor: (start: string) => RepeatRule;
};

const KEYWORDS: Record<string, { every: number; unit: RepeatUnit }> = {
  daily: { every: 1, unit: 'day' },
  weekly: { every: 1, unit: 'week' },
  fortnightly: { every: 2, unit: 'week' },
  monthly: { every: 1, unit: 'month' },
};

// Parse recurrence patterns like "weekly for 4 months", "daily for 2 weeks", "every 2 weeks for 6 months".
// "for N weeks|months" is a window from the first date: the series ends the day before it closes.
export const parseRecurrence = (text: string): Recurrence | null => {
  const pattern = /,?\s*(?:(daily|weekly|fortnightly|monthly)|every\s+(\d+)\s+(days?|weeks?|months?))\s+for\s+(\d+)\s+(weeks?|months?)/i;
  const match = text.match(pattern);
  if (!match) return null;

  const step = match[1]
    ? KEYWORDS[match[1].toLowerCase()]
    : {
        every: Math.min(Math.max(parseInt(match[2], 10), 1), MAX_EVERY),
        unit: match[3].toLowerCase().replace(/s$/, '') as RepeatUnit,
      };
  const duration = parseInt(match[4], 10);
  const inMonths = match[5].toLowerCase().startsWith('month');

  return {
    cleanText: text.replace(match[0], '').trim(),
    ruleFor: (start: string): RepeatRule => {
      const windowEnd = inMonths ? addMonths(start, duration) : addDays(start, duration * 7);
      const until = addDays(windowEnd, -1);
      const cap = latestUntil(start);
      return { ...step, until: until > cap ? cap : until < start ? start : until };
    },
  };
};
