/**
 * A check may only claim a pass if it actually ran.
 *
 * `verify-bundle.mjs` is shaped the way almost every check in this repository
 * is shaped — collect problems, assert the list is empty — and its summary used
 * to be five fixed `console.log` calls that printed whatever happened. One of
 * those five lines said "no .map files that could carry the original modules",
 * and the check behind it only ever ran for `refs-only`. A `public` build
 * carrying 112 source maps, one of which held the whole destructive debug
 * cleanup component, was therefore told it had none, and printed
 * "This build is publishable."
 *
 * The flaw was not the condition. It was that the claim and the check were two
 * separate pieces of code with nothing holding them together, so the claim
 * outlived the check without anybody having to be careless.
 *
 * This registry ties them. A summary line exists only as the value handed to
 * `ran()` by the code that performed the check, so an assertion that did not
 * execute has no line to print. And `missing()` names the required assertions
 * that never ran, which the caller raises as a failure — because a check that
 * examines nothing must fail as loudly as one that finds something.
 */

/**
 * @param {readonly string[]} required
 *   Every assertion the caller must make for its verdict to mean anything.
 */
export function createAssertionRegistry(required) {
  if (!Array.isArray(required) || required.length === 0) {
    throw new Error('createAssertionRegistry needs a non-empty list of required assertions');
  }

  const order = [...required];
  const executed = new Map();

  return {
    /** Every assertion this registry expects, in reporting order. */
    required: Object.freeze([...order]),

    /**
     * Record that `assertion` ran and passed, with the line it earns.
     *
     * An unknown name throws rather than being recorded: a typo would
     * otherwise register a passing assertion that nothing requires, and leave
     * the real one looking as if it never ran.
     */
    ran(assertion, summary) {
      if (!order.includes(assertion)) {
        throw new Error(
          `unknown assertion ${JSON.stringify(assertion)} — expected one of ${order.join(', ')}`,
        );
      }
      if (typeof summary !== 'string' || summary.trim() === '') {
        throw new Error(`assertion ${assertion} must describe what it checked`);
      }
      executed.set(assertion, summary);
      return this;
    },

    /** Did this assertion actually run? */
    didRun(assertion) {
      return executed.has(assertion);
    },

    /** Required assertions that never ran. Non-empty means the verdict is void. */
    missing() {
      return order.filter((assertion) => !executed.has(assertion));
    },

    /**
     * The lines a pass may print: one per assertion that ran, and nothing else.
     *
     * Returned as pairs rather than formatted text so the caller owns its own
     * layout, and so a test can assert on the claims themselves.
     */
    passLines() {
      return order
        .filter((assertion) => executed.has(assertion))
        .map((assertion) => ({ assertion, summary: executed.get(assertion) }));
    },
  };
}
