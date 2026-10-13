# Protected companion transfer, version 1

The existing companion `.lwc` file is now accepted by the app's **Your journal →
Journal file to read** control. This change is on the implementation branch;
installed releases without it still require unlocking locally in the companion
and transferring an unencrypted `journey-export` JSON file. The companion is deployed at its existing address; native installed releases
remain subject to the separate release HOLD. See the implementation record
for exact integration and publication evidence.

## Byte contract

A UTF-8 JSON object contains exactly these required values:

- `format`: `lwc-companion-protected`
- `version`: `1`
- `kdf`: `PBKDF2-SHA256`
- `iterations`: `600000`
- `cipher`: `AES-256-GCM`
- `salt`: canonical padded RFC 4648 Base64 encoding of 16 bytes
- `iv`: canonical padded RFC 4648 Base64 encoding of 12 bytes
- `data`: canonical padded Base64 ciphertext followed by a 16-byte GCM tag

Password bytes are UTF-8, with no trimming or Unicode normalization. PBKDF2
(SHA-256, 600,000 iterations) derives a 256-bit AES key. AES-GCM additional
authenticated data is the exact UTF-8 string:

`lwc-companion-protected:1:PBKDF2-SHA256:600000:AES-256-GCM`

The companion uses Web Crypto `getRandomValues` for fresh salt and IV on every
export. The importer only decrypts. It never stores the password or key, logs
journal content, or sends anything over the network. Temporary byte arrays are
cleared where practical; JavaScript strings and runtime memory cannot be
promised securely erased. Existing files with long passwords remain supported.

The authenticated plaintext is UTF-8 `journey-export` version 1 JSON. Entries
and unfinished drafts are separate collections. Existing format identifiers,
IDs, timestamps, provenance and content fields remain unchanged.

## Defensive limits and failures

- Protected file: at most 16 MiB, including the JSON envelope.
- Plaintext: at most 11 MiB; ciphertext at most 11 MiB plus its 16-byte tag.
- The exact version, algorithms and iteration count are checked before deriving
  a key. File-controlled values cannot select a slower KDF or weaker cipher.
- Invalid Base64, salt/IV lengths and truncated tags are rejected.
- Wrong passwords and authenticated-data/ciphertext tampering produce the same
  content-free unlock failure. Nothing is imported.
- UTF-8, JSON and journal structure are validated after authentication.

These limits match the companion writer. This work is interoperability and
regression-tested implementation, **not an independent security review**.
Web Crypto API contracts: [decrypt](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/decrypt)
and [deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey).

## Review, duplicates and conflicts

Unlocking creates a preview, never a write. The person confirms Merge or
Replace. Merge preserves changed entries and drafts as deterministic separate
copies and skips repeated identical imports. The receipt counts records
actually written, records skipped, and newly preserved conflict copies.

The commit uses the current main provider’s exact journal token, including
entries, drafts and opaque metadata, from the snapshot the person reviewed. Any intervening change refuses the restore and requires a fresh
preview; Replace cannot erase writing that appeared after its preview.

Unknown entry/draft fields, nested extension data and journal-envelope metadata
are retained. Metadata has its own durable schema-3 provider store, so an empty
journal is preserved too. Full backups include it; filtered copies omit
journal-wide metadata that could describe private writing outside the selection.
See [the envelope/migration contract](JOURNAL-ENVELOPE-PRESERVATION.md) for
collision carriers, original-path projection and older-binary limitations.
The preview and atomic snapshot include metadata; metadata-only concurrent
changes refuse a stale restore. Imported draft extensions also survive an
intentional Save through the [promotion contract](DRAFT-PROMOTION-PRESERVATION.md).
Keep original transfer files until the receiving journal and a fresh backup have
been checked. No arbitrary older installed reader is promised full fidelity.

## Transfer instructions

1. In the companion, select entries and unfinished drafts separately and review
   the content. Choose a password-protected `.lwc` or plain JSON transfer.
2. Check that the browser actually kept the file. An offered download is neither
   a confirmed backup nor evidence that another device received it.
3. Copy the file using a cable, AirDrop, or another method you trust. Never put
   a personal journal in a public URL or QR. Church QR codes are public links
   to provided material only.
4. On a compatible app build, open Your journal, choose the file, enter the
   password, review warnings/duplicates/conflicts, and confirm Merge.
5. Read the receipt, reopen the entries and drafts, and keep the original
   transfer until the content has been checked. Password-protected files do not
   expire and cannot be remotely revoked.

App Lock does not encrypt the working database. Decrypted working data and
ordinary ZIP/JSON exports remain unencrypted by this application. A protected
transfer does not create synchronization, a server backup, or device pairing.
The canonical long-term archive remains the existing ZIP with Markdown,
manifest, JSON, and **My Journey With Christ** printable book.

## Independent fixtures

Identical files are retained in this repository at
`src/export/test-fixtures/protected-v1.*` and in the authoritative companion at
`tests/fixtures/protected-v1.*`. They contain only fictional Sunday material.
The `.metadata.json` password is a public test password, not a credential.
The ciphertext was generated with Node/OpenSSL PBKDF2 and AES-GCM independently
of the product's Web Crypto writer. Fixed fixture salt/IV are for known-answer
tests only, never production randomness.

Physical iPhone/Android picker behavior, system file associations, phone import,
QR scanning, process-kill recovery and native release acceptance remain
unverified until the documented hardware checklist is executed. The native
release recommendation stays **HOLD**.
