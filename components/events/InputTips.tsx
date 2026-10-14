import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { memberLabel } from '@/lib/family/tags';
import type { Member } from '@/lib/family/types';

const DATE_EXAMPLES: { text: string; note?: string }[] = [
  { text: '6 June, 6-8pm, dancing' },
  { text: 'tomorrow 9am dentist' },
  { text: 'next Friday 12pm lunch' },
  { text: '11-4 market', note: '11 am to 4 pm' },
];
const REPEATS = ['weekly for 4 weeks', 'daily for 2 weeks', 'fortnightly for 3 months', 'monthly for 6 months', 'every 2 weeks for 6 months'];

const combined = (tag: string | null) => (tag ? `swim Tue 7am @${tag}, weekly for 2 months` : 'swim Tue 7am, weekly for 2 months');

/** The sentence box's placeholder: a time, a tag and a repeat in one short line. */
export const placeholderFor = (tag: string | null): string =>
  tag ? `e.g. 6pm swim @${tag}, weekly for 4 weeks` : 'e.g. 6pm swim, weekly for 4 weeks';

/** The tag to use in examples: yours, else the first in the family. */
export const exampleTagOf = (members: Member[], myId: string | null): string | null => {
  const tagged = members.filter(m => m.tag);
  return tagged.find(m => m.id === myId)?.tag ?? tagged[0]?.tag ?? null;
};

/** Whole sentences the tips show, so tests can check the planner reads each one. */
export const tipExamples = (tag: string | null): string[] => [...DATE_EXAMPLES.map(e => e.text), combined(tag)];

type Props = { members: Member[]; myId: string | null; disabled?: boolean };

/** A "(?) Tips" button above the sentence box that explains what it understands. */
export function InputTips({ members, myId, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const tagged = members.filter(m => m.tag);
  const exampleTag = exampleTagOf(members, myId);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tips"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={styles.button}
      >
        <View style={styles.circle}>
          <Text style={styles.circleText}>?</Text>
        </View>
        <Text style={styles.buttonText}>Tips</Text>
      </Pressable>
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <ScrollView>
              <Text style={styles.title}>What you can type</Text>

              <Text style={styles.heading}>Dates and times</Text>
              {DATE_EXAMPLES.map(e => (
                <Text key={e.text} style={styles.line}>
                  <Text style={styles.example}>{e.text}</Text>
                  {e.note ? <Text>{` (${e.note})`}</Text> : null}
                </Text>
              ))}
              <Text style={styles.note}>With no date, the event goes on the day you&apos;ve selected.</Text>

              <Text style={styles.heading}>People</Text>
              {tagged.length > 0 ? (
                <>
                  <Text style={styles.note}>Add a family member with @ and their tag.</Text>
                  <Text style={styles.line}>{tagged.map(m => `@${m.tag} ${memberLabel(m, myId)}`).join(' · ')}</Text>
                </>
              ) : (
                <Text style={styles.note}>Join or create a family on the Family tab to tag people.</Text>
              )}

              <Text style={styles.heading}>Repeats</Text>
              {REPEATS.map(r => (
                <Text key={r} style={[styles.line, styles.example]}>{r}</Text>
              ))}
              <Text style={styles.note}>Repeats run for up to a year.</Text>

              <Text style={styles.heading}>All together</Text>
              <Text style={[styles.line, styles.example]}>{combined(exampleTag)}</Text>

              <Text style={styles.heading}>Changing an event</Text>
              <Text style={styles.note}>Tap Modify, then Edit, to open the event in a form.</Text>
            </ScrollView>
            <PrimaryButton title="Got it" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  circle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#007BFF', alignItems: 'center', justifyContent: 'center' },
  circleText: { color: '#007BFF', fontSize: 13, fontWeight: '700' },
  buttonText: { color: '#007BFF', fontSize: 14, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, maxHeight: '85%' },
  title: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 8 },
  heading: { fontSize: 15, fontWeight: '700', color: '#333', marginTop: 14, marginBottom: 4 },
  line: { fontSize: 15, color: '#333', marginBottom: 2 },
  example: { fontFamily: 'monospace', color: '#007BFF' },
  note: { fontSize: 14, color: '#666', marginTop: 2 },
});
