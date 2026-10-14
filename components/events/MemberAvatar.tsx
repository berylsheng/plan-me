import { Image } from 'expo-image';
import React, { useContext } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FamilyContext } from '@/context/FamilyProvider';
import type { Member } from '@/lib/family/types';

const COLOURS = ['#6f42c1', '#d63384', '#fd7e14', '#20c997', '#0d6efd', '#198754'];

/** The same colour for a member on every phone. */
export function avatarColour(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[hash % COLOURS.length];
}

export function avatarText(member: Member): string {
  if (member.tag) return member.tag;
  const name = member.displayName?.trim();
  return name ? Array.from(name)[0].toUpperCase() : '?';
}

/** A member's photo when the family has a URL for it, otherwise a coloured circle with their tag. */
export function MemberAvatar({ member, faded = false, size = 30 }: { member: Member; faded?: boolean; size?: number }) {
  // Optional: screens outside FamilyProvider (and some tests) just get the circle.
  const family = useContext(FamilyContext);
  const uri = family?.avatarUrl(member) ?? null;
  const label = member.displayName?.trim() || (member.tag ? `@${member.tag}` : 'Member');
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <Image
        accessibilityLabel={label}
        // Cache by storage path: the signed URL changes every hour, the photo doesn't.
        source={{ uri, cacheKey: member.avatarPath ?? undefined }}
        contentFit="cover"
        style={[styles.circle, box, faded && styles.faded]}
      />
    );
  }
  return (
    <View accessibilityLabel={label} style={[styles.circle, box, { backgroundColor: avatarColour(member.id) }, faded && styles.faded]}>
      <Text style={[styles.text, { fontSize: Math.round(size / 3) }]}>{avatarText(member)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { marginLeft: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  faded: { opacity: 0.4 },
  text: { color: '#fff', fontWeight: 'bold' },
});
