# Releasing the Android app

A checklist, not a tutorial. It exists so that a release is the same
sequence every time and so that the things which are irreversible are
done deliberately.

Nothing in this file is a secret, and nothing secret may be added to it.
Keystores, passwords and `local.properties` are gitignored and stay that
way.

## Before anything

- [ ] Tree clean, on `main`, pushed, CI green.
- [ ] `npm run gate` — "This build is publishable".
- [ ] `npm run verify:no-private-data` — passes.
- [ ] Full sweep green on both profiles: `npm run test:e2e:sweep`.
- [ ] `npm run verify:startup` — Fast Capture still does not wait for
      Scripture data.

## Version

- [ ] Decide `versionCode` and `versionName` in
      `android/app/build.gradle`.
- [ ] `versionCode` MUST be strictly greater than every code ever
      uploaded to Play for `com.myjourneywithchrist.lifewithchrist`.
      Play rejects a repeat, and a code cannot be reused after upload
      even if that release was never published.
- [ ] Record the pair in the release notes below.

## Profile

- [ ] The store build is `public`, and only `public`.
      `NATIVE_PROFILE` in `scripts/native-assets.mjs` pins it; the
      script verifies the bundle before writing the marker, and
      `native-sync` refuses to copy assets without a matching marker.
      Do not override it.

## Build

```
npm run native:assets      # builds public, verifies, writes the marker
npm run native:sync        # refuses unless the marker matches
cd android && ./gradlew bundleRelease        # the .aab for Play
cd android && ./gradlew assembleRelease      # an .apk, for local checks
```

- [ ] `npm run verify:apk <path to the release apk>` — passes.

## Signing

- [ ] The release build must be signed by the **upload key**. Play then
      re-signs with the **app signing key**, which Google holds; those
      are two different keys and only the first is ours to keep.
- [ ] The upload key is a long-lived product identity. Losing it means
      a Play support process to reset it. Back it up somewhere that is
      not this machine and not this repository.
- [ ] Never commit a keystore, a password, or `local.properties`.

## Verify the artifact, not the source

- [ ] `aapt2 dump badging` — package, label, versionCode/Name,
      min/target SDK are what was intended.
- [ ] `aapt2 dump permissions` — nothing beyond the known set. The
      allow-list and its reasoning live in `scripts/verify-apk.mjs`.
- [ ] No `debuggable`, no `testOnly`, no cleartext config.
- [ ] `apksigner verify --print-certs` — signed, by the expected
      certificate.

## Updating a device in place

- [ ] **The signing identity must match what is already installed.**
      Android refuses an update across certificates with
      `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, and the only way past it is
      to uninstall — which destroys the journal and every unfinished
      draft on that device.
- [ ] Before updating a device that holds real writing: confirm what
      signed the build currently on it. If it was a debug build and the
      new one is release-signed, **stop** — export the journal first, or
      keep that device on the debug identity.
- [ ] Rehearse on the emulator first: install the old build, create an
      entry and an unfinished draft, install the new build over it with
      no uninstall and no clear-data, and confirm both survive.
- [ ] When the identities already differ and the device holds real
      writing, there is no in-place path at all — the journal has to
      cross on an archive. `docs/A17-MIGRATION.md` is that procedure,
      rehearsed on the emulator, including the step that validates an
      archive against its own manifest **before** anything is
      uninstalled (`npm run verify:archive`). The app itself does not
      check the manifest on import.

## Play

- [ ] Internal Testing track first.
- [ ] Data Safety form must match what the app actually does. Fill it in from
      `docs/GOOGLE-PLAY-DATA-SAFETY.md`, which quotes Google's own
      definitions of "collect" and "share" and records what the source
      actually does — including the one item that must be confirmed in the
      Console rather than assumed.
- [ ] A privacy policy URL is required. The text is written and unpublished at
      `docs/PRIVACY-POLICY.md`; it still carries a contact placeholder.
- [ ] **Confirm the package's Play history before choosing a versionCode.**
      Local evidence shows no prior upload, which is not proof there was none.
      The exact question to ask is in `docs/RELEASE-STATUS.md`.

## Where the release paperwork lives

| Document | What it is for |
| --- | --- |
| `docs/RELEASE-STATUS.md` | What is done, what is waiting on a person, the effective permission table, and the Play version-history question. |
| `docs/PRIVACY-POLICY.md` | The policy text, written from source. Unpublished. |
| `docs/GOOGLE-PLAY-DATA-SAFETY.md` | Internal worksheet for the Data Safety form. |
| `docs/SIGNING-MIGRATION-RUNBOOK.md` | The permanent-signing migration. Plan only; blocked on an off-machine key backup. |
| `docs/A17-MIGRATION.md` | The archive bridge the signing migration depends on. |

## After

- [ ] Note the versionCode, versionName, commit SHA and artifact
      SHA-256 in the release notes.
- [ ] Keep the exact `.aab` that was uploaded.

## Release notes

| Date | versionCode | versionName | Commit | Track |
| --- | --- | --- | --- | --- |
| — | — | — | — | nothing released yet |
