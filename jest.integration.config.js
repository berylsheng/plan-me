// Integration tests: real auth calls against the local Supabase stack (npm run db:start).
module.exports = {
  preset: 'jest-expo/node',
  testMatch: ['**/*.integration.test.ts'],
  globalSetup: '<rootDir>/jest.integration.setup.js',
  testTimeout: 30000,
  // realtime-js 2.117 leaves a 10 s timer after disconnect() (SocketAdapter.disconnect), which keeps
  // the worker alive after the last test. It is a test-only effect; the app's socket closes normally.
  forceExit: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // jest-expo/node does not set configFile on its babel-jest transform, so babel finds no config
  // and does not apply TypeScript support.  Supply the same configFile the iOS preset uses.
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      {
        caller: { name: 'metro', bundler: 'metro', platform: 'web', isServer: true },
        configFile: require.resolve('expo/internal/babel-preset.js'),
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
};
