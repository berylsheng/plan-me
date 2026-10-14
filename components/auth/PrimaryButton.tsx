import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { BLUE } from './styles';

type Props = { title: string; onPress: () => void; busy?: boolean };

export function PrimaryButton({ title, onPress, busy = false }: Props) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={[styles.button, busy ? styles.busy : null]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.text}>{title}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: BLUE, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  busy: { opacity: 0.7 },
  text: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
