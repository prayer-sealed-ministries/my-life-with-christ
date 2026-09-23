/**
 * Which editor a route names, and when two routes mean the same writing.
 *
 * Small enough to read, and worth reading: focus mode's whole ownership rule
 * rests on it, and so does whether React remounts the editor.
 */

import { describe, expect, it } from 'vitest';

import { editorSessionKey, isSameEditorSession } from './editor-session';
import type { Route } from './router';

const newEntry = (over: Partial<Extract<Route, { name: 'newEntry' }>> = {}): Route => ({
  name: 'newEntry',
  ...over,
});

describe('naming an editor', () => {
  it('names a saved entry by its id', () => {
    expect(editorSessionKey({ name: 'entry', id: 'abc' })).toBe('entry:abc');
  });

  it('tells two new entries of different kinds apart', () => {
    expect(editorSessionKey(newEntry({ kind: 'sermon' }))).not.toBe(
      editorSessionKey(newEntry({ kind: 'prayer' })),
    );
  });

  it('tells a resumed draft apart from a blank page', () => {
    expect(editorSessionKey(newEntry({ draft: 'd1' }))).not.toBe(editorSessionKey(newEntry()));
  });

  it('names nothing outside an editor', () => {
    for (const route of [
      { name: 'home' },
      { name: 'timeline' },
      { name: 'search', query: 'vine' },
      { name: 'passageHistory', reference: 'John 15' },
    ] as Route[]) {
      expect(editorSessionKey(route), `${route.name} named an editor`).toBeNull();
    }
  });
});

describe('still the same writing?', () => {
  it('yes, when nothing moved', () => {
    const key = editorSessionKey(newEntry({ kind: 'sermon' }));
    expect(isSameEditorSession(key, key)).toBe(true);
  });

  it('yes, when a new entry acquires an id — that is a save, not a move', () => {
    // The one transition focus mode has to survive: it exists above the routed
    // view precisely because saving remounts the editor.
    expect(isSameEditorSession('new::sermon:', 'entry:xyz')).toBe(true);
  });

  it('no, between two different new captures', () => {
    expect(
      isSameEditorSession(
        editorSessionKey(newEntry({ kind: 'prayer' })),
        editorSessionKey(newEntry({ kind: 'sermon' })),
      ),
      'a prayer and a sermon are not the same writing',
    ).toBe(false);
  });

  it('no, between two different saved entries', () => {
    expect(isSameEditorSession('entry:a', 'entry:b')).toBe(false);
  });

  it('no, from a saved entry into a new capture', () => {
    // The leak this was written for: reading an entry in focus mode, then the
    // widget opening a brand new sermon.
    expect(isSameEditorSession('entry:a', 'new::sermon:')).toBe(false);
  });

  it('no, anywhere outside an editor', () => {
    expect(isSameEditorSession('entry:a', null)).toBe(false);
    expect(isSameEditorSession(null, 'entry:a')).toBe(false);
    expect(isSameEditorSession(null, null)).toBe(false);
  });
});
