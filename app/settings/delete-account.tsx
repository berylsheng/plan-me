import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { Notice } from '@/components/auth/Notice';
import { authStyles } from '@/components/auth/styles';
import { useEvents } from '@/context/EventsProvider';

export default function DeleteAccountScreen() {
  const { status, deleteAccountAndForget } = useEvents();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAccountAndForget();
      // On success the route guard takes over and shows sign-in.
      if (!result.ok) setError(result.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    const n = status.pending;
    const unsynced = n > 0 ? ` ${n} ${n === 1 ? "change hasn't" : "changes haven't"} synced yet and will be lost.` : '';
    Alert.alert('Delete your account?', `This can't be undone.${unsynced}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove() },
    ]);
  };

  return (
    <AuthScreen>
      <Text style={authStyles.body}>
        Your personal events and your photo are deleted, and you leave your family. Events you shared stay with your family and show as
        &quot;Former member&quot;. This can&apos;t be undone.
      </Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete my account"
        accessibilityState={{ disabled: busy || status.state === 'loading', busy }}
        disabled={busy || status.state === 'loading'}
        onPress={confirm}
        style={[styles.button, busy && styles.busy]}
      >
        <Text style={styles.text}>{busy ? 'Deleting…' : 'Delete my account'}</Text>
      </Pressable>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: '#dc3545', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  busy: { opacity: 0.7 },
  text: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
