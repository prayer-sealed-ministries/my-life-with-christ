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

describe('advanced search filters in the hash', () => {
  it('reads selected kinds alongside the query', () => {
    expect(parseHash('#/search?q=grace&kinds=prayer')).toEqual({
      name: 'search',
      query: 'grace',
      kinds: ['prayer'],
    });
    expect(parseHash('#/search?q=grace&kinds=sermon,reflection')).toEqual({
      name: 'search',
      query: 'grace',
      kinds: ['sermon', 'reflection'],
    });
  });

  it('leaves kinds off entirely when none are selected', () => {
    // Absent, not an empty array: `#/search?q=x` and `#/search?q=x&kinds=`
    // describe the same page and must parse to the same route.
    expect(parseHash('#/search?q=grace')).toEqual({ name: 'search', query: 'grace' });
    expect(parseHash('#/search?q=grace&kinds=')).toEqual({ name: 'search', query: 'grace' });
  });

  it('drops a kind this build does not have, rather than filtering to nothing', () => {
    // A hash is the one input a person can type. A filter for a kind no entry
    // can have is silently a filter for nothing, which on screen is
    // indistinguishable from "you have written none of those".
    expect(parseHash('#/search?q=grace&kinds=garbage')).toEqual({ name: 'search', query: 'grace' });
    expect(parseHash('#/search?q=grace&kinds=prayer,garbage')).toEqual({
      name: 'search',
      query: 'grace',
      kinds: ['prayer'],
    });
  });

  /** Narrowed, because `Route` is a union and only one arm carries kinds. */
  const kindsOf = (hash: string): string[] | undefined => {
    const route = parseHash(hash);
    return route.name === 'search' ? route.kinds : undefined;
  };

  it('normalises to canonical order, without duplicates', () => {
    // Two links selecting the same kinds have to be the same link, or Back
    // walks through pages that differ only in the order boxes were ticked.
    expect(kindsOf('#/search?q=g&kinds=reflection,sermon')).toEqual(['sermon', 'reflection']);
    expect(kindsOf('#/search?q=g&kinds=prayer,prayer')).toEqual(['prayer']);
  });

  it('round-trips every kind through the hash', () => {
    // The floor: a loop over an empty list proves nothing, and a kind that
    // cannot survive a link is a kind the reader cannot bookmark.
    expect(ENTRY_KINDS.length).toBe(6);
    for (const kind of ENTRY_KINDS) {
      const route: Route = { name: 'search', query: 'x', kinds: [kind] };
      expect(parseHash(href(route))).toEqual(route);
    }
    const every: Route = { name: 'search', query: 'x', kinds: [...ENTRY_KINDS] };
    expect(parseHash(href(every))).toEqual(every);
  });

  it('keeps the query when only the filters change, and the reverse', () => {
    const withBoth = href({ name: 'search', query: 'first baptist', kinds: ['prayer'] });
    expect(parseHash(withBoth)).toEqual({
      name: 'search',
      query: 'first baptist',
      kinds: ['prayer'],
    });
    // Clearing the filters must not touch the query.
    const cleared = parseHash(href({ name: 'search', query: 'first baptist' }));
    expect(cleared).toEqual({ name: 'search', query: 'first baptist' });
  });
});

describe('the passage-history route', () => {
  it('carries the reference as a person would write it', () => {
    expect(parseHash('#/history/John%2015')).toEqual({
      name: 'passageHistory',
      reference: 'John 15',
    });
    expect(parseHash('#/history/Jn%2015')).toEqual({ name: 'passageHistory', reference: 'Jn 15' });
    expect(parseHash('#/history/John%2015%3A5')).toEqual({
      name: 'passageHistory',
      reference: 'John 15:5',
    });
  });

  it('round-trips a reference through href and back', () => {
    for (const reference of ['John 15', 'John 15:5', 'John 15:1-8', '1 John 1:9', 'Song of Solomon 2']) {
      const route: Route = { name: 'passageHistory', reference };
      expect(parseHash(href(route)), reference).toEqual(route);
    }
  });

  it('does not collide with the Bible passage route', () => {
    // `#/passage/...` is the Scripture text; `#/history/...` is the journal.
    // One route parsing as the other would send a reader to the wrong page.
    expect(parseHash('#/passage/matthew/matthew-5-1-12').name).toBe('passage');
    expect(parseHash('#/history/Matthew%205').name).toBe('passageHistory');
  });

  it('treats a history URL with no reference as unknown, not as a blank passage', () => {
    expect(parseHash('#/history').name).toBe('notFound');
    expect(parseHash('#/history/').name).toBe('notFound');
  });

  it('does not itself judge whether the reference is real', () => {
    // Deliberate: parseHash runs in the main bundle and resolving a reference
    // needs versification and the book aliases. The view refuses what does not
    // resolve, exactly as the book and passage routes do with their ids.
    expect(parseHash('#/history/Nowhere%203')).toEqual({
      name: 'passageHistory',
      reference: 'Nowhere 3',
    });
  });
});
