import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { BLUE } from '@/components/auth/styles';
import { MemberAvatar } from '@/components/events/MemberAvatar';
import { useFamily } from '@/context/FamilyProvider';
import type { FamilyResult, Member } from '@/lib/family/types';
import { pickAvatar } from '@/lib/profile/pickAvatar';

type Message = { tone: 'error' | 'info'; text: string } | null;

const PICK_FAILED = "Couldn't use that photo. Try another one.";

/** Your name, tag and photo. Used on the Family tab and in Settings. */
export function ProfileForm({ me }: { me: Member }) {
  const { updateProfile, setAvatar, removeAvatar } = useFamily();
  const [name, setName] = useState(me.displayName ?? '');
  const [tag, setTag] = useState(me.tag ?? '');
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  // When the server's version arrives (or changes), show it.
  useEffect(() => {
    setName(me.displayName ?? '');
    setTag(me.tag ?? '');
  }, [me.displayName, me.tag]);

  const report = (result: FamilyResult, done: string) =>
    setMessage(result.ok ? { tone: 'info', text: done } : { tone: 'error', text: result.message });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const result = await updateProfile({ displayName: name, tag });
    setBusy(false);
    report(result, 'Saved.');
  };

  const choosePhoto = async () => {
    setMessage(null);
    const picked = await pickAvatar();
    if (!picked.ok) {
      if (picked.reason === 'failed') setMessage({ tone: 'error', text: PICK_FAILED });
      return;
    }
    setPhotoBusy(true);
    const result = await setAvatar(picked.base64);
    setPhotoBusy(false);
    report(result, 'Photo saved.');
  };

  const clearPhoto = async () => {
    setMessage(null);
    setPhotoBusy(true);
    const result = await removeAvatar();
    setPhotoBusy(false);
    report(result, 'Photo removed.');
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>You</Text>
      <Text style={styles.hint}>Your tag lets family members add you to an event by typing @ and the tag, like @AZ.</Text>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <View style={styles.photoRow}>
        <MemberAvatar member={me} size={64} />
        <View style={styles.photoActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose photo" disabled={photoBusy} onPress={() => void choosePhoto()} hitSlop={8}>
            <Text style={styles.link}>Choose photo</Text>
          </Pressable>
          {me.avatarPath ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" disabled={photoBusy} onPress={() => void clearPhoto()} hitSlop={8}>
              <Text style={styles.danger}>Remove photo</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <FormField label="Your name" value={name} onChangeText={setName} kind="name" />
      <FormField label="Your tag" value={tag} onChangeText={setTag} kind="tag" />
      <PrimaryButton title="Save" onPress={save} busy={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  hint: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 12 },
  photoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  photoActions: { marginLeft: 16, gap: 10 },
  link: { color: BLUE, fontSize: 15, fontWeight: '600' },
  danger: { color: '#dc3545', fontSize: 15, fontWeight: '600' },
});
