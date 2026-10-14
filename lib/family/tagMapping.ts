import type { EventInput, EventRecord } from '@/lib/events/rows';
import type { KeyValueStorage } from '@/lib/events/store';

import { familyKeys } from './cache';

/** For each old tag: the member it means, or null for "no one, keep it as text". */
export type TagAnswers = Record<string, string | null>;

export async function readTagAnswers(storage: KeyValueStorage, userId: string): Promise<TagAnswers> {
  try {
    const raw = await storage.getItem(familyKeys(userId).tagAnswers);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string | null] => entry[1] === null || typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

export async function saveTagAnswer(storage: KeyValueStorage, userId: string, tag: string, memberId: string | null): Promise<TagAnswers> {
  const answers = { ...(await readTagAnswers(storage, userId)), [tag]: memberId };
  await storage.setItem(familyKeys(userId).tagAnswers, JSON.stringify(answers));
  return answers;
}

/** Old tags on events (not linked to a member), in alphabetical order. */
export function legacyTagsIn(records: Record<string, EventRecord>): string[] {
  return [...new Set(Object.values(records).flatMap(r => r.people ?? []))].sort();
}

export function nextTagToAsk(records: Record<string, EventRecord>, answers: TagAnswers): string | null {
  return legacyTagsIn(records).find(tag => !(tag in answers)) ?? null;
}

/** Events whose old tags now have a member in the family, with those tags moved to `memberIds`. */
export function remapTags(records: Record<string, EventRecord>, answers: TagAnswers, memberIds: ReadonlySet<string>): EventInput[] {
  const changed: EventInput[] = [];
  for (const record of Object.values(records)) {
    const tags = record.people ?? [];
    const moving = tags.filter(tag => {
      const id = answers[tag];
      return typeof id === 'string' && memberIds.has(id);
    });
    if (moving.length === 0) continue;
    const ids = [...record.memberIds];
    for (const tag of moving) {
      const id = answers[tag] as string;
      if (!ids.includes(id)) ids.push(id);
    }
    const left = tags.filter(tag => !moving.includes(tag));
    changed.push({ ...record, people: left.length > 0 ? left : undefined, memberIds: ids });
  }
  return changed;
}
