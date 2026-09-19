import { describe, expect, it } from 'vitest';

import { ENTRY_KINDS } from '../lib/entry-kinds';
import { href, parseHash, type Route } from './router';

describe('parseHash', () => {
  it('reads the empty hash as home', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
  });

  it('reads each static route', () => {
    expect(parseHash('#/browse')).toEqual({ name: 'browse' });
    expect(parseHash('#/topics')).toEqual({ name: 'topics' });
    expect(parseHash('#/timeline')).toEqual({ name: 'timeline' });
    expect(parseHash('#/data')).toEqual({ name: 'data' });
    expect(parseHash('#/legacy')).toEqual({ name: 'legacy' });
  });

  it('reads parameterised routes', () => {
    expect(parseHash('#/book/genesis')).toEqual({ name: 'book', bookId: 'genesis' });
    expect(parseHash('#/passage/genesis/genesis-35-1-15')).toEqual({
      name: 'passage',
      bookId: 'genesis',
      segmentId: 'genesis-35-1-15',
    });
    expect(parseHash('#/topic/grief')).toEqual({ name: 'topic', topicId: 'grief' });
    expect(parseHash('#/entry/abc-123')).toEqual({ name: 'entry', id: 'abc-123' });
  });

  it('distinguishes a new entry from an entry id', () => {
    expect(parseHash('#/entry/new')).toEqual({ name: 'newEntry' });
    expect(parseHash('#/entry/new?anchor=matthew-5-1-12')).toEqual({
      name: 'newEntry',
      anchor: 'matthew-5-1-12',
    });
  });

  it('reads a requested entry kind, and only a real one', () => {
    // Every kind the model has, not the two Home happens to link to. A route
    // that can express four of six is a route that will quietly stop matching
    // the editor's dropdown.
    for (const kind of ENTRY_KINDS) {
      expect(parseHash(`#/entry/new?kind=${kind}`), kind).toEqual({ name: 'newEntry', kind });
    }

    // A hash is the one input a reader can type, so nonsense has to land on
    // the ordinary blank entry rather than on a kind that does not exist.
    for (const bad of ['garbage', '', 'SERMON', 'prayer ', '__proto__', 'sermon,prayer']) {
      expect(parseHash(`#/entry/new?kind=${encodeURIComponent(bad)}`), bad).toEqual({
        name: 'newEntry',
      });
    }

    // And it composes with the anchor parameter that was already there.
    expect(parseHash('#/entry/new?anchor=matthew-5-1-12&kind=reflection')).toEqual({
      name: 'newEntry',
      anchor: 'matthew-5-1-12',
      kind: 'reflection',
    });
  });

  it('never reads a kind for an entry that already exists', () => {
    // The editor is the same component for both, so the route is where this
    // has to be settled: a saved entry's kind is a fact about the entry.
    expect(parseHash('#/entry/abc-123?kind=prayer')).toEqual({ name: 'entry', id: 'abc-123' });
  });

  it('reads a search query', () => {
    expect(parseHash('#/search?q=whitfield')).toEqual({ name: 'search', query: 'whitfield' });
    expect(parseHash('#/search')).toEqual({ name: 'search', query: '' });
  });

  it('decodes percent-encoded segments', () => {
    expect(parseHash('#/topic/end-times')).toEqual({ name: 'topic', topicId: 'end-times' });
    expect(parseHash('#/search?q=first%20baptist')).toEqual({ name: 'search', query: 'first baptist' });
  });

  it('falls back rather than throwing on a malformed route', () => {
    expect(parseHash('#/book')).toEqual({ name: 'browse' });
    expect(parseHash('#/passage/genesis')).toEqual({ name: 'browse' });
    expect(parseHash('#/topic')).toEqual({ name: 'topics' });
    expect(parseHash('#/nonsense')).toEqual({ name: 'notFound', path: 'nonsense' });
  });
});

describe('href round-trips parseHash', () => {
  const routes: Route[] = [
    { name: 'home' },
    { name: 'browse' },
    { name: 'book', bookId: 'song-of-solomon' },
    { name: 'passage', bookId: 'acts', segmentId: 'acts-6-8-7-7' },
    { name: 'topics' },
    { name: 'topic', topicId: 'end-times' },
    { name: 'timeline' },
    { name: 'search', query: 'first baptist' },
    { name: 'entry', id: 'abc-123' },
    { name: 'newEntry' },
    { name: 'newEntry', anchor: 'matthew-5-1-12' },
    ...ENTRY_KINDS.map((kind): Route => ({ name: 'newEntry', kind })),
    { name: 'newEntry', anchor: 'matthew-5-1-12', kind: 'prayer' },
    { name: 'data' },
    { name: 'legacy' },
  ];

  it('parses back to the route it was built from', () => {
    for (const route of routes) {
      expect(parseHash(href(route)), href(route)).toEqual(route);
    }
  });
});
