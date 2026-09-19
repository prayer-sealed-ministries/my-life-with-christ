import { describe, expect, it } from 'vitest';

import { buildContext } from './archive';
import { renderNote } from './notes';
import { ALL_ENTRIES, AWKWARD, READING, SERMON } from './fixtures';
import outlines from '../data/sections.json';
import topicsFile from '../data/topics.json';
import type { OutlineBook, Topic } from '../types';

const outlineBooks = outlines as unknown as OutlineBook[];
const topics = topicsFile.topics as Topic[];
const NOW = new Date('2026-09-13T12:00:00.000Z');

const context = () =>
  buildContext({ entries: ALL_ENTRIES, outlineBooks, topics, profile: 'public', now: NOW });

/** Pull the YAML front matter block out of a note file. */
function frontMatter(note: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(note);
  if (!match) throw new Error('Note has no YAML front matter');

  const fields: Record<string, string> = {};
  let lastKey = '';
  for (const line of match[1].split('\n')) {
    const pair = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (pair) {
      fields[pair[1]] = pair[2];
      lastKey = pair[1];
    } else if (line.trim().startsWith('-') && lastKey) {
      fields[lastKey] = `${fields[lastKey]} ${line.trim()}`.trim();
    }
  }
  return fields;
}

describe('cold read: a note file must stand entirely on its own', () => {
  // The test the owner set: a grandchild in 2060, a text editor, no app, no
  // context. Everything needed to understand the note is inside the note.
  it('opens with valid YAML front matter carrying every structured field', async () => {
    const note = renderNote(SERMON, await context());
    const fields = frontMatter(note);

    for (const required of [
      'id', 'title', 'kind', 'date', 'place', 'speaker', 'sermonSeries',
      'tags', 'forDescendants', 'visibility', 'createdAt', 'updatedAt',
    ]) {
      expect(fields, required).toHaveProperty(required);
      expect(String(fields[required]).trim(), required).not.toBe('');
    }
  });

  it('records the event date, not the date it was typed', async () => {
    const fields = frontMatter(renderNote(SERMON, await context()));
    expect(fields.date).toContain('2026-03-15');
    expect(fields.createdAt).toContain('2026-03-15T17:55');
  });

  it('embeds the KJV text so the note is readable without a Bible', async () => {
    const note = renderNote(SERMON, await context());
    expect(note).toContain('Blessed are the poor in spirit');
    expect(note).toContain('Blessed are the peacemakers');
  });

  it('names the King James Version so scripture is never mistaken for the writer', async () => {
    const note = renderNote(SERMON, await context());
    expect(note).toMatch(/King James Version/i);
  });

  it('embeds an uncovered passage exactly as readily as an outlined one', async () => {
    // Genesis 35:1-15 has no outline entry at all.
    const note = renderNote(READING, await context());
    expect(note).toContain('Arise, go up to Bethel');
  });

  it('embeds a passage that spans a chapter boundary, across both chapters', async () => {
    const note = renderNote(AWKWARD, await context());
    expect(note).toContain('Stephen, full of faith and power'); // Acts 6:8
    expect(note).toContain('Are these things so?'); // Acts 7:1
  });

  it('keeps notes and reflection under separate headings', async () => {
    const note = renderNote(SERMON, await context());
    const notesAt = note.indexOf('## Notes');
    const reflectionAt = note.indexOf('## Reflection');

    expect(notesAt).toBeGreaterThan(-1);
    expect(reflectionAt).toBeGreaterThan(notesAt);
    expect(note.slice(notesAt, reflectionAt)).not.toContain(SERMON.reflection);
  });

  it('says what a dead link pointed to', async () => {
    const note = renderNote(SERMON, await context());
    expect(note).toContain('First Baptist Tallahassee');
  });

  it('survives an entry whose optional fields are all empty', async () => {
    const note = renderNote(AWKWARD, await context());
    expect(note).toContain('---');
    expect(note).not.toContain('undefined');
    expect(note).not.toContain('[object Object]');
    // An empty notes field must not leave a dangling heading.
    expect(note).not.toMatch(/## Notes\s*\n\s*## /);
  });

  it('never emits undefined or [object Object] for any fixture', async () => {
    const ctx = await context();
    for (const entry of ALL_ENTRIES) {
      const note = renderNote(entry, ctx);
      expect(note, entry.id).not.toContain('undefined');
      expect(note, entry.id).not.toContain('[object Object]');
      expect(note, entry.id).not.toContain('NaN');
    }
  });
});
