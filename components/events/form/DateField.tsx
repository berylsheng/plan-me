import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Calendar } from 'react-native-calendars';

import { formatDateKey } from '@/lib/dates';

type Props = { label: string; value: string; onChange: (dateKey: string) => void; minDate?: string; maxDate?: string; error?: string; disabled?: boolean };

/** A date shown as dd/mm/yyyy; tapping it opens the month calendar. */
export function DateField({ label, value, onChange, minDate, maxDate, error, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.box, error ? styles.boxError : null, disabled ? styles.disabled : null]}
      >
        <Text style={value ? styles.value : styles.placeholder}>{value ? formatDateKey(value) : 'Choose a date'}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Calendar
              current={value || minDate}
              minDate={minDate}
              maxDate={maxDate}
              markedDates={value ? { [value]: { selected: true, selectedColor: '#007BFF' } } : undefined}
              onDayPress={day => {
                onChange(day.dateString);
                setOpen(false);
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  box: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff' },
  boxError: { borderColor: '#c62828' },
  disabled: { opacity: 0.5 },
  value: { fontSize: 16, color: '#333' },
  placeholder: { fontSize: 16, color: '#999' },
  error: { color: '#c62828', marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
});
