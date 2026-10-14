import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useFamily } from '@/context/FamilyProvider';

export default function CreateFamilyScreen() {
  const { createFamily } = useFamily();
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await createFamily(name);
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
      <Text style={authStyles.body}>
        Everyone you invite can see and edit the events you share. Your personal events stay private.
      </Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <FormField label="Family name" value={name} onChangeText={setName} kind="plain" />
      <PrimaryButton title="Create family" onPress={submit} busy={busy} />
    </AuthScreen>
  );
}
