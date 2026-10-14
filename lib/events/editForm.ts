import {
  addDays,
  daysBetween,
  inferRule,
  latestUntil,
  MAX_EVERY,
  occurrenceDates,
  PRESET_RULES,
  presetOf,
  type RepeatPreset,
  type RepeatRule,
  type RepeatUnit,
} from './repeat';
import type { EventInput, EventRecord, FormChanges, Visibility } from './rows';

/** What the edit form shows. Text fields keep what was typed; `until` is '' when not repeating. */
export type EventForm = {
  name: string;
  dateKey: string;
  startTime: string; // 'HH:mm' or ''
  endTime: string;
  repeat: RepeatPreset;
  customEvery: string;
  customUnit: RepeatUnit;
  until: string;
  memberIds: string[];
  legacyTags: string[]; // tags such as 'AZ' not mapped to a member
  shared: boolean;
};

export type FormErrors = Partial<Record<'name' | 'endTime' | 'customEvery' | 'until', string>>;
export type SaveScope = 'this' | 'future';

const MAX_NAME = 200;

/** The occurrences of the event's series, by date; just the event when it doesn't repeat. */
export function seriesOf(records: Record<string, EventRecord>, record: EventRecord): EventRecord[] {
  if (!record.occurrenceId) return [record];
  return Object.values(records)
    .filter(r => r.occurrenceId === record.occurrenceId)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function formFromRecord(record: EventRecord, series: EventRecord[]): EventForm {
  // Series made before rules were stored get one worked out from their dates.
  const rule = record.occurrenceId ? (record.repeat ?? inferRule(series.map(r => r.dateKey))) : null;
  return {
    name: record.name,
    dateKey: record.dateKey,
    startTime: record.startTime,
    endTime: record.endTime,
    repeat: presetOf(rule),
    customEvery: String(rule?.every ?? 1),
    customUnit: rule?.unit ?? 'week',
    until: rule?.until ?? '',
    memberIds: [...record.memberIds],
    legacyTags: [...(record.people ?? [])],
    shared: record.visibility === 'shared',
  };
}

export function ruleOf(form: EventForm): RepeatRule | null {
  if (form.repeat === 'none') return null;
  const step = form.repeat === 'custom' ? { every: Number(form.customEvery), unit: form.customUnit } : PRESET_RULES[form.repeat];
  return { ...step, until: form.until };
}

/** A new date; the end date moves with it so the series keeps its length. */
export const withDate = (form: EventForm, dateKey: string): EventForm => ({
  ...form,
  dateKey,
  until: form.until ? addDays(form.until, daysBetween(form.dateKey, dateKey)) : '',
});

/**
 * What's wrong with the form. Given the form as it opened, the end date is only checked when the
 * repeat changes: series made before the one-year limit can still be edited as they are.
 */
export function validateForm(form: EventForm, initial?: EventForm): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = 'Enter a name.';
  else if (Array.from(name).length > MAX_NAME) errors.name = 'Use at most 200 characters.';
  if (form.endTime && !form.startTime) errors.endTime = 'Add a start time first.';
  else if (form.endTime && form.endTime <= form.startTime) errors.endTime = 'End after the start time.';
  if (form.repeat === 'custom') {
    const every = Number(form.customEvery);
    if (!/^\d+$/.test(form.customEvery) || every < 1 || every > MAX_EVERY) errors.customEvery = 'Enter a number from 1 to 99.';
  }
  if (form.repeat !== 'none' && (!initial || ruleChanged(form, initial))) {
    if (!form.until) errors.until = 'Choose an end date.';
    else if (form.until < form.dateKey) errors.until = "End on or after the event's date.";
    else if (form.until > latestUntil(form.dateKey)) errors.until = 'End within a year of the event.';
  }
  return errors;
}

const comparable = (f: EventForm) =>
  JSON.stringify({
    ...f,
    name: f.name.trim(),
    customEvery: f.repeat === 'custom' ? f.customEvery : '',
    customUnit: f.repeat === 'custom' ? f.customUnit : 'week',
    until: f.repeat === 'none' ? '' : f.until,
    memberIds: [...f.memberIds].sort(),
    legacyTags: [...f.legacyTags].sort(),
  });

