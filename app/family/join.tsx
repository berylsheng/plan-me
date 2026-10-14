import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useFamily } from '@/context/FamilyProvider';

export default function JoinFamilyScreen() {
  const { joinFamily } = useFamily();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await joinFamily(code);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/family');
  };

  return (
    <AuthScreen>
      <Text style={authStyles.body}>Ask a family member for the 8-character code on their Family tab.</Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <FormField label="Invite code" value={code} onChangeText={setCode} kind="code" />
      <PrimaryButton title="Join family" onPress={submit} busy={busy} />
    </AuthScreen>
  );
}
