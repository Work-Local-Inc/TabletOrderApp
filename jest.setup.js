// Provide no-op globals used in useStore.ts and client.ts without explicit imports
global.addBreadcrumb = () => {};
global.captureException = () => {};

// Prevent Expo's winter runtime from throwing during/after tests.
// jest-expo installs lazy getters for several globals (structuredClone,
// __ExpoImportMetaRegistry, etc.) that try to require('expo/src/winter/runtime.native.ts').
// That require fails once Jest tears down its module registry.
// Lock these globals to stable, Node-native implementations before jest-expo's
// setup file can replace them.

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (v) => JSON.parse(JSON.stringify(v));
} else {
  // Ensure it stays as a data property, not a lazy getter
  const sc = global.structuredClone;
  Object.defineProperty(global, 'structuredClone', {
    value: sc,
    writable: true,
    configurable: true,
  });
}

Object.defineProperty(global, '__ExpoImportMetaRegistry', {
  value: {},
  writable: true,
  configurable: true,
});
