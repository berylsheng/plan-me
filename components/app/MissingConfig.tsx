import { SplashScreen } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Shown instead of the app when a build was made without its Supabase settings (a release mistake, not a user one). */
export function MissingConfig({ missing }: { missing: string[] }) {
  // The splash screen normally waits for sign-in, which never starts here.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Plan-Me can&apos;t start</Text>
      <Text style={styles.body}>This build is missing its server settings.</Text>
      {missing.map(name => (
        <Text key={name} style={styles.name}>
          {name}
        </Text>
      ))}
      <Text style={styles.hint}>Set them for this EAS environment (eas env:create) and build again.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f4f4f4' },
  title: { fontSize: 22, fontWeight: '700', color: '#333', marginBottom: 12 },
  body: { fontSize: 16, color: '#333', marginBottom: 8 },
  name: { fontFamily: 'monospace', fontSize: 14, color: '#c62828' },
  hint: { fontSize: 14, color: '#666', marginTop: 12 },
});
