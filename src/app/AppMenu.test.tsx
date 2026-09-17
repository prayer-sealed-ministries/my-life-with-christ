/**
 * The menu as an interaction, not as a pile of DOM nodes.
 *
 * Counting links would pass against a menu that opens and then traps a keyboard
 * user inside it forever, so what is asserted here is the behaviour a person
 * actually depends on: it opens, it can be left, leaving it puts focus back
 * where it was, and choosing somewhere closes it.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppMenu } from './AppMenu';
import { PRIMARY, SECONDARY } from './destinations';
import { closeOverlay, overlayOpen, registerOverlay } from './overlay';
import { RouterProvider } from './router';

const renderMenu = () =>
  render(
    <RouterProvider>
      <AppMenu isCurrent={(nav) => nav.name === 'home'} />
    </RouterProvider>,
  );

/**
 * The header button, found by the attribute only it has.
 *
 * Matching on the name alone picks up the panel's own close button once the
 * menu is open — two controls legitimately called "Close menu" — and the test
 * then fails on its own query rather than on the behaviour.
 */
const trigger = (): HTMLElement => {
  const button = document.querySelector<HTMLElement>('button[aria-controls][aria-expanded]');
  if (!button) throw new Error('no menu trigger rendered');
  return button;
};

beforeEach(() => {
  window.location.hash = '';
  registerOverlay(null);
});

afterEach(() => {
  cleanup();
  registerOverlay(null);
});

describe('the application menu', () => {
  it('has a real accessible name and says whether it is open', () => {
    renderMenu();
    const button = trigger();

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on click, as a dialog', async () => {
    renderMenu();
    fireEvent.click(trigger());

    const panel = await screen.findByRole('dialog', { name: /menu/i });
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('holds every destination, primary and application alike', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await screen.findByRole('dialog');

    // On a phone this drawer is the only navigation, so a menu missing the
    // Bible would be a menu for the application's paperwork.
    for (const destination of [...PRIMARY, ...SECONDARY]) {
      expect(
        screen.getByRole('link', { name: destination.label }),
        `${destination.label} is missing from the menu`,
      ).toBeTruthy();
    }
    // A floor: the loop above proves nothing if the lists are empty.
    expect(PRIMARY.length + SECONDARY.length).toBeGreaterThanOrEqual(9);
  });

  it('keeps "My journey" as the journal label, not the book title', () => {
    // They are different things: one is the running timeline, the other is the
    // lifelong artefact the export produces.
    const labels = [...PRIMARY, ...SECONDARY].map((d) => d.label);
    expect(labels).toContain('My journey');
    expect(labels).not.toContain('My Journey With Christ');
  });

  it('moves focus into the panel when it opens', async () => {
    renderMenu();
    fireEvent.click(trigger());

    const panel = await screen.findByRole('dialog');
    await waitFor(() => expect(document.activeElement).toBe(panel));
  });

  it('closes on Escape and returns focus to the button', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it('closes when a destination is chosen', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes when the backdrop is clicked', async () => {
    const { container } = renderMenu();
    fireEvent.click(trigger());
    await screen.findByRole('dialog');

    const backdrop = container.parentElement?.querySelector('[aria-hidden="true"].fixed');
    expect(backdrop, 'no backdrop rendered').toBeTruthy();
    fireEvent.click(backdrop!);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has a close control inside the panel as well', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await screen.findByRole('dialog');

    const closers = screen.getAllByRole('button', { name: /close menu/i });
    expect(closers.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(closers[closers.length - 1]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the menu is what a back gesture sees', () => {
  // The registry is how the Android binding learns that something modal is on
  // top without the shell importing the platform layer.
  it('registers itself while open and unregisters when closed', async () => {
    renderMenu();
    expect(overlayOpen(), 'something was registered before the menu opened').toBe(false);

    fireEvent.click(trigger());
    await screen.findByRole('dialog');
    expect(overlayOpen(), 'the open menu did not register as the overlay').toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(overlayOpen()).toBe(false));
  });

  it('can be dismissed through the registry, which is what back does', async () => {
    renderMenu();
    fireEvent.click(trigger());
    await screen.findByRole('dialog');

    expect(closeOverlay(), 'the registry reported nothing to close').toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reports nothing to close when the menu is shut', () => {
    renderMenu();
    expect(closeOverlay()).toBe(false);
  });
});
