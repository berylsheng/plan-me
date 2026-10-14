import { StyleSheet } from 'react-native';

export const BLUE = '#007BFF';

export const authStyles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: 'bold', color: BLUE, textAlign: 'center', marginBottom: 24 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  body: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 16 },
  links: { marginTop: 20, gap: 14, alignItems: 'center' },
  link: { color: BLUE, fontSize: 15, fontWeight: '600' },
});
