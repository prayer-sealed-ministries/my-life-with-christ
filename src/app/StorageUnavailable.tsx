/**
 * What a native Phase 1 build shows instead of a journal.
 *
 * This screen is a feature, not a failure mode to be patched around. Native
 * editions require SQLite (see docs/ADR-NATIVE-APP-ARCHITECTURE.md); SQLite
 * arrives in Phase 2; so a Phase 1 native build asks for storage it cannot have
 * and stops here.
 *
 * The alternative — quietly falling back to the webview's IndexedDB so the app
 * looks finished — is the single most damaging shortcut available in this
 * project. Someone would write real entries into a store they were never told
 * about, that cannot be handed to them, that does not appear in their archive,
 * and that Phase 2 would stop reading. The journal would be gone and every
 * screen would have reported success the whole way.
 *
 * So the shell refuses, says why, and says plainly that nothing was written.
 * On the web this screen is unreachable: Dexie is registered and selection
 * succeeds.
 */

export function StorageUnavailable({ reason }: { reason: Error }) {
  return (
    <div className="min-h-dvh bg-app px-5 py-16 text-ink">
      <main className="measure mx-auto">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">
          Life With Christ cannot open a journal on this device
        </h1>

        <p className="mt-4 leading-relaxed text-ink-soft">
          This is a development build. The storage this edition needs is not installed yet, so the
          application has stopped rather than writing your journal somewhere it does not belong.
        </p>

        <p className="mt-4 leading-relaxed text-ink-soft">
          <strong className="font-semibold text-ink">Nothing has been written or changed.</strong>{' '}
          Any archive you have already exported is a plain file on your own device and is
          unaffected by this.
        </p>

        {/* The underlying message names the storage kind and says nothing was
            written. Shown rather than hidden: the person reading this is a
            developer, and a blocked build that will not say why wastes an hour. */}
        <p className="mt-6 rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">
          {reason.message}
        </p>

        <p className="mt-6 text-sm text-ink-muted">
          Phase 1 builds exist to prove the application shell runs from packaged local assets. The
          journal itself becomes available when native storage lands in Phase 2.
        </p>
      </main>
    </div>
  );
}
