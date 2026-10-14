import { sortItems } from './items';
import { isRepeatRule, type RepeatRule } from './repeat';
import type { ItemsByDate, LocalEvent } from './types';
import { isUuid } from './uuid';

export type Visibility = 'personal' | 'shared';

/** A row of public.events, as the app reads it. */
export type EventRow = {
  id: string;
  owner_id: string | null;
  family_id: string | null;
  visibility: Visibility;
  title: string;
  date: string; // 'yyyy-mm-dd'
  start_time: string | null; // 'HH:mm:ss'
  end_time: string | null;
  people: string[]; // family member ids (Plan 5)
  legacy_people: string[]; // tags such as 'AZ'
  series_id: string | null;
  repeat?: RepeatRule | null; // FEAT-004
  updated_at: string;
  deleted_at: string | null;
};

/** What the phone keeps for each event: the planner's fields plus what sync needs. */
export type EventRecord = LocalEvent & {
  ownerId: string | null;
  visibility: Visibility;
  memberIds: string[];
  /** Server time of the last save we know of; null until the server has it. */
  updatedAt: string | null;
};

/** An event from the planner: who it's for and who sees it are optional (kept as they are when editing). */
export type EventInput = LocalEvent & { visibility?: Visibility; memberIds?: string[] };

/** What saving the edit form does: events to delete, update and create. */
export type FormChanges = { remove: string[]; update: EventInput[]; create: EventInput[] };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_TITLE = 200;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isVisibility = (v: unknown): v is Visibility => v === 'personal' || v === 'shared';

export function isEventRow(v: unknown): v is EventRow {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    isNullableString(r.owner_id) &&
    isNullableString(r.family_id) &&
    isVisibility(r.visibility) &&
    typeof r.title === 'string' &&
    typeof r.date === 'string' &&
    isNullableString(r.start_time) &&
    isNullableString(r.end_time) &&
    isStringArray(r.people) &&
    isStringArray(r.legacy_people) &&
    isNullableString(r.series_id) &&
    (r.repeat === undefined || r.repeat === null || isRepeatRule(r.repeat)) &&
    typeof r.updated_at === 'string' &&
    isNullableString(r.deleted_at)
  );
}

export function isEventRecord(v: unknown): v is EventRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    isUuid(r.id) &&
    typeof r.dateKey === 'string' &&
    DATE_KEY.test(r.dateKey) &&
    typeof r.name === 'string' &&
    typeof r.startTime === 'string' &&
    typeof r.endTime === 'string' &&
    (r.people === undefined || isStringArray(r.people)) &&
    (r.occurrenceId === undefined || typeof r.occurrenceId === 'string') &&
    (r.repeat === undefined || isRepeatRule(r.repeat)) &&
    isNullableString(r.ownerId) &&
    isVisibility(r.visibility) &&
    isStringArray(r.memberIds) &&
    isNullableString(r.updatedAt)
  );
}

const toPlannerTime = (time: string | null): string => (time ? time.slice(0, 5) : '');
const toDbTime = (time: string): string | null => (HH_MM.test(time) ? `${time}:00` : null);
const titleOf = (name: string): string => Array.from(name.trim() || 'Busy').slice(0, MAX_TITLE).join('');
const seriesOf = (occurrenceId: string | undefined): string | null => (occurrenceId && isUuid(occurrenceId) ? occurrenceId : null);

export function recordFromRow(row: EventRow): EventRecord {
  const record: EventRecord = {
    id: row.id,
    dateKey: row.date,
    name: row.title,
    startTime: toPlannerTime(row.start_time),
    endTime: toPlannerTime(row.end_time),
    ownerId: row.owner_id,
    visibility: row.visibility,
    memberIds: row.people,
    updatedAt: row.updated_at,
  };
  if (row.legacy_people.length > 0) record.people = row.legacy_people;
  if (row.series_id) record.occurrenceId = row.series_id;
  if (row.series_id && row.repeat) record.repeat = row.repeat;
  return record;
}

/** Columns a client may set when editing; id and owner never change. The server fills or clears
 * family_id from visibility, and only the creator may make a shared event personal (events_guard). */
export const updatePayload = (r: EventRecord) => ({
  title: titleOf(r.name),
  date: r.dateKey,
  start_time: toDbTime(r.startTime),
  end_time: toDbTime(r.endTime),
  visibility: r.visibility,
  people: r.memberIds,
  legacy_people: r.people ?? [],
  series_id: seriesOf(r.occurrenceId),
  repeat: seriesOf(r.occurrenceId) && r.repeat ? r.repeat : null,
});

/** Columns a client sets when creating; the server fills family_id and the timestamps. */
export const insertPayload = (r: EventRecord) => ({
  id: r.id,
  owner_id: r.ownerId,
  ...updatePayload(r),
});

export function recordsToItems(records: Record<string, EventRecord>): ItemsByDate {
  const byDate: ItemsByDate = {};
  for (const record of Object.values(records)) {
    (byDate[record.dateKey] ??= []).push(record);
  }
  return sortItems(byDate);
}

/** A new event typed on this phone, owned by the user and not yet on the server. Personal unless shared. */
export function newRecord(event: EventInput, ownerId: string): EventRecord {
  const { visibility = 'personal', memberIds = [], ...rest } = event;
  return { ...rest, ownerId, visibility, memberIds, updatedAt: null };
}

/** The pre-accounts events on the phone, as new personal events for one account. */
export function recordsFromLegacy(items: ItemsByDate, ownerId: string, newId: () => string): EventRecord[] {
  const series = new Map<string, string>();
  const records: EventRecord[] = [];
  for (const dateKey of Object.keys(items).sort()) {
    if (!DATE_KEY.test(dateKey)) continue;
    for (const event of items[dateKey]) {
      let seriesId: string | undefined;
      if (event.occurrenceId) {
        seriesId = series.get(event.occurrenceId) ?? newId();
        series.set(event.occurrenceId, seriesId);
      }
      const record: EventRecord = newRecord(
        {
          id: newId(),
          dateKey,
          name: event.name.trim() || 'Busy',
          startTime: HH_MM.test(event.startTime) ? event.startTime : '',
          endTime: HH_MM.test(event.endTime) ? event.endTime : '',
        },
        ownerId,
      );
      if (event.people && event.people.length > 0) record.people = event.people;
      if (seriesId) record.occurrenceId = seriesId;
      records.push(record);
    }
  }
  return records;
}
