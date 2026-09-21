import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { outlineBooksById, segmentsForBook, topics, versification } from '../app/data';
import { RouterProvider, parseHash } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { formatRef, resolveTopicEntries } from '../lib/passages';
import { BOOK_NAMES } from '../lib/canon';
import { DexieStorageProvider } from '../storage/db';
import type { Entry, ScriptureRef } from '../types';
import EntryEditor from './EntryEditor';
import TopicView from './TopicView';

const topic = topics[0];

const label = (ref: ScriptureRef) =>
  formatRef(ref, BOOK_NAMES[ref.book] ?? ref.book, versification[ref.book]);

let dbCount = 0;

/** A fresh IndexedDB per test, so entries written by one cannot leak into another. */
function freshStorage() {
  return new DexieStorageProvider(`topic-view-test-${dbCount++}`);
}

function renderTopic(topicId: string, storage = freshStorage()) {
  return render(
    <StorageContextProvider provider={storage}>
      <TopicView topicId={topicId} />
    </StorageContextProvider>,
  );
}

// Vitest runs without global expose, so RTL cannot register its own cleanup.
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('TopicView', () => {
  it('leads with the topic name and what a person comes here looking for', () => {
    renderTopic(topic.id);

    expect(screen.getByRole('heading', { level: 1, name: topic.name })).toBeInTheDocument();
    expect(screen.getByText(topic.description)).toBeInTheDocument();
  });

  it('lists every curated scripture ref with its note', () => {
    renderTopic(topic.id);

    for (const ref of topic.refs) {
      expect(screen.getAllByText(label(ref)).length).toBeGreaterThan(0);
    }
    // The notes are the topic's own editorial voice — losing them would strip
    // the page back to a bare reference list.
    for (const ref of topic.refs) {
      const note = (ref as ScriptureRef & { note?: string }).note;
      if (note) expect(screen.getByText(note)).toBeInTheDocument();
    }
  });

  it('links each ref to the segment that contains it, not to an outline id', () => {
    renderTopic(topic.id);

    for (const ref of topic.refs) {
      const segment = segmentsForBook(ref.book).find(
        (candidate) =>
          (candidate.chapterStart < ref.chapterStart ||
            (candidate.chapterStart === ref.chapterStart &&
              candidate.verseStart <= ref.verseStart)) &&
          (ref.chapterStart < candidate.chapterEnd ||
            (ref.chapterStart === candidate.chapterEnd && ref.verseStart <= candidate.verseEnd)),
      );
      expect(segment).toBeDefined();

      const href = `#/passage/${ref.book}/${encodeURIComponent(segment?.id ?? '')}`;
      const links = screen.getAllByRole('link', { name: label(ref) });
      expect(links.some((link) => link.getAttribute('href') === href)).toBe(true);
    }
  });

  it('shows the outline entries only as an enhancement over the refs', () => {
    renderTopic(topic.id);

    // Under `refs-only` the outline layer resolves to nothing and the section is
    // simply absent; the passage list above is unchanged either way.
    const resolved = resolveTopicEntries(topic, outlineBooksById, versification);
    const section = screen.queryByRole('heading', { level: 2, name: 'Also in the outline' });

    if (resolved.length === 0) {
      expect(section).not.toBeInTheDocument();
    } else {
      expect(section).toBeInTheDocument();
    }
    // Either way the primary content stands on its own.
    expect(screen.getByRole('heading', { level: 2, name: 'Passages' })).toBeInTheDocument();
    expect(screen.getAllByText(label(topic.refs[0])).length).toBeGreaterThan(0);
  });

  it('lists the journal entries anchored to this topic, and no others', async () => {
    const storage = freshStorage();
    await storage.open();
    await storage.createEntry({
      title: 'A hard season',
      kind: 'reflection',
      date: '2026-02-01',
      anchors: [{ kind: 'topic', topicId: topic.id }],
    });
    await storage.createEntry({
      title: 'Something else entirely',
      kind: 'sermon',
      date: '2026-02-08',
      anchors: [{ kind: 'topic', topicId: 'not-this-topic' }],
    });
    // An entry filed under nothing at all must not drift into a topic it was
    // never attached to.
    await storage.createEntry({
      title: 'Anchored to nothing',
      kind: 'prayer',
      date: '2026-02-15',
      anchors: [],
    });

    renderTopic(topic.id, storage);

    // Loading is announced rather than silent.
    expect(screen.getByRole('status')).toHaveTextContent('Loading your entries');

    expect(await screen.findByText('A hard season')).toBeInTheDocument();
    expect(screen.queryByText('Something else entirely')).not.toBeInTheDocument();
    expect(screen.queryByText('Anchored to nothing')).not.toBeInTheDocument();
    // The kind is carried in words, not by the badge's colour alone.
    expect(screen.getByText('Reflection')).toBeInTheDocument();
  });

  it('invites a first entry when nothing has been written yet', async () => {
    renderTopic(topic.id);

    expect(
      await screen.findByText(`Nothing written under ${topic.name} yet`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: `Write about ${topic.name}` }),
    ).toHaveAttribute('href', `#/entry/new?anchor=${encodeURIComponent(`topic:${topic.id}`)}`);
  });

  it('files an entry started from that invitation under this topic', async () => {
    const storage = freshStorage();
    await storage.open();

    const invitation = renderTopic(topic.id, storage);
    const cta = await screen.findByRole('link', { name: `Write about ${topic.name}` });
    const route = parseHash(cta.getAttribute('href') ?? '');
    invitation.unmount();

    if (route.name !== 'newEntry') throw new Error(`expected newEntry, got ${route.name}`);

    // The editor has to understand what this view wrote into the URL. An anchor
    // form it cannot parse is dropped in silence: the entry saves, and nothing
    // ever files it under the topic the reader clicked from.
    window.location.hash = '#/entry/new';
    const editor = render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor anchorParam={route.anchor} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    expect(await screen.findByText(`Topic: ${topic.name}`)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Written from a topic' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'What was said.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    let saved: Entry[] = [];
    await waitFor(async () => {
      saved = await storage.findEntriesForExactAnchor({ kind: 'topic', topicId: topic.id });
      expect(saved).toHaveLength(1);
    });
    // A topic anchor, stored whole — not a bare id the topic page cannot query.
    expect(saved[0].anchors).toEqual([{ kind: 'topic', topicId: topic.id }]);
    editor.unmount();

    // Which is the entire point of the link: it comes back here.
    renderTopic(topic.id, storage);
    expect(await screen.findByText('Written from a topic')).toBeInTheDocument();
  });

  it('says so plainly for an unknown topic id, with a way back', () => {
    renderTopic('no-such-topic');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Topic not found' }),
    ).toBeInTheDocument();
    expect(screen.getByText('no-such-topic')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all topics' })).toHaveAttribute(
      'href',
      '#/topics',
    );
  });

  it('keeps heading levels in order under the shell', async () => {
    renderTopic(topic.id);
    await screen.findByText(`Nothing written under ${topic.name} yet`);

    const levels = screen.getAllByRole('heading').map((node) => Number(node.tagName.slice(1)));

    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    expect(Math.max(...levels)).toBe(2);
  });
});
