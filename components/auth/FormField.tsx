import React from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

type Kind = 'email' | 'password' | 'newPassword' | 'name' | 'plain' | 'code' | 'tag';

const KIND_PROPS: Record<Kind, TextInputProps> = {
  email: { autoCapitalize: 'none', autoCorrect: false, autoComplete: 'email', keyboardType: 'email-address', textContentType: 'emailAddress' },
  password: { secureTextEntry: true, autoCapitalize: 'none', autoComplete: 'current-password', textContentType: 'password' },
  newPassword: { secureTextEntry: true, autoCapitalize: 'none', autoComplete: 'new-password', textContentType: 'newPassword' },
  name: { autoCapitalize: 'words', autoComplete: 'name', textContentType: 'name' },
  plain: { autoCapitalize: 'sentences' },
  code: { autoCapitalize: 'characters', autoCorrect: false, autoComplete: 'off' },
  tag: { autoCapitalize: 'characters', autoCorrect: false, autoComplete: 'off', maxLength: 5 },
};

type Props = { label: string; value: string; onChangeText: (text: string) => void; error?: string; kind: Kind };

export function FormField({ label, value, onChangeText, error, kind }: Props) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        style={[styles.input, error ? styles.inputError : null]}
        {...KIND_PROPS[kind]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff' },
  inputError: { borderColor: '#dc3545' },
  error: { color: '#dc3545', fontSize: 13, marginTop: 4 },
});
