import React from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { BLUE } from '@/components/auth/styles';
import { TimeField } from '@/components/events/form/TimeField';
import { useMorningSummary } from '@/context/MorningSummaryProvider';

/** Settings section: turn the morning summary on or off and choose its time. */
export function MorningSummarySettings() {
  const { settings, permissionDenied, setEnabled, setTime } = useMorningSummary();
  if (!settings) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Morning summary</Text>
      <View style={styles.row}>
        <Text style={styles.text}>Show today&apos;s events each morning</Text>
        <Switch accessibilityLabel="Morning summary" value={settings.enabled} onValueChange={on => void setEnabled(on)} />
      </View>
      {settings.enabled ? (
        <TimeField label="Time" value={settings.time} clearable={false} onChange={time => (time ? void setTime(time) : undefined)} />
      ) : null}
      {permissionDenied ? (
        <View>
          <Text style={styles.note}>Notifications are off for Plan-Me. Turn them on in iOS Settings.</Text>
          <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} hitSlop={8}>
            <Text style={styles.link}>Open Settings</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
  text: { flex: 1, fontSize: 16, color: '#333' },
  note: { fontSize: 14, color: '#666', marginTop: 8 },
  link: { color: BLUE, fontSize: 16, fontWeight: '600', marginTop: 6 },
});
