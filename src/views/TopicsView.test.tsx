import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { topics } from '../app/data';
import TopicsView from './TopicsView';

/** Data-driven rather than hard-coded, so a hand edit to topics.json cannot quietly rot the test. */
const first = topics[0];
const filterInput = () => screen.getByLabelText('Filter topics');

// Vitest runs without global expose, so RTL cannot register its own cleanup.
afterEach(cleanup);

describe('TopicsView', () => {
  it('gives every topic a link to its own page', () => {
    render(<TopicsView />);

    expect(screen.getByRole('heading', { level: 1, name: 'Topics' })).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(topics.length);
    expect(links[0]).toHaveAttribute('href', `#/topic/${first.id}`);
  });

  it('shows the name, the description and how many passages a topic carries', () => {
    render(<TopicsView />);

    const link = screen.getByRole('link', { name: new RegExp(`^${first.name}`) });
    expect(link).toHaveTextContent(first.description);
    expect(link).toHaveTextContent(`${first.refs.length} passages`);
  });

  it('narrows the grid by name', () => {
    render(<TopicsView />);
    // A topic the filter cannot reach by either field, so its absence is meaningful.
    const needle = first.name.toLowerCase();
    const other = topics.find(
      (topic) =>
        !topic.name.toLowerCase().includes(needle) &&
        !topic.description.toLowerCase().includes(needle),
    );

    fireEvent.change(filterInput(), { target: { value: first.name } });

    expect(screen.getByRole('link', { name: new RegExp(`^${first.name}`) })).toBeInTheDocument();
    expect(screen.getAllByRole('link').length).toBeLessThan(topics.length);
    if (other) {
      expect(screen.queryByRole('link', { name: new RegExp(`^${other.name}`) })).not.toBeInTheDocument();
    }
  });

  it('narrows the grid by description, not only by name', () => {
    render(<TopicsView />);

    // A whole description matches exactly one topic, and matches no name at all,
    // so a hit here can only have come from searching the description.
    fireEvent.change(filterInput(), { target: { value: first.description } });

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', `#/topic/${first.id}`);
  });

  it('announces how many topics match', () => {
    render(<TopicsView />);
    fireEvent.change(filterInput(), { target: { value: first.description } });

    expect(screen.getByText(`Showing 1 of ${topics.length} topics.`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^1 of ${topics.length} topics match`))).toBeInTheDocument();
  });

  it('says so when nothing matches, and clearing brings the topics back', () => {
    render(<TopicsView />);
    fireEvent.change(filterInput(), { target: { value: 'qzzx' } });

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('No topic matches “qzzx”')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));

    expect(screen.getAllByRole('link')).toHaveLength(topics.length);
    // Clearing removes the button that had focus; focus must land somewhere useful.
    expect(document.activeElement).toBe(filterInput());
    // Restoring the list changes the count as much as narrowing it did, and it
    // moves no focus of its own, so it is spoken too.
    expect(
      screen.getByText(`Filter cleared. Showing all ${topics.length} topics.`),
    ).toBeInTheDocument();
  });

  it('says nothing before the reader has filtered anything', () => {
    render(<TopicsView />);

    // A live region that already holds text on first paint talks over the page
    // heading the shell has just moved focus to.
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toBeInTheDocument();
    expect(live).toHaveTextContent('');
  });

  it('keeps heading levels in order under the shell', () => {
    render(<TopicsView />);
    const levels = screen
      .getAllByRole('heading')
      .map((heading) => Number(heading.tagName.slice(1)));

    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    expect(Math.max(...levels)).toBe(2);
  });
});
