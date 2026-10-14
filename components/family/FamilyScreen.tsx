import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { BLUE } from '@/components/auth/styles';
import { MemberAvatar } from '@/components/events/MemberAvatar';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { useFamily } from '@/context/FamilyProvider';
import { memberLabel } from '@/lib/family/tags';
import type { FamilyResult, Member } from '@/lib/family/types';
import { formatInviteCode } from '@/lib/family/validation';

export function FamilyScreen() {
  const { me, family, loading, offline } = useFamily();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Family</Text>
      {offline ? <Notice tone="info">You&apos;re offline, so this may be out of date.</Notice> : null}
      {me ? <ProfileForm me={me} /> : null}
      {loading ? (
        <ActivityIndicator color={BLUE} />
      ) : family ? (
        <FamilySection />
      ) : me === null && offline ? (
        <Notice tone="info">Connect to the internet to see your family.</Notice>
      ) : (
        <NoFamilySection />
      )}
    </ScrollView>
  );
}

function NoFamilySection() {
  const router = useRouter();
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Your family</Text>
      <Text style={styles.hint}>
        You&apos;re not in a family yet. Create one and invite others, or join with a code someone sent you.
      </Text>
      <PrimaryButton title="Create a family" onPress={() => router.push('/family/create')} />
      <PrimaryButton title="Join with a code" onPress={() => router.push('/family/join')} />
    </View>
  );
}

function FamilySection() {
  const { family, members, me, isOwner, regenerateInviteCode, removeMember, leaveFamily } = useFamily();
  const [error, setError] = useState<string | null>(null);
  if (!family) return null;

  const myId = me?.id ?? null;
  const code = formatInviteCode(family.inviteCode);
  const report = (result: FamilyResult<unknown>) => setError(result.ok ? null : result.message);

  const shareCode = () => {
    void Share.share({ message: `Join our family "${family.name}" on Plan-Me with the invite code ${code}.` });
  };

  const newCode = () =>
    Alert.alert('New invite code', 'The old code will stop working. Everyone already in the family stays in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'New code', onPress: () => void regenerateInviteCode().then(report) },
    ]);

  const remove = (member: Member) => {
    const name = memberLabel(member, null);
    Alert.alert(`Remove ${name}?`, "They'll stop seeing the family's shared events. Events they shared stay with the family.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeMember(member.id).then(report) },
    ]);
  };

  const leave = () => {
    const consequence =
      members.length <= 1
        ? "You're the only member, so the family will be deleted and your shared events become personal."
        : "You'll stop seeing the family's shared events. Events you shared stay with the family." +
          (isOwner ? ' The member who joined first becomes the owner.' : '');
    Alert.alert('Leave the family?', consequence, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => void leaveFamily().then(report) },
    ]);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{family.name}</Text>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Text style={styles.label}>Invite code</Text>
      <Text style={styles.code} accessibilityLabel={`Invite code ${code}`}>
        {code}
      </Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Share code" onPress={shareCode} hitSlop={8}>
          <Text style={styles.link}>Share code</Text>
        </Pressable>
        {isOwner ? (
          <Pressable accessibilityRole="button" accessibilityLabel="New code" onPress={newCode} hitSlop={8}>
            <Text style={styles.link}>New code</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.label}>Members</Text>
      {members.map(member => {
        const label = memberLabel(member, myId);
        return (
          <View key={member.id} style={styles.member}>
            <MemberAvatar member={member} />
            <View style={styles.memberText}>
              <Text style={styles.memberName}>
                {label}
                {member.id === family.ownerId ? ' (owner)' : ''}
              </Text>
              {member.tag && label !== `@${member.tag}` ? <Text style={styles.memberTag}>@{member.tag}</Text> : null}
            </View>
            {isOwner && member.id !== myId ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${memberLabel(member, null)}`} onPress={() => remove(member)} hitSlop={8}>
                <Text style={styles.danger}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Pressable accessibilityRole="button" accessibilityLabel="Leave family" onPress={leave} style={styles.leave}>
        <Text style={styles.danger}>Leave family</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f4' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: 'bold', color: BLUE, marginBottom: 16 },
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  hint: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '700', color: '#777', marginTop: 12, marginBottom: 6 },
  code: { fontSize: 24, fontWeight: 'bold', letterSpacing: 2, color: '#333' },
  row: { flexDirection: 'row', gap: 20, marginTop: 8 },
  link: { color: BLUE, fontSize: 15, fontWeight: '600' },
  member: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  memberText: { flex: 1, marginLeft: 10 },
  memberName: { fontSize: 15, color: '#333', fontWeight: '600' },
  memberTag: { fontSize: 13, color: '#777' },
  danger: { color: '#dc3545', fontSize: 15, fontWeight: '600' },
  leave: { marginTop: 20, alignItems: 'center' },
});
