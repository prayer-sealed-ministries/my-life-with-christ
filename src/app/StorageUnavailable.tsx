/**
 * What the app shows when it cannot open the journal.
 *
 * This screen is a feature, not a failure mode to be patched around. Native
 * editions keep the journal in SQLite (see
 * `docs/ADR-NATIVE-APP-ARCHITECTURE.md`); if that store cannot be opened, the
 * app stops here rather than starting.
 *
 * The alternative — quietly falling back to the webview's IndexedDB so the app
 * looks finished — is the single most damaging shortcut available in this
 * project. Someone would write real entries into a store they were never told
 * about, that cannot be handed to them, that does not appear in their archive,
 * and that the next successful launch would stop reading. The journal would be
 * gone and every screen would have reported success the whole way.
 *
 * So the shell refuses, says why, and says plainly that nothing was written.
 * On the web this screen is unreachable in normal use: Dexie is registered and
 * selection succeeds, and a browser that blocks storage gets a banner instead,
 * because there the rest of the app is still worth having.
 */

export function StorageUnavailable({ reason }: { reason: Error }) {
  return (
    <div className="min-h-dvh bg-app px-5 py-16 text-ink">
      <main className="measure mx-auto">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">
          Life With Christ cannot open your journal on this device
        </h1>

        <p className="mt-4 leading-relaxed text-ink-soft">
          The app has stopped rather than writing your journal somewhere it does not belong. It does
          not keep a second copy elsewhere, and it will not start with one.
        </p>

        <p className="mt-4 leading-relaxed text-ink-soft">
          <strong className="font-semibold text-ink">Nothing has been written or changed.</strong>{' '}
          Any archive you have already exported is a plain file on your own device and is
          unaffected by this.
        </p>

        {/* The underlying message names the storage kind and says nothing was
            written. Shown rather than hidden: whoever sees this needs to know
            which store failed, and a blocked app that will not say why wastes
            an hour of somebody's evening. */}
        <p className="mt-6 rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">
          {reason.message}
        </p>

        <p className="mt-6 text-sm text-ink-muted">
          If this keeps happening, reinstalling the app will not recover a journal it could not
          read — restore from an archive you exported instead.
        </p>
      </main>
    </div>
  );
}
