import React, { useState } from 'react';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { useAuth } from '@/context/AuthProvider';
import { changePassword } from '@/lib/auth/api';
import { type FieldErrors, validateNewPassword } from '@/lib/auth/validation';

export default function ChangePasswordScreen() {
  const { client, user } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setMessage(null);
    const problems = validateNewPassword({ password, confirmPassword });
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    const result = await changePassword(client, user?.email ?? '', current, password);
    setBusy(false);
    if (result.ok) {
      setCurrent('');
      setPassword('');
      setConfirmPassword('');
      setMessage({ tone: 'info', text: 'Your password is changed.' });
    } else {
      setMessage({ tone: 'error', text: result.message });
    }
  };

  return (
    <AuthScreen>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <FormField label="Current password" value={current} onChangeText={setCurrent} kind="password" />
      <FormField label="New password" value={password} onChangeText={setPassword} kind="newPassword" error={errors.password} />
      <FormField label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} kind="newPassword" error={errors.confirmPassword} />
      <PrimaryButton title="Change password" onPress={submit} busy={busy} />
    </AuthScreen>
  );
}