export const sameForm = (a: EventForm, b: EventForm): boolean => comparable(a) === comparable(b);

/** A different repeat, or an end date that didn't just move with the date. */
export function ruleChanged(form: EventForm, initial: EventForm): boolean {
  const shape = (f: EventForm) => {
    const rule = ruleOf(f);
    return rule ? `${rule.every} ${rule.unit} ${daysBetween(f.dateKey, rule.until)}` : 'none';
  };
  return shape(form) !== shape(initial);
}

/** Ask "this event only / this and all future" only when both would differ. */
export const needsScope = (record: EventRecord, series: EventRecord[], form: EventForm, initial: EventForm): boolean =>
  !!record.occurrenceId && !ruleChanged(form, initial) && series.some(r => r.id !== record.id && r.dateKey > record.dateKey);

type SaveInput = { form: EventForm; initial: EventForm; record: EventRecord; series: EventRecord[]; scope: SaveScope; newId: () => string };

/** The creates, updates and deletes that save the form (spec §3). */
export function planFormSave({ form, initial, record, series, scope, newId }: SaveInput): FormChanges {
  const visibility: Visibility = form.shared ? 'shared' : 'personal';
  const details = {
    name: form.name.trim(),
    startTime: form.startTime,
    endTime: form.endTime,
    people: form.legacyTags.length > 0 ? [...form.legacyTags] : undefined,
    memberIds: [...form.memberIds],
    visibility,
  };
  const rule = ruleOf(form);
  const alone = (dateKey: string): EventInput => ({ ...record, ...details, dateKey, occurrenceId: undefined, repeat: undefined });
  const newSeries = (dates: string[], seriesId: string): EventInput[] =>
    dates.map(dateKey => ({ ...details, id: newId(), dateKey, occurrenceId: seriesId, repeat: rule ?? undefined }));

  if (!record.occurrenceId) {
    const dates = rule ? occurrenceDates(form.dateKey, rule) : [];
    if (dates.length < 2) return { remove: [], update: [alone(form.dateKey)], create: [] };
    const seriesId = newId();
    return {
      remove: [],
      update: [{ ...alone(dates[0]), occurrenceId: seriesId, repeat: rule ?? undefined }],
      create: newSeries(dates.slice(1), seriesId),
    };
  }

  const later = series.filter(r => r.id !== record.id && r.dateKey > record.dateKey);
  const earlier = series.filter(r => r.id !== record.id && r.dateKey < record.dateKey);
  const oldRule = ruleOf(initial);
  // Earlier occurrences become their own run, ending the day before this one was (never extended).
  const cutoff = addDays(record.dateKey, -1);
  const trimEarlier = (): EventInput[] =>
    earlier.map(r => {
      const base = r.repeat ?? oldRule;
      if (!base) return { ...r, repeat: undefined };
      const newUntil = base.until && base.until < cutoff ? base.until : cutoff;
      return { ...r, repeat: { ...base, until: newUntil } };
    });

  if (ruleChanged(form, initial)) {
    const dates = rule ? occurrenceDates(form.dateKey, rule) : [];
    if (dates.length < 2) return { remove: later.map(r => r.id), update: [alone(form.dateKey), ...trimEarlier()], create: [] };
    return { remove: [record.id, ...later.map(r => r.id)], update: trimEarlier(), create: newSeries(dates, newId()) };
  }

  const shift = daysBetween(record.dateKey, form.dateKey);
  if (scope === 'this') {
    return { remove: [], update: [shift === 0 ? { ...record, ...details } : alone(form.dateKey)], create: [] };
  }
  // scope === 'future'
  if (shift === 0) {
    // No date move: keep each occurrence's own stored repeat so an old series stays unlabelled.
    const moved = [record, ...later].map(r => ({ ...r, ...details, repeat: r.repeat }));
    return { remove: [], update: moved, create: [] };
  }
  // Date move: the moved run gets a new series id so it's separate from the trimmed earlier run.
  const newSeriesId = newId();
  const movedWithNewId = [record, ...later].map(r => ({
    ...r, ...details,
    dateKey: addDays(r.dateKey, shift),
    occurrenceId: newSeriesId,
    repeat: rule ?? undefined,
  }));
  return { remove: [], update: [...movedWithNewId, ...trimEarlier()], create: [] };
}
