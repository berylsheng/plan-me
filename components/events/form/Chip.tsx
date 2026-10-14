import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

type Props = { label: string; selected: boolean; onPress: () => void; role?: 'radio' | 'checkbox'; disabled?: boolean; children?: React.ReactNode };

/** A pill that is on or off: one choice of several (radio) or one of many (checkbox). */
export function Chip({ label, selected, onPress, role = 'radio', disabled = false, children }: Props) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected, disabled && styles.disabled]}
    >
      {children}
      <Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
  selected: { backgroundColor: '#007BFF', borderColor: '#007BFF' },
  disabled: { opacity: 0.5 },
  text: { fontSize: 14, color: '#333' },
  selectedText: { color: '#fff', fontWeight: '600' },
});
