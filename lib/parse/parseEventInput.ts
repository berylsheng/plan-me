import * as chrono from 'chrono-node';

import { formatTime, toNZDateKey } from '../dates';
import { occurrenceDates, type RepeatRule } from '../events/repeat';
import { preprocessInput } from './preprocess';
import { parseRecurrence } from './recurrence';
import { DEFAULT_TAGS, extractTags } from './tags';

export type EventDraft = {
  name: string;
  startTime: string; // 'HH:mm' or ''
  endTime: string; // 'HH:mm' or ''
  people: string[];
  dateKeys: string[]; // the first date, then any recurring dates
  isRecurring: boolean;
  repeat: RepeatRule | null; // the series' rule, null for a single event
};

export type ParseResult =
  | { ok: true; draft: EventDraft }
  | { ok: false; error: 'no-date-or-time' };

export type ParseOptions = {
  /** Used when the sentence has a time but no date. */
  selectedDateKey: string;
  knownTags?: readonly string[];
  /** Reference time for relative dates such as "tomorrow". */
  now?: Date;
};

export const parseEventInput = (
  input: string,
  { selectedDateKey, knownTags = DEFAULT_TAGS, now = new Date() }: ParseOptions,
): ParseResult => {
  const { text: withoutTags, tags: people } = extractTags(input, knownTags);
  const tagStripped = withoutTags.replace(/,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').trim();

  // Check for recurrence pattern before other processing
  const recurrence = parseRecurrence(tagStripped);
  const textForParsing = recurrence ? recurrence.cleanText : tagStripped;

  // Normalise shorthand ranges before chrono sees them
  const processedInput = preprocessInput(textForParsing);
  const parsedResults = chrono.parse(processedInput, now);

  const dateResult = parsedResults.find(r => r.start.isCertain('day') || r.start.isCertain('month'));
  const timeResult = parsedResults.find(r => r.start.isCertain('hour'));
  if (!dateResult && !timeResult) return { ok: false, error: 'no-date-or-time' };

  // Use parsed date, or fall back to the currently selected date on the calendar
  let baseDateObj: Date;
  let dateKey: string;
  if (dateResult) {
    baseDateObj = dateResult.start.date();
    dateKey = toNZDateKey(baseDateObj);
  } else {
    dateKey = selectedDateKey;
    const [y, m, d] = dateKey.split('-').map(Number);
    baseDateObj = new Date(y, m - 1, d);
  }

  const startTime = new Date(baseDateObj);
  if (timeResult && timeResult !== dateResult) {
    const t = timeResult.start.date();
    startTime.setHours(t.getHours(), t.getMinutes(), 0, 0);
  }

  let startTimeStr = '';
  let endTimeStr = '';
  if (timeResult?.start.isCertain('hour')) {
    startTimeStr = formatTime(startTime);
    const endSource = timeResult.end ?? dateResult?.end;
    if (endSource) {
      const endTime = new Date(baseDateObj);
      const e = endSource.date();
      endTime.setHours(e.getHours(), e.getMinutes(), 0, 0);
      endTimeStr = formatTime(endTime);
    }
  }

  // Strip parsed text from processedInput (not original) so positions match
  let name = processedInput;
  for (const r of parsedResults) {
    name = name.replace(r.text, '');
  }
  name = name.replace(/^[\s,]+|[\s,]+$/g, '').trim() || 'Busy';

  // The base date + any recurring dates
  const rule = recurrence ? recurrence.ruleFor(dateKey) : null;
  const dateKeys = rule ? occurrenceDates(dateKey, rule) : [dateKey];
  const repeat = rule && dateKeys.length > 1 ? rule : null;

  return {
    ok: true,
    draft: { name, startTime: startTimeStr, endTime: endTimeStr, people, dateKeys: repeat ? dateKeys : [dateKey], isRecurring: repeat !== null, repeat },
  };
};
