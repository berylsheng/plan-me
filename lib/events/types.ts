import type { RepeatRule } from './repeat';

/** An event as stored on the device under the AsyncStorage key `planMeTasks`. */
export type LocalEvent = {
  id: string;
  dateKey: string; // 'yyyy-mm-dd', NZ time
  name: string;
  startTime: string; // 'HH:mm' or ''
  endTime: string; // 'HH:mm' or ''
  people?: string[]; // person tags, e.g. 'AZ'
  occurrenceId?: string; // shared by every occurrence of one recurring event
  repeat?: RepeatRule; // how the series repeats (FEAT-004)
};

/** Events grouped by date key, each day sorted by start time. */
export type ItemsByDate = Record<string, LocalEvent[]>;
