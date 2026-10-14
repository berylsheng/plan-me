import 'react-native-get-random-values';

import { uuidFromBytes } from './uuid';

/** A new event or series id. Hermes has no crypto.randomUUID; getRandomValues is polyfilled. Import from UI code only. */
export const newUuid = (): string => uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)));
