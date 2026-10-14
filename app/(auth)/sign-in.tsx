import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { resendConfirmation, signIn } from '@/lib/auth/api';
import { authRedirectUrl } from '@/lib/auth/redirect';
import { type FieldErrors, validateSignIn } from '@/lib/auth/validation';

type Message = { tone: 'error' | 'info'; text: string };

export default function SignInScreen() {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateSignIn({ email, password });
    setErrors(found);
    setMessage(null);
    setNeedsConfirmation(false);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await signIn(client, { email, password });
    setBusy(false);
    // On success the auth listener stores the session and the route guard opens the planner.
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message });
      setNeedsConfirmation(result.code === 'email_not_confirmed');
    }
  };

  const resend = async () => {
    setBusy(true);
    const result = await resendConfirmation(client, email, authRedirectUrl('auth-callback'));
    setBusy(false);
    setNeedsConfirmation(false);
    setMessage(result.ok ? { tone: 'info', text: 'We sent a new confirmation email.' } : { tone: 'error', text: result.message });
  };

  return (
    <AuthScreen>
      <Text style={authStyles.title}>Plan-Me</Text>
      <FormField label="Email" kind="email" value={email} onChangeText={setEmail} error={errors.email} />
      <FormField label="Password" kind="password" value={password} onChangeText={setPassword} error={errors.password} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {needsConfirmation ? <PrimaryButton title="Resend confirmation email" onPress={resend} busy={busy} /> : null}
      <PrimaryButton title="Sign in" onPress={submit} busy={busy} />
      <View style={authStyles.links}>
        <Link href="/forgot-password" style={authStyles.link}>
          Forgot your password?
        </Link>
        <Link href="/sign-up" style={authStyles.link}>
          Create an account
        </Link>
      </View>
    </AuthScreen>
  );
}
