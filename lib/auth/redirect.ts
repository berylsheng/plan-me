import * as Linking from 'expo-linking';

/** Where email links send people back: planme://… in builds, exp://…/--/… in Expo Go. */
export const authRedirectUrl = (path: 'auth-callback' | 'reset-password'): string => Linking.createURL(path);
