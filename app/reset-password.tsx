import { Link, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { completeAuthRedirect, updatePassword } from '@/lib/auth/api';
import { parseAuthCallback } from '@/lib/auth/callback';
import { type FieldErrors, validateNewPassword } from '@/lib/auth/validation';

type Stage = { name: 'checking' } | { name: 'ready' } | { name: 'invalid'; message: string };

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams();
  const { client, session } = useAuth();
  const [stage, setStage] = useState<Stage>({ name: 'checking' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A link's code works once; StrictMode runs effects twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeAuthRedirect(client, parseAuthCallback(params)).then(result => {
      setStage(result.ok ? { name: 'ready' } : { name: 'invalid', message: result.message });
    });
  }, [client, params]);

  const save = async () => {
    const found = validateNewPassword({ password, confirmPassword });
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await updatePassword(client, password);
    setBusy(false);
    if (result.ok) router.replace('/');
    else setProblem(result.message);
  };

  if (stage.name === 'checking') {
    return (
      <AuthScreen>
        <ActivityIndicator accessibilityLabel="Checking your link" />
      </AuthScreen>
    );
  }

  if (stage.name === 'invalid') {
    return (
      <AuthScreen>
        <Notice tone="error">{stage.message}</Notice>
        <View style={authStyles.links}>
          {session ? (
            <Link href="/" replace style={authStyles.link}>
              Back to the planner
            </Link>
          ) : (
            <Link href="/forgot-password" replace style={authStyles.link}>
              Request a new link
            </Link>
          )}
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Text style={authStyles.body}>Choose a new password for your account.</Text>
      <FormField label="New password" kind="newPassword" value={password} onChangeText={setPassword} error={errors.password} />
      <FormField label="Confirm password" kind="newPassword" value={confirmPassword} onChangeText={setConfirmPassword} error={errors.confirmPassword} />
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <PrimaryButton title="Save password" onPress={save} busy={busy} />
    </AuthScreen>
  );
}
