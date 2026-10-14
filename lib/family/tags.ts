import type { EventInput, Visibility } from '@/lib/events/rows';
import type { LocalEvent } from '@/lib/events/types';
import { DEFAULT_TAGS } from '@/lib/parse/tags';

import type { Member } from './types';

/** Tags the planner recognises: the family's, plus the two used before families (kept until mapped). */
export function knownTagsFor(members: readonly Member[]): string[] {
  const tags = members.flatMap(m => (m.tag ? [m.tag] : []));
  return [...new Set([...tags, ...DEFAULT_TAGS])];
}

/** Split typed tags into family members and leftover tags (such as an unmapped @AZ). */
export function resolvePeople(
  tags: readonly string[],
  memberByTag: ReadonlyMap<string, Member>,
): { memberIds: string[]; legacy: string[] } {
  const memberIds: string[] = [];
  const legacy: string[] = [];
  for (const tag of tags) {
    const member = memberByTag.get(tag);
    if (member) {
      if (!memberIds.includes(member.id)) memberIds.push(member.id);
    } else if (!legacy.includes(tag)) {
      legacy.push(tag);
    }
  }
  return { memberIds, legacy };
}

/** A parsed event ready to save: tags become members where they can, the rest stay as tags. */
export function withPeople(event: LocalEvent, memberByTag: ReadonlyMap<string, Member>, visibility: Visibility): EventInput {
  const { memberIds, legacy } = resolvePeople(event.people ?? [], memberByTag);
  return { ...event, people: legacy.length > 0 ? legacy : undefined, memberIds, visibility };
}

/** How to name a member on screen. Profiles hold no email, so the fallbacks are the tag, then "Member". */
export function memberLabel(member: Member | undefined, myId: string | null): string {
  if (!member) return 'Former member';
  if (member.id === myId) return 'You';
  return member.displayName?.trim() || (member.tag ? `@${member.tag}` : 'Member');
}
