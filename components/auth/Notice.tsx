import React from 'react';
import { StyleSheet, Text } from 'react-native';

export function Notice({ tone, children }: { tone: 'error' | 'info'; children: string }) {
  return (
    <Text accessibilityRole={tone === 'error' ? 'alert' : 'text'} style={[styles.notice, tone === 'error' ? styles.error : styles.info]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  notice: { borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 12, overflow: 'hidden' },
  error: { backgroundColor: '#f8d7da', color: '#842029' },
  info: { backgroundColor: '#d1e7dd', color: '#0f5132' },
});
