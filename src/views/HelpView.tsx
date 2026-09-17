/**
 * Help: what this app actually does, in the order someone meets it.
 *
 * Only features that exist are described. In particular the backup section says
 * what an export IS and how to bring one back, without claiming anything about
 * how thoroughly restore has been tested on every platform — that is a fact
 * about our QA, not about the product, and stating it would be both irrelevant
 * and, today, untrue.
 */

import { Link } from '../app/router';

export default function HelpView() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Help</h1>
        <p className="measure mt-2 text-sm leading-relaxed text-ink-soft">
          Short answers to what this app does and how to keep what you write.
        </p>
      </header>

      <section aria-labelledby="getting-started" className="space-y-2">
        <h2 id="getting-started" className="font-serif text-lg font-semibold">
          Getting started
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          Start writing before you do anything else. <strong>New sermon note</strong> on the home
          page opens an empty entry with today&rsquo;s date — you can add the passage, the
          speaker and everything else afterwards, or never. Nothing else needs setting up.
        </p>
      </section>

      <section aria-labelledby="reading" className="space-y-2">
        <h2 id="reading" className="font-serif text-lg font-semibold">
          Reading Scripture
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          <Link to={{ name: 'browse' }} className="underline focus-visible:outline-2">
            Bible
          </Link>{' '}
          lists all 66 books. Open a book to read it in passages, and any passage has an{' '}
          <strong>Add entry</strong> action so you can write against exactly what you were
          reading. Every verse is reachable, including the stretches no passage title covers.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          <Link to={{ name: 'topics' }} className="underline focus-visible:outline-2">
            Topics
          </Link>{' '}
          approaches it from the other side: fear, forgiveness, grief and others, each gathering
          passages with a line on why they belong there.
        </p>
      </section>

      <section aria-labelledby="writing" className="space-y-2">
        <h2 id="writing" className="font-serif text-lg font-semibold">
          Writing an entry
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          An entry needs nothing but the notes. Kind, title, date, place, speaker, series, tags and
          links are all optional and can be filled in later. You can attach a passage by name or by
          reference — &ldquo;sermon on the mount&rdquo;, or &ldquo;John 4&rdquo;.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          Entries are saved when you press <strong>Save</strong>. There is no autosave, so an entry
          you have not saved is not yet in your journal.
        </p>
      </section>

      {/*
        The one distinction worth explaining carefully, in the words the editor
        itself uses: "What was taught" and "What it meant to me". They are
        separate fields in the entry, separate sections in the exported book, and
        a reflection is never shared implicitly with notes.
      */}
      <section aria-labelledby="notes-reflection" className="space-y-2">
        <h2 id="notes-reflection" className="font-serif text-lg font-semibold">
          Notes and Reflection are different
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          <strong>Notes</strong> is what was taught — the sermon, the passage, what was actually
          said. <strong>Reflection</strong> is what it meant to you: what you saw, what you were
          convicted of, what you want to remember.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          They are kept apart everywhere and never merged. Years later that separation is what lets
          you read what you heard and what it did in you as two different things.
        </p>
      </section>

      <section aria-labelledby="prayer" className="space-y-2">
        <h2 id="prayer" className="font-serif text-lg font-semibold">
          Prayer
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          An entry can carry a prayer of its own, under <strong>Details</strong>. It is kept
          separate from both the notes and the reflection.
        </p>
      </section>

      <section aria-labelledby="journey" className="space-y-2">
        <h2 id="journey" className="font-serif text-lg font-semibold">
          My journey
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          <Link to={{ name: 'timeline' }} className="underline focus-visible:outline-2">
            My journey
          </Link>{' '}
          is everything you have written, oldest first, grouped by year and month — the way it was
          lived rather than the way it was filed.
        </p>
      </section>

      <section aria-labelledby="searching" className="space-y-2">
        <h2 id="searching" className="font-serif text-lg font-semibold">
          Search
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          <Link to={{ name: 'search', query: '' }} className="underline focus-visible:outline-2">
            Search
          </Link>{' '}
          covers your own entries, topics and their other names, book names, and typed references
          like &ldquo;Matt 6:25&rdquo;. It searches on this device; nothing is sent anywhere.
        </p>
      </section>

      <section aria-labelledby="backing-up" className="space-y-2">
        <h2 id="backing-up" className="font-serif text-lg font-semibold">
          Backing up your journal
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          The copy on this device is not a backup. Removing the app, clearing its data, or losing
          the device takes the journal with it, and no copy exists anywhere else until you make
          one.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          <Link to={{ name: 'data' }} className="underline focus-visible:outline-2">
            Data &amp; Backup
          </Link>{' '}
          exports everything as a single zip file that belongs to you. It holds your entries as
          plain Markdown, a readable{' '}
          <em>My Journey With Christ</em> book as one self-contained HTML file, a spreadsheet-ready
          CSV, and a manifest listing every file with its checksum so damage is detectable rather
          than silent. It is built to be readable by someone with a text editor and no app at all.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          Keep an exported copy somewhere other than this device.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          If a month goes by without an export, your journal page says so. You can change how long
          it waits in{' '}
          <Link to={{ name: 'settings' }} className="underline focus-visible:outline-2">
            Settings
          </Link>
          . The reminder does not make a copy of anything — exporting is what does that.
        </p>
      </section>

      <section aria-labelledby="restoring" className="space-y-2">
        <h2 id="restoring" className="font-serif text-lg font-semibold">
          Restoring a journal
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          On the same page, choose an export and you are shown exactly what it would do — how many
          entries are new, updated or unchanged — before anything is written. You then choose
          whether to merge it with what is here or replace what is here entirely.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          Nothing is written until you press the button that says so, and a file that is damaged or
          is not a journal export is refused without touching what you already have.
        </p>
      </section>

      <section aria-labelledby="the-book" className="space-y-2">
        <h2 id="the-book" className="font-serif text-lg font-semibold">
          My Journey With Christ
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          Every export contains your entries laid out as a book, in one HTML file that needs no
          app, no network and no account to read. You can open it in any web browser and print it.
          It is the thing meant to outlast this software.
        </p>
      </section>

      <section aria-labelledby="privacy-offline" className="space-y-2">
        <h2 id="privacy-offline" className="font-serif text-lg font-semibold">
          Privacy and working offline
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          There is no account and nothing is uploaded. Scripture, topics and your journal are all
          on the device, so reading and writing work with no network at all.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          More about the product and where its words come from is in{' '}
          <Link to={{ name: 'about' }} className="underline focus-visible:outline-2">
            About
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
