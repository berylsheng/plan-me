import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { useEvents } from '@/context/EventsProvider';

type ViewProps = { count: number; onAdd: () => Promise<void>; onKeepOff: () => Promise<void> };

export function LegacyImportPromptView({ count, onAdd, onKeepOff }: ViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const one = count === 1;
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError("Couldn't save your answer. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Events on this phone</Text>
          <Text style={styles.body}>
            {one ? 'There is 1 event' : `There are ${count} events`} saved on this phone from before accounts. Add {one ? 'it' : 'them'} to
            your account? Only you will see {one ? 'it' : 'them'}.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton title="Add to my account" onPress={() => void run(onAdd)} busy={busy} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={one ? 'Keep it off my account' : 'Keep them off my account'}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={() => void run(onKeepOff)}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>{one ? 'Keep it off my account' : 'Keep them off my account'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Shown once per account while there are pre-accounts events on the phone that nobody has claimed. */
export function LegacyImportPrompt() {
  const { legacy, claimLegacy, declineLegacy } = useEvents();
  if (!legacy) return null;
  return <LegacyImportPromptView count={legacy.count} onAdd={claimLegacy} onKeepOff={declineLegacy} />;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  title: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  body: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 8 },
  error: { color: '#c00', fontSize: 14, marginBottom: 8 },
  secondary: { paddingVertical: 14, alignItems: 'center' },
  secondaryText: { color: '#007BFF', fontSize: 15, fontWeight: '600' },
});
