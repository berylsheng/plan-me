import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  shared: boolean;
  onChange: (shared: boolean) => void;
  disabled?: boolean;
  /** Without the heading and a little smaller, for the row above the sentence box. */
  compact?: boolean;
};

const CHOICES = [
  { shared: false, label: 'Only me', icon: '🔒' },
  { shared: true, label: 'Family', icon: '👪' },
] as const;

/** Who sees an event: only you (personal) or your whole family (shared). Both choices show, so it reads as a choice. */
export function ShareToggle({ shared, onChange, disabled = false, compact = false }: Props) {
  const control = (
    <View accessibilityRole="radiogroup" style={[styles.group, disabled && styles.disabled]}>
      {CHOICES.map((choice, i) => {
        const selected = choice.shared === shared;
        return (
          <Pressable
            key={choice.label}
            accessibilityRole="radio"
            accessibilityLabel={choice.label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => {
              if (!selected) onChange(choice.shared);
            }}
            hitSlop={4}
            style={[
              styles.option,
              compact ? styles.optionCompact : styles.optionWide,
              i === 0 ? styles.first : styles.last,
              selected && styles.selected,
            ]}
          >
            <Text style={styles.icon} importantForAccessibility="no" accessibilityElementsHidden>
              {choice.icon}
            </Text>
            <Text style={[styles.text, compact && styles.textCompact, selected && styles.selectedText]}>{choice.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  if (compact) return control;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Who can see this</Text>
      {control}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  group: { flexDirection: 'row', alignSelf: 'flex-start' },
  disabled: { opacity: 0.5 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#007BFF', backgroundColor: '#fff' },
  optionWide: { paddingHorizontal: 14, paddingVertical: 8 },
  optionCompact: { paddingHorizontal: 10, paddingVertical: 5, gap: 4 },
  first: { borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  last: { borderTopRightRadius: 16, borderBottomRightRadius: 16, borderLeftWidth: 0 },
  selected: { backgroundColor: '#007BFF' },
  icon: { fontSize: 15 },
  text: { fontSize: 14, fontWeight: '600', color: '#007BFF' },
  textCompact: { fontSize: 13 },
  selectedText: { color: '#fff' },
});
