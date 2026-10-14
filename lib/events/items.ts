import type { EventDraft } from '../parse/parseEventInput';
import { DEFAULT_TAGS, extractTags } from '../parse/tags';
import type { ItemsByDate, LocalEvent } from './types';

/** Anything older app versions may have saved. */
export type StoredEvent = Partial<LocalEvent> & { time?: string };

export const newEventId = (): string => Date.now().toString() + Math.random().toString(36).slice(2);

export const sortItems = (itemsObj: ItemsByDate): ItemsByDate => {
  const sorted: ItemsByDate = {};
  for (const key of Object.keys(itemsObj).sort()) {
    sorted[key] = [...itemsObj[key]].sort((a, b) => {
      const startCmp = (a.startTime || '').localeCompare(b.startTime || '');
      if (startCmp !== 0) return startCmp;
      return (a.endTime || '').localeCompare(b.endTime || '');
    });
  }
  return sorted;
};

/** Bring events saved by older app versions up to the current shape. */
export const migrateStoredItems = (
  stored: Record<string, StoredEvent[]>,
  newId: () => string = newEventId,
  knownTags: readonly string[] = DEFAULT_TAGS,
): ItemsByDate => {
  const migrated: ItemsByDate = {};
  for (const dateKey of Object.keys(stored)) {
    migrated[dateKey] = stored[dateKey].map(({ time, ...item }) => {
      // Older versions kept "HH:mm-HH:mm" in a single `time` field
      let { startTime, endTime } = item;
      if (time !== undefined && startTime === undefined) {
        const parts = time.split('-');
        startTime = parts[0] || '';
        endTime = parts[1] || '';
      }
      const event: LocalEvent = {
        ...item,
        id: item.id ?? newId(),
        dateKey: item.dateKey ?? dateKey,
        name: item.name ?? '',
        startTime: startTime ?? '',
        endTime: endTime ?? '',
      };
      // Older versions kept person tags inside the name
      if (!event.people) {
        const { text, tags } = extractTags(event.name, knownTags);
        event.name = text.trim();
        if (tags.length > 0) event.people = tags;
      }
      return event;
    });
  }
  return sortItems(migrated);
};

/** One event per date in the draft; recurring ones share `seriesId` as their occurrenceId. */
export const draftToEvents = (draft: EventDraft, newId: () => string, seriesId: string | null): LocalEvent[] =>
  draft.dateKeys.map(dateKey => {
    const event: LocalEvent = {
      id: newId(),
      dateKey,
      name: draft.name,
      startTime: draft.startTime,
      endTime: draft.endTime,
    };
    if (draft.people.length > 0) event.people = draft.people;
    if (seriesId) event.occurrenceId = seriesId;
    if (seriesId && draft.repeat) event.repeat = draft.repeat;
    return event;
  });

