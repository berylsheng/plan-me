import { usePreventRemove } from '@react-navigation/native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/auth/Notice';
import { EventForm } from '@/components/events/EventForm';
import { useAuth } from '@/context/AuthProvider';
import { useEvents } from '@/context/EventsProvider';
import { useFamily } from '@/context/FamilyProvider';
import {
  type EventForm as Form,
  type FormErrors,
  formFromRecord,
  needsScope,
  planFormSave,
  ruleChanged,
  sameForm,
  type SaveScope,
  seriesOf,
  validateForm,
} from '@/lib/events/editForm';
import { newUuid } from '@/lib/events/ids';
import type { EventRecord } from '@/lib/events/rows';
import { memberLabel } from '@/lib/family/tags';

/** The event and its series as they were when the form opened; saving plans against these. */
type Opened = { record: EventRecord; series: EventRecord[]; initial: Form };

function Panel({ title, actions }: { title: string; actions: { label: string; onPress: () => void; strong?: boolean }[] }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {actions.map(a => (
        <Pressable key={a.label} accessibilityRole="button" onPress={a.onPress} style={styles.panelButton}>
          <Text style={[styles.panelButtonText, a.strong && styles.strong]}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const open = (records: Record<string, EventRecord>, record: EventRecord): Opened => {
  const series = seriesOf(records, record);
  return { record, series, initial: formFromRecord(record, series) };
};

function Gone({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.gone}>
      <Text style={styles.goneText}>This event was deleted.</Text>
      <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8}>
        <Text style={styles.link}>Back</Text>
      </Pressable>
    </View>
  );
}

export function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { records, status, saveEventChanges } = useEvents();
  const { family, members, memberById } = useFamily();
  const myId = user?.id ?? null;
  const record = id ? records[id] : undefined;
  // Open straight away when the event is already loaded; the effect below covers one that arrives later.
  const [opened, setOpened] = useState<Opened | null>(() => (record ? open(records, record) : null));
  const [form, setForm] = useState<Form | null>(() => opened?.initial ?? null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [asking, setAsking] = useState<'scope' | 'discard' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useRef(false);
  // A save replaces events, so they can vanish while it's under way: that isn't someone deleting them.
  const saving = useRef(false);

  useEffect(() => {
    if (opened || !record) return;
    const next = open(records, record);
    setOpened(next);
    setForm(next.initial);
  }, [opened, record, records]);

  const dirty = opened !== null && form !== null && !sameForm(form, opened.initial);
  const navigation = useNavigation();
  // A swipe back or the Android back button asks first too; leaving on purpose goes straight through.
  usePreventRemove(dirty, ({ data }) => {
    if (left.current) navigation.dispatch(data.action);
    else setAsking('discard');
  });

  const leave = () => {
    left.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (left.current) return null;
  if (!opened || !form) {
    if (status.state === 'loading') {
      return (
        <View style={styles.gone}>
          <ActivityIndicator accessibilityLabel="Loading" color="#007BFF" />
        </View>
      );
    }
    if (!record) return <Gone onBack={leave} />;
    return null; // opening on the next render
  }
  if (!record && !saving.current) return <Gone onBack={leave} />;

  const { record: original, series, initial } = opened;
  const othersShared = original.visibility === 'shared' && (original.ownerId === null || original.ownerId !== myId);
  // Name the creator only once the family has loaded them; until then (or once they've left) say who in words.
  const owner = original.ownerId ? memberById.get(original.ownerId) : undefined;
  const repeatLockedMessage = !othersShared
    ? null
    : owner
      ? `Only ${memberLabel(owner, myId)} can change how this repeats.`
      : 'Only the person who made this event can change how this repeats.';

  const commit = async (scope: SaveScope) => {
    setAsking(null);
    setBusy(true);
    saving.current = true;
    let saved = false;
    try {
      saved = await saveEventChanges(planFormSave({ form, initial, record: original, series, scope, newId: newUuid }));
    } catch {
      saved = false;
    } finally {
      if (!saved) saving.current = false;
      setBusy(false);
    }
    if (saved) leave();
    else setMessage("Couldn't save. Try again.");
  };

  const save = () => {
    setMessage(null);
    const problems = validateForm(form, initial);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    if (needsScope(original, series, form, initial)) setAsking('scope');
    // No question needed: a new repeat replaces this and later ones; anything else is just this event.
    else void commit(ruleChanged(form, initial) ? 'future' : 'this');
  };

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" onPress={() => (dirty ? setAsking('discard') : leave())} hitSlop={8}>
          <Text style={styles.barButton}>Cancel</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>Edit event</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save"
          accessibilityState={{ disabled: !dirty || busy }}
          disabled={!dirty || busy}
          onPress={save}
          hitSlop={8}
        >
          <Text style={[styles.barButton, styles.strong, (!dirty || busy) && styles.off]}>Save</Text>
        </Pressable>
      </View>
      {message ? <Notice tone="error">{message}</Notice> : null}
      {asking === 'scope' ? (
        <Panel
          title="Change which events?"
          actions={[
            { label: 'This event only', onPress: () => void commit('this') },
            { label: 'This and all future', onPress: () => void commit('future'), strong: true },
            { label: 'Cancel', onPress: () => setAsking(null) },
          ]}
        />
      ) : null}
      {asking === 'discard' ? (
        <Panel
          title="Discard changes?"
          actions={[
            { label: 'Keep editing', onPress: () => setAsking(null), strong: true },
            { label: 'Discard', onPress: leave },
          ]}
        />
      ) : null}
      <EventForm
        form={form}
        errors={errors}
        onChange={setForm}
        members={members}
        memberById={memberById}
        myId={myId}
        showShare={family !== null}
        shareLocked={othersShared}
        repeatLockedMessage={repeatLockedMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f4' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16, backgroundColor: '#007BFF' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  barButton: { color: '#fff', fontSize: 16 },
  strong: { fontWeight: '700' },
  off: { opacity: 0.5 },
  panel: { margin: 16, padding: 16, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  panelTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 8 },
  panelButton: { paddingVertical: 10 },
  panelButtonText: { fontSize: 16, color: '#007BFF' },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#f4f4f4' },
  goneText: { fontSize: 16, color: '#333' },
  link: { color: '#007BFF', fontSize: 16, fontWeight: '600' },
});
