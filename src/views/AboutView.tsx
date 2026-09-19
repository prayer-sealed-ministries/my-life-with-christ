/**
 * About: what this is, and what is true about it.
 *
 * Every factual claim here is one the implementation actually supports — no
 * account exists, nothing is uploaded, there is no analytics code, and the
 * export is a real file the reader keeps. Claims that would need a server, a
 * policy or a promise we cannot keep are absent rather than softened.
 *
 * Attribution reuses the existing `Attribution` component rather than restating
 * it, so there is one description of where the words came from and the wiring
 * test keeps covering it.
 */

import { Attribution } from '../components/Attribution';
import { APP_VERSION } from '../app/version';
import { Link } from '../app/router';

export default function AboutView() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">About</h1>
        <p className="mt-1 text-base text-ink-soft">Your walk, remembered.</p>
      </header>

      <section aria-labelledby="what-it-is" className="space-y-3">
        <h2 id="what-it-is" className="font-serif text-lg font-semibold">
          What My Life With Christ is
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          A private, Scripture-centred journal for recording sermons, Scripture notes, prayers and
          reflections over a lifetime.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          Over time those entries become <em>My Journey With Christ</em> — a readable record of
          faith that can be kept, printed and passed on. These are your words, your prayers, your
          story.
        </p>
        {/* Said once, quietly, where it explains a design decision rather than
            decorating the page. */}
        <p className="measure text-sm leading-relaxed text-ink-muted">
          The aim is not a place to store notes. It is a record of a life with Christ that can
          outlive the software that created it — which is why the export, not the app, is the thing
          you own.
        </p>
      </section>

      <section aria-labelledby="how-it-treats" className="space-y-3">
        <h2 id="how-it-treats" className="font-serif text-lg font-semibold">
          How it treats your journal
        </h2>
        <ul className="measure space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>No account. There is nothing to sign up for and nothing to sign in to.</li>
          <li>Nothing is uploaded. What you write stays on this device.</li>
          <li>No advertising, and no analytics or tracking of any kind.</li>
          <li>It works offline. Scripture, topics and your journal are all on the device.</li>
          <li>
            Your export is a plain zip file you keep. Where you put it is your choice; the app does
            not need it back.
          </li>
        </ul>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          Removing the app takes the journal with it. That is why{' '}
          <Link to={{ name: 'data' }} className="underline focus-visible:outline-2">
            exporting
          </Link>{' '}
          matters, and why the export is designed to be readable without this app at all.
        </p>
      </section>

      {/* One description of provenance, shared with the journal page. */}
      <Attribution headingId="about-attribution" />

      <section aria-labelledby="where" className="space-y-2 border-t border-line pt-6">
        <h2 id="where" className="font-serif text-lg font-semibold">
          My Life With Christ
        </h2>
        {/* Text, not a link: the app must not depend on a website, must not
            fetch anything, and cannot vouch for an address while offline. */}
        <p className="text-sm text-ink-soft">mylifewithchrist.com</p>
        <p className="text-sm text-ink-muted">Version {APP_VERSION}</p>
      </section>
    </div>
  );
}
