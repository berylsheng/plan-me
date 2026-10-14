// react-native-get-random-values does nothing under Jest; use Node's Web Crypto instead.
if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
  globalThis.crypto = require('node:crypto').webcrypto;
}

// The real module warns about Android push in Expo Go when it loads; tests use a fake notifier anyway.
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
