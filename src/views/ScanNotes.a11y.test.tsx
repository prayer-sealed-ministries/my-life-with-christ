/**
 * The review screen, checked by axe — because the suite that normally does
 * this cannot reach it.
 *
 * `tests/e2e/a11y.spec.ts` runs axe over every view of the built site, and the
 * built site is the web edition, where Scan Notes is deliberately absent: there
 * is no on-device recogniser a browser can promise. So the one screen in this
 * application that only ever appears on a phone is the one screen the
 * accessibility suite can never see.
 *
 * Adding a seam to the production code so a browser test could force the sheet
 * open would be worse than this gap. Running axe here instead is the honest
 * trade, and its limits are real and worth stating: jsdom computes no layout
 * and no colour, so this catches names, roles, labels and structure, and says
 * nothing about contrast, focus visibility or reflow. Those remain unchecked
 * for this screen until somebody looks at it on a device.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { ScanNotes } from './ScanNotes';
import { forgetPendingScan } from '../scan/pending';
import { PlatformProvider } from '../platform/provider';
import { webPlatform } from '../platform/web';
import type { PageScanner, Recognition, ScannedPage } from '../platform/ports';

const TEXT = 'FICTIONAL-SCAN\nThe shepherd goes after the one';

const page: ScannedPage = {
  handle: 'fictional-handle',
  preview: 'data:image/png;base64,iVBORw0KGgo=',
  width: 1200,
  height: 1600,
  blurWarning: true,
};

const recognition: Recognition = {
  text: TEXT,
  lines: [{ text: TEXT }],
  imageWidth: 1200,
  imageHeight: 1600,
  engine: 'fictional-engine',
  elapsedMs: 7,
};

const scanner: PageScanner = {
  supported: true,
  capture: async () => page,
  choose: async () => page,
  recognise: async () => recognition,
  recognisePrepared: async () => ({ reason: 'unsupported' } as const),
  async discard() {},
};

/** The AA standard this project holds itself to, as axe tags it. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function check(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: TAGS },
    // jsdom paints nothing, so a colour result here would be fabricated.
    rules: { 'color-contrast': { enabled: false } },
  });
  // The floor. axe reports no violations against an empty node too, so assert
  // it actually examined the screen before trusting the silence.
  expect(results.passes.length + results.violations.length).toBeGreaterThan(3);
  return results.violations.map((violation) => `${violation.id}: ${violation.help}`);
}

afterEach(() => {
  cleanup();
  // A photographed page deliberately outlives the component that took it, so
  // one test's page is waiting for the next one unless it is cleared here.
  forgetPendingScan();
});

const mount = () =>
  render(
    <main>
      <PlatformProvider platform={{ ...webPlatform, scanner }}>
        <ScanNotes
          owner={{ route: '#/entry/fictional-a11y' }}
          onAccept={() => {}}
          onClose={() => {}}
          existing={{ notes: true, providedNotes: false }}
        />
      </PlatformProvider>
    </main>,
  );

describe('the review screen is reachable by everybody', () => {
  it('has no violations before a page has been taken', async () => {
    const { container } = mount();
    expect(await check(container)).toEqual([]);
  });

  it('has no violations while reviewing, with every control on screen', async () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());

    // Choosing a destination reveals the placement choice, and this page is
    // blurry, so the warning is up too: every control the screen has.
    fireEvent.click(screen.getByRole('radio', { name: 'My Notes' }));
    expect(screen.getByRole('radio', { name: /Replace existing text/ })).toBeTruthy();

    expect(await check(container)).toEqual([]);
  });

  it('names every control with a real label, never a placeholder', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    // Choosing a destination that already holds writing brings the placement
    // radios out, so all five controls are on screen to be checked.
    fireEvent.click(screen.getByRole('radio', { name: 'My Notes' }));

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>('input, textarea, select'),
    );
    expect(controls.length).toBeGreaterThanOrEqual(5);
    for (const control of controls) {
      const id = control.getAttribute('id');
      expect(id, `${control.tagName} has no id to label`).toBeTruthy();
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label, `${control.tagName}#${id} has no <label for>`).toBeTruthy();
      expect(label?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      // A placeholder is not a name. The suite checks this on every other
      // screen; this one has to check it for itself.
      expect(control.getAttribute('placeholder')).toBeNull();
    }
  });
});
