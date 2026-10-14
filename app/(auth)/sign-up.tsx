import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { signUp } from '@/lib/auth/api';
import { authRedirectUrl } from '@/lib/auth/redirect';
import { type FieldErrors, normaliseEmail, validateSignUp } from '@/lib/auth/validation';

export default function SignUpScreen() {
  const { client } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateSignUp({ displayName, email, password, confirmPassword });
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await signUp(client, { email, password, displayName }, authRedirectUrl('auth-callback'));
    setBusy(false);
    if (result.ok) setSentTo(normaliseEmail(email));
    else setProblem(result.message);
  };

  if (sentTo) {
    return (
      <AuthScreen>
        <Text style={authStyles.heading}>Check your email</Text>
        <Text style={authStyles.body}>We sent a link to {sentTo}. Open it on this phone to finish creating your account.</Text>
        <View style={authStyles.links}>
          <Link href="/sign-in" replace style={authStyles.link}>
            Back to sign in
          </Link>
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <FormField label="Your name (optional)" kind="name" value={displayName} onChangeText={setDisplayName} error={errors.displayName} />
      <FormField label="Email" kind="email" value={email} onChangeText={setEmail} error={errors.email} />
      <FormField label="Password" kind="newPassword" value={password} onChangeText={setPassword} error={errors.password} />
      <FormField label="Confirm password" kind="newPassword" value={confirmPassword} onChangeText={setConfirmPassword} error={errors.confirmPassword} />
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <PrimaryButton title="Create account" onPress={submit} busy={busy} />
      <View style={authStyles.links}>
        <Link href="/sign-in" replace style={authStyles.link}>
          I already have an account
        </Link>
      </View>
    </AuthScreen>
  );
}
