import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MemberAvatar } from '@/components/events/MemberAvatar';
import { memberLabel } from '@/lib/family/tags';
import type { Member } from '@/lib/family/types';

import { Chip } from './Chip';

type People = { memberIds: string[]; legacyTags: string[] };
type Props = People & { members: Member[]; memberById: ReadonlyMap<string, Member>; myId: string | null; onChange: (next: People) => void };

/** Who the event is for: family members to toggle, plus anyone on it the family list doesn't hold. */
export function PeoplePicker({ members, memberById, myId, memberIds, legacyTags, onChange }: Props) {
  // Former members (and members not loaded yet) stay on the event until you remove them.
  const others = memberIds.filter(id => !members.some(m => m.id === id));
  if (members.length === 0 && others.length === 0 && legacyTags.length === 0) return null;
  const toggle = (id: string) =>
    onChange({ memberIds: memberIds.includes(id) ? memberIds.filter(x => x !== id) : [...memberIds, id], legacyTags });
  return (
    <View style={styles.field}>
      <Text style={styles.label}>People</Text>
      <View style={styles.wrap}>
        {members.map(m => (
          <Chip key={m.id} role="checkbox" label={memberLabel(m, myId)} selected={memberIds.includes(m.id)} onPress={() => toggle(m.id)}>
            <MemberAvatar member={m} size={22} />
          </Chip>
        ))}
        {others.map(id => (
          <Chip key={id} role="checkbox" label={memberLabel(memberById.get(id), myId)} selected onPress={() => toggle(id)} />
        ))}
        {legacyTags.map(tag => (
          <Chip key={tag} role="checkbox" label={`@${tag}`} selected onPress={() => onChange({ memberIds, legacyTags: legacyTags.filter(t => t !== tag) })} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
