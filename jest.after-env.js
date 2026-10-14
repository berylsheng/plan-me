// Unit tests run without native modules: use the official in-memory AsyncStorage,
// and Node's Web Crypto (jest.setup.js) instead of the random-values polyfill.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-get-random-values', () => ({}));
