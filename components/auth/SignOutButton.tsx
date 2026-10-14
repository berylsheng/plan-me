import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { useEvents } from '@/context/EventsProvider';

export function SignOutButton() {
  const { status, signOutAndForget } = useEvents();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    const result = await signOutAndForget();
    setBusy(false);
    // On success the route guard takes over and shows sign-in.
    if (!result.ok) Alert.alert("Couldn't sign out", result.message);
  };

  const onPress = () => {
    const n = status.pending;
    if (n === 0) {
      void signOut();
      return;
    }
    Alert.alert(
      'Sign out?',
      `${n} ${n === 1 ? "change hasn't" : "changes haven't"} synced yet. Signing out deletes ${n === 1 ? 'it' : 'them'} from this phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  };

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={onPress} disabled={busy || status.state === 'loading'} hitSlop={8} style={styles.button}>
      <Text style={styles.text}>Sign out</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingVertical: 14 },
  text: { color: '#dc3545', fontSize: 16, fontWeight: '600' },
});
