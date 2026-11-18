/* eslint-env jest */

// react-native-safe-area-context reads insets from native code, which does
// not exist under Jest. The library ships this mock for exactly that purpose;
// without it SafeAreaProvider never renders its children in tests.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
