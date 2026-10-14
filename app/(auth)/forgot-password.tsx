import React, { useState } from 'react';
import { Text } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { requestPasswordReset } from '@/lib/auth/api';
import { authRedirectUrl } from '@/lib/auth/redirect';
import { type FieldErrors, normaliseEmail, validateEmailOnly } from '@/lib/auth/validation';

export default function ForgotPasswordScreen() {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateEmailOnly(email);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await requestPasswordReset(client, email, authRedirectUrl('reset-password'));
    setBusy(false);
    setMessage(
      result.ok
        ? { tone: 'info', text: `If ${normaliseEmail(email)} has an account, we've sent it a link to reset the password. Open it on this phone.` }
        : { tone: 'error', text: result.message },
    );
  };

  return (
    <AuthScreen>
      <Text style={authStyles.body}>{"Enter your email and we'll send you a link to choose a new password."}</Text>
      <FormField label="Email" kind="email" value={email} onChangeText={setEmail} error={errors.email} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <PrimaryButton title="Send reset link" onPress={submit} busy={busy} />
    </AuthScreen>
  );
}
