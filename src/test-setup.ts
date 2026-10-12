import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
// Dexie needs a real IndexedDB; jsdom does not ship one. This is a faithful
// in-memory implementation, so storage tests exercise the actual Dexie paths
// rather than a hand-written stub.
import 'fake-indexeddb/auto';

// Testing Library's one-second default assumes an idle machine. These tests
// intentionally wait on React effects plus real IndexedDB promises; under the
// same contention CI is meant to expose, correct work can land just after that
// arbitrary second. Keep the wait finite and below Vitest's enclosing limit.
configure({ asyncUtilTimeout: 15_000 });
