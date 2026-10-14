import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { RepeatPreset, RepeatUnit } from '@/lib/events/repeat';

import { Chip } from './Chip';

const PRESETS: { value: RepeatPreset; label: string }[] = [
  { value: 'none', label: "Doesn't repeat" },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];
const UNITS: { value: RepeatUnit; label: string }[] = [
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
  { value: 'month', label: 'months' },
];

type Choice = { preset: RepeatPreset; every: string; unit: RepeatUnit };
type Props = Choice & { onChange: (next: Choice) => void; error?: string; lockedMessage: string | null };

export function RepeatPicker({ preset, every, unit, onChange, error, lockedMessage }: Props) {
  const locked = lockedMessage !== null;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Repeat</Text>
      <View style={styles.wrap}>
        {PRESETS.map(p => (
          <Chip key={p.value} label={p.label} selected={preset === p.value} disabled={locked} onPress={() => onChange({ preset: p.value, every, unit })} />
        ))}
      </View>
      {preset === 'custom' ? (
        <View style={styles.custom}>
          <Text style={styles.every}>Every</Text>
          <TextInput
            accessibilityLabel="Repeat every"
            value={every}
            onChangeText={text => onChange({ preset, every: text, unit })}
            keyboardType="number-pad"
            maxLength={2}
            editable={!locked}
            style={[styles.input, error ? styles.inputError : null]}
          />
          {UNITS.map(u => (
            <Chip key={u.value} label={u.label} selected={unit === u.value} disabled={locked} onPress={() => onChange({ preset, every, unit: u.value })} />
          ))}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {lockedMessage ? <Text style={styles.locked}>{lockedMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  custom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  every: { fontSize: 16, color: '#333', marginBottom: 8 },
  input: { width: 56, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 16, backgroundColor: '#fff', marginBottom: 8 },
  inputError: { borderColor: '#c62828' },
  error: { color: '#c62828', marginTop: 4 },
  locked: { color: '#666', marginTop: 4 },
});
