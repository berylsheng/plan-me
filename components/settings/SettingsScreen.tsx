import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/auth/Notice';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { BLUE } from '@/components/auth/styles';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { MorningSummarySettings } from '@/components/settings/MorningSummarySettings';
import { useAuth } from '@/context/AuthProvider';
import { useFamily } from '@/context/FamilyProvider';

export function SettingsScreen() {
  const { user } = useAuth();
  const { me, offline } = useFamily();
  const router = useRouter();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {offline ? <Notice tone="info">You&apos;re offline, so some changes will have to wait.</Notice> : null}
      {me ? <ProfileForm me={me} /> : null}
      <MorningSummarySettings />
      <View style={styles.section}>
        <Text style={styles.heading}>Account</Text>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user?.email ?? ''}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Change password" onPress={() => router.push('/settings/password')} style={styles.row}>
          <Text style={styles.link}>Change password</Text>
        </Pressable>
        <SignOutButton />
        <Pressable accessibilityRole="button" accessibilityLabel="Delete account" onPress={() => router.push('/settings/delete-account')} style={styles.row}>
          <Text style={styles.danger}>Delete account</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f4' },
  content: { padding: 20, paddingBottom: 40 },
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '700', color: '#777', marginTop: 4 },
  value: { fontSize: 16, color: '#333', marginBottom: 8 },
  row: { paddingVertical: 14 },
  link: { color: BLUE, fontSize: 16, fontWeight: '600' },
  danger: { color: '#dc3545', fontSize: 16, fontWeight: '600' },
});
