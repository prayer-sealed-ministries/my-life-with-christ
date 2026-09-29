/**
 * MANIFEST.txt: one reading of it, shared by everything that reads it.
 *
 * The archive records a SHA-256 and a byte count for every file it carries, so
 * that damage is detectable rather than silent. Two things check that record —
 * the app, before it restores, and `npm run verify:archive`, run on a computer
 * before a device is wiped — and they must not drift into two opinions about
 * what the manifest says. So the grammar and the verification live here, once.
 *
 * WHY THIS IS PLAIN JAVASCRIPT
 *
 * The CLI is plain Node and cannot import TypeScript: CI pins Node 22, which
 * does not strip types. The product is TypeScript. A module both can import
 * therefore has to be `.mjs` — and it is type-checked all the same, by JSDoc
 * under `checkJs`, rather than described by a hand-written declaration file
 * that nothing would verify. An unchecked `.d.mts` asserting things about
 * integrity code is exactly the kind of decoration this repository keeps
 * finding in its own history.
 *
 * It uses Web Crypto and no Node APIs, so it runs unchanged in a browser, in
 * the Android webview, and in Node.
 *
 * @module
 */

/** Where the manifest lives inside an archive. */
export const MANIFEST_PATH = 'MANIFEST.txt';

/** The canonical record an archive exists to carry. */
export const CANONICAL_PATH = 'data/journey.json';

/**
 * Files every Journey export has carried since the format existed. Their
 * absence is damage, not an older variant.
 */
export const REQUIRED_PATHS = [
  'README.txt',
  MANIFEST_PATH,
  CANONICAL_PATH,
  'data/schema.json',
];

/**
 * A floor on what a pass may be based on.
 *
 * Every real export carries at least eleven files even with an empty journal.
 * A manifest listing three has not lost a file — it is something else wearing
 * the name, and "every checksum matched" over three files must not read as a
 * clean bill. See the floors rule in CLAUDE.md.
 */
export const MINIMUM_HASHED_FILES = 4;

/**
 * A manifest hash line: the SHA-256, the byte count, then the path.
 *
 * Written as `${hash}  ${String(size).padStart(9)}  ${path}`, so the runs of
 * whitespace vary in width. Nothing else in the file begins with 64 hex
 * characters, which is what keeps the prose above out of this.
 */
const HASH_LINE = /^([0-9a-f]{64})\s+(\d+)\s+(.*)$/;

/**
 * @typedef {object} ManifestClaim
 * @property {string} hash   lowercase hex SHA-256
 * @property {number} size   byte count
 */

/**
 * @typedef {object} ParsedManifest
 * @property {Map<string, ManifestClaim>} claims  path to what the manifest says about it
 * @property {string[]} duplicates                paths listed more than once
 */

/**
 * Read the hash lines out of a manifest.
 *
 * Deliberately tolerant about the prose around them — the header is for a
 * human in 2060 and may be reworded — and exact about the lines that carry
 * meaning.
 *
 * A path listed twice is reported rather than silently last-wins: two claims
 * about one file is itself a damaged record, and resolving it by picking one
 * would be guessing.
 *
 * @param {string} text
 * @returns {ParsedManifest}
 */
export function parseArchiveManifest(text) {
  /** @type {Map<string, ManifestClaim>} */
  const claims = new Map();
  /** @type {string[]} */
  const duplicates = [];

  for (const line of text.split('\n')) {
    const match = HASH_LINE.exec(line.trim());
    if (!match) continue;
    const path = match[3];
    if (claims.has(path)) {
      if (!duplicates.includes(path)) duplicates.push(path);
      continue;
    }
    claims.set(path, { hash: match[1], size: Number(match[2]) });
  }

  return { claims, duplicates };
}

/**
 * SHA-256 of some bytes, lowercase hex.
 *
 * @param {string | Uint8Array} content
 * @returns {Promise<string>}
 */
export async function sha256(content) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const digest = await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @typedef {object} IntegrityProblem
 * @property {'ARCHIVE_WAS_READ'|'STRUCTURE_INTACT'|'MANIFEST_AGREES'|'CHECKSUMS_MATCH'} assertion
 * @property {string} detail
 */

/**
 * @typedef {object} IntegrityResult
 * @property {boolean} ok
 * @property {number} examined            files actually hashed and compared
 * @property {IntegrityProblem[]} problems
 */

/**
 * Check an archive's files against its own manifest.
 *
 * Takes the archive already unzipped, as a list of `{ path, bytes }`, because
 * the two callers use different ZIP readers on purpose — the app's own, and
 * an independent one in the CLI. What must not differ is this: the grammar,
 * the hashing, and the rules below.
 *
 * Duplicate paths in the ARCHIVE are rejected too. A second member with the
 * same name is ambiguity a reader resolves by luck, and one of the two can
 * carry the manifest's blessing while the other is what gets read.
 *
 * @param {{ path: string, bytes: Uint8Array }[]} files
 * @returns {Promise<IntegrityResult>}
 */
export async function verifyArchiveManifest(files) {
  /** @type {IntegrityProblem[]} */
  const problems = [];
  /**
   * @param {IntegrityProblem['assertion']} assertion
   * @param {string} detail
   */
  const fail = (assertion, detail) => problems.push({ assertion, detail });

  /** @type {Map<string, Uint8Array>} */
  const byPath = new Map();
  const seen = new Set();
  for (const file of files) {
    if (file.path.endsWith('/')) continue;
    if (byPath.has(file.path) && !seen.has(file.path)) {
      seen.add(file.path);
      fail('MANIFEST_AGREES', `${file.path}: the archive carries this path more than once`);
    }
    if (!byPath.has(file.path)) byPath.set(file.path, file.bytes);
  }

  for (const path of REQUIRED_PATHS) {
    if (!byPath.has(path)) fail('STRUCTURE_INTACT', `missing ${path}`);
  }

  const manifestBytes = byPath.get(MANIFEST_PATH);
  if (!manifestBytes) {
    return { ok: false, examined: 0, problems };
  }

  const { claims, duplicates } = parseArchiveManifest(new TextDecoder().decode(manifestBytes));
  for (const path of duplicates) {
    fail('MANIFEST_AGREES', `${path}: listed more than once in ${MANIFEST_PATH}`);
  }

  if (claims.size < MINIMUM_HASHED_FILES) {
    fail(
      'ARCHIVE_WAS_READ',
      `${MANIFEST_PATH} lists ${claims.size} hashed files, fewer than the ${MINIMUM_HASHED_FILES} every export carries`,
    );
  }

  let examined = 0;
  for (const [path, claim] of claims) {
    const bytes = byPath.get(path);
    if (!bytes) {
      fail('MANIFEST_AGREES', `${path}: listed in ${MANIFEST_PATH}, absent from the archive`);
      continue;
    }
    examined += 1;
    if (bytes.length !== claim.size) {
      fail('CHECKSUMS_MATCH', `${path}: size ${bytes.length}, ${MANIFEST_PATH} says ${claim.size}`);
      continue;
    }
    if ((await sha256(bytes)) !== claim.hash) {
      fail('CHECKSUMS_MATCH', `${path}: checksum does not match ${MANIFEST_PATH}`);
    }
  }

  // A file added after the manifest was written is damage too, and hashing
  // only what the manifest names would never see it.
  for (const path of byPath.keys()) {
    if (path === MANIFEST_PATH) continue;
    if (!claims.has(path)) {
      fail('MANIFEST_AGREES', `${path}: present in the archive, not listed in ${MANIFEST_PATH}`);
    }
  }

  return { ok: problems.length === 0, examined, problems };
}
