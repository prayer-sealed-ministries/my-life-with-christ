import '@testing-library/jest-dom/vitest';
// Dexie needs a real IndexedDB; jsdom does not ship one. This is a faithful
// in-memory implementation, so storage tests exercise the actual Dexie paths
// rather than a hand-written stub.
import 'fake-indexeddb/auto';
