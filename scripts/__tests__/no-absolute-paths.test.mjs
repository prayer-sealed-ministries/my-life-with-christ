import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * No machine-specific absolute path may be committed.
 *
 * A file written by copying from a scratch directory can keep an absolute
 * import that resolves perfectly on the machine that wrote it and nowhere
 * else. Typecheck, lint and the whole test suite pass locally; CI fails on
 * every job at once.
 *
 * That happened here, so it is now checked. The file LIST comes from git, so
 * only tracked files are examined, but the CONTENT is read from the working
 * tree — the point is to catch it before it is committed, not after.
 */

const HOME_LIKE = /(^|[^\w])(\/Users\/|\/home\/|C:\\\\Users\\\\)/;

function trackedSourceFiles() {
  // --others --exclude-standard includes new, not-yet-added files: a file
  // written by copying from a scratch directory is exactly the risky case, and
  // it is untracked at the moment the mistake is made.
  const output = execSync(
    'git ls-files --cached --others --exclude-standard src scripts tests .github',
    { encoding: 'utf8' },
  );
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => /\.(ts|tsx|mjs|js|json|yml|yaml|css|html|sh)$/.test(path));
}

describe('committed source carries no absolute paths', () => {
  const files = trackedSourceFiles();

  it('found files to check', () => {
    // Without this the check passes by looking at nothing — the same failure
    // mode the floors exist to prevent.
    expect(files.length, 'git ls-files returned nothing').toBeGreaterThan(50);
  });

  it('has no path rooted in somebody home directory', () => {
    const offenders = [];

    for (const path of files) {
      const content = readFileSync(path, 'utf8');
      content.split('\n').forEach((line, index) => {
        if (HOME_LIKE.test(line)) offenders.push(`${path}:${index + 1} — ${line.trim().slice(0, 100)}`);
      });
    }

    expect(offenders.join('\n')).toBe('');
  });
});
