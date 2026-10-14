import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatClock, formatTime } from '@/lib/dates';

type Props = { label: string; value: string; onChange: (time: string) => void; error?: string; clearable?: boolean };

const asDate = (time: string): Date => {
  const [h, m] = (time || '09:00').split(':').map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date;
};

/** An optional time shown as "6:30 pm", picked with the phone's own time picker. */
export function TimeField({ label, value, onChange, error, clearable = true }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={[styles.box, error ? styles.boxError : null]}>
          <Text style={value ? styles.value : styles.placeholder}>{value ? formatClock(value) : 'None'}</Text>
        </Pressable>
        {clearable && value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label.toLowerCase()}`} onPress={() => onChange('')} hitSlop={8}>
            <Text style={styles.link}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {open ? (
        <View>
          <DateTimePicker
            mode="time"
            value={asDate(value)}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, date) => {
              // Android shows a dialog that closes itself; iOS shows a wheel until Done.
              if (Platform.OS !== 'ios') setOpen(false);
              if (event.type === 'set' && date) onChange(formatTime(date));
            }}
          />
          {Platform.OS === 'ios' ? (
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.done}>
              <Text style={styles.link}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff' },
  boxError: { borderColor: '#c62828' },
  value: { fontSize: 16, color: '#333' },
  placeholder: { fontSize: 16, color: '#999' },
  link: { color: '#007BFF', fontSize: 16, fontWeight: '600' },
  done: { alignSelf: 'flex-end', padding: 8 },
  error: { color: '#c62828', marginTop: 4 },
});
