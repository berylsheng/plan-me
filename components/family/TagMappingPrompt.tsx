import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { MemberAvatar } from '@/components/events/MemberAvatar';
import { useAuth } from '@/context/AuthProvider';
import { useEvents } from '@/context/EventsProvider';
import { useFamily } from '@/context/FamilyProvider';
import type { EventRecord } from '@/lib/events/rows';
import type { KeyValueStorage } from '@/lib/events/store';
import { nextTagToAsk, readTagAnswers, remapTags, saveTagAnswer, type TagAnswers } from '@/lib/family/tagMapping';
import { memberLabel } from '@/lib/family/tags';

/** Asks once per old tag (such as @AZ) which family member it means (spec §6.7). */
export function TagMappingPrompt({ storage = AsyncStorage }: { storage?: KeyValueStorage }) {
  const { user } = useAuth();
  const { records, updateEvent, legacy } = useEvents();
  const { family, members, me } = useFamily();
  const userId = user?.id ?? null;
  // Answers belong to one user.
  const [state, setState] = useState<{ userId: string; answers: TagAnswers } | null>(null);
  const answers = state && state.userId === userId ? state.answers : null;
  const sentRef = useRef(new Set<string>());

  useEffect(() => {
    setState(null);
    sentRef.current = new Set();
    if (!userId) return;
    let active = true;
    readTagAnswers(storage, userId).then(saved => {
      if (active) setState({ userId, answers: saved });
    });
    return () => {
      active = false;
    };
  }, [userId, storage]);

  const memberIds = useMemo(() => new Set(members.map(m => m.id)), [members]);

  // Only operate on events this user owns; other members' shared events keep their own tags.
  const myRecords = useMemo(
    () =>
      userId
        ? (Object.fromEntries(Object.entries(records).filter(([, r]) => r.ownerId === userId)) as Record<
            string,
            EventRecord
          >)
        : ({} as Record<string, EventRecord>),
    [records, userId],
  );

  // Move tags that have an answer, including on events that arrive later from other phones.
  useEffect(() => {
    if (!answers || !family) return;
    for (const event of remapTags(myRecords, answers, memberIds)) {
      // sentRef is in memory: a remap the server refuses isn't retried until the app restarts.
      const key = `${event.id}:${(myRecords[event.id]?.people ?? []).join(',')}`;
      if (sentRef.current.has(key)) continue;
      sentRef.current.add(key);
      updateEvent(event);
    }
  }, [answers, family, myRecords, memberIds, updateEvent]);

  // One question at a time, and not while the import question is showing.
  const tag = answers && family && legacy === null ? nextTagToAsk(myRecords, answers) : null;
  if (!tag || !userId) return null;

  const answer = async (memberId: string | null) => {
    try {
      const next = await saveTagAnswer(storage, userId, tag, memberId);
      setState({ userId, answers: next });
    } catch {
      // Storage failed: the question stays, so the user can try again.
    }
  };

  const myId = me?.id ?? null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Who is @{tag}?</Text>
          <Text style={styles.body}>
            Some of your events are tagged @{tag}. Pick the family member it means, and those events will show them.
          </Text>
          {members.map(member => (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={memberLabel(member, myId)}
              onPress={() => void answer(member.id)}
              style={styles.option}
            >
              <MemberAvatar member={member} />
              <Text style={styles.optionText}>{memberLabel(member, myId)}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="No one, keep it as text"
            onPress={() => void answer(null)}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>No one, keep it as text</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  body: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  optionText: { fontSize: 16, color: '#333', marginLeft: 10 },
  secondary: { marginTop: 12, alignItems: 'center' },
  secondaryText: { color: '#007BFF', fontSize: 15, fontWeight: '600' },
});
