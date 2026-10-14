// Pull in @testing-library/react-native's global Jest matcher augmentation
// (toBeDisabled, toBeEnabled, toBeVisible, etc.) so TypeScript knows about them.
// The runtime setup lives in jest.config's setupFilesAfterEnv.
import '@testing-library/react-native/extend-expect';
