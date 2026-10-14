import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useEvents } from '@/context/EventsProvider';
import type { SyncStatus } from '@/lib/events/syncEngine';

const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;

/** One line about sync, or nothing when everything is up to date. */
export function syncMessage(status: SyncStatus): string | null {
  if (status.state === 'offline' || status.state === 'needs-sign-in') {
    return status.pending > 0
      ? `Offline. ${changes(status.pending)} will sync when you're back online.`
      : "Offline. Showing what's saved on this phone.";
  }
  if (status.state !== 'loading' && status.pending > 0) return `Syncing ${changes(status.pending)}…`;
  return null;
}

export function SyncBadge() {
  const { status } = useEvents();
  const message = syncMessage(status);
  if (!message) return null;
  return <Text style={styles.badge}>{message}</Text>;
}

const styles = StyleSheet.create({
  badge: { backgroundColor: '#fff3cd', color: '#856404', fontSize: 13, textAlign: 'center', paddingVertical: 6, paddingHorizontal: 12 },
});

/** Shown when the server refused a change (for example, sharing after leaving the family). */
export function RefusedNoticeView({ refused }: { refused: number }) {
  const [seen, setSeen] = useState(0);
  // A new engine (another user, or a restart) counts from zero again.
  useEffect(() => {
    if (refused < seen) setSeen(refused);
  }, [refused, seen]);
  if (refused <= seen) return null;
  return (
    <View accessibilityRole="alert" style={noticeStyles.notice}>
      <Text style={noticeStyles.text}>A change couldn&apos;t be saved, so the event shows its last saved version.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="OK" onPress={() => setSeen(refused)} hitSlop={8}>
        <Text style={noticeStyles.ok}>OK</Text>
      </Pressable>
    </View>
  );
}

export function RefusedNotice() {
  const { status } = useEvents();
  return <RefusedNoticeView refused={status.refused ?? 0} />;
}

const noticeStyles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 8, backgroundColor: '#f8d7da' },
  text: { flex: 1, fontSize: 13, color: '#842029' },
  ok: { fontSize: 13, fontWeight: 'bold', color: '#842029' },
});
