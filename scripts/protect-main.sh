#!/usr/bin/env bash
#
# Branch protection for main.
#
# What this sets, and what it deliberately does not:
#
#   required status check: data-gate    the gate must pass before a merge
#   force pushes:          blocked      history cannot be rewritten past a check
#   deletions:             blocked
#   enforce_admins:        FALSE        the owner can still push directly
#
# enforce_admins is false on purpose, and the consequence must be understood:
# it does not only mean the human owner can bypass. Anything pushing with the
# owner's token bypasses too, which includes every coding agent working on this
# repository. That is the party most likely to make the mistake the gate exists
# to catch.
#
# So the real protection is elsewhere, and it is deliberate:
#
#   .githooks/pre-push     runs the gate locally, before a bad commit exists.
#                          Does not care who or what is pushing.
#   pages.yml              gates the PUBLISHED ARTEFACT independently: verify
#                          runs before upload, deploy needs build, and the
#                          workflow-policy tests pin the profile.
#
# Branch protection guards main's history. pages.yml guards what the public can
# actually see. The second is the one that matters for the licensing risk.
#
# GitHub silently no-ops some protection fields depending on plan and
# visibility, so this reads the settings back and fails if what landed differs
# from what was asked for. Printing "success" without checking would be worse
# than not running at all.
#
# Usage: scripts/protect-main.sh [owner/repo]

set -uo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
BRANCH=main

echo "Protecting ${REPO}@${BRANCH}"
echo

if ! gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" --input - >/tmp/protect-write.json 2>&1 <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["data-gate"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
then
  echo "FAILED to write branch protection:"
  cat /tmp/protect-write.json
  exit 1
fi

# ---- Read back. What GitHub accepted is not always what was sent. ----

if ! gh api "repos/${REPO}/branches/${BRANCH}/protection" >/tmp/protect-read.json 2>&1; then
  echo "FAILED to read branch protection back:"
  cat /tmp/protect-read.json
  exit 1
fi

effective=$(node -e '
const p = JSON.parse(require("fs").readFileSync("/tmp/protect-read.json", "utf8"));
console.log(JSON.stringify({
  requiredChecks: p.required_status_checks?.contexts ?? p.required_status_checks?.checks?.map(c => c.context) ?? [],
  strict: p.required_status_checks?.strict ?? null,
  enforceAdmins: p.enforce_admins?.enabled ?? null,
  forcePushesAllowed: p.allow_force_pushes?.enabled ?? null,
  deletionsAllowed: p.allow_deletions?.enabled ?? null,
}));
')

echo "Effective settings, read back from GitHub:"
node -e "console.log(JSON.stringify(JSON.parse(process.argv[1]), null, 2))" "$effective"
echo

# ---- Assert the readback matches intent. ----

mismatches=$(node -e '
const got = JSON.parse(process.argv[1]);
const problems = [];

if (!got.requiredChecks.includes("data-gate")) {
  problems.push(`required check "data-gate" is NOT in effect (got: ${JSON.stringify(got.requiredChecks)})`);
}
if (got.strict !== true) problems.push(`strict status checks not enabled (got: ${got.strict})`);
if (got.forcePushesAllowed !== false) problems.push(`force pushes are ALLOWED (got: ${got.forcePushesAllowed})`);
if (got.deletionsAllowed !== false) problems.push(`branch deletion is ALLOWED (got: ${got.deletionsAllowed})`);
// enforce_admins is intentionally false; assert it is exactly that, not silently true.
if (got.enforceAdmins !== false) problems.push(`enforce_admins is ${got.enforceAdmins}, expected false`);

console.log(problems.join("\n"));
' "$effective")

if [ -n "$mismatches" ]; then
  echo "FAILED — GitHub did not apply what was requested:"
  echo "$mismatches" | sed 's/^/    /'
  echo
  echo "Some protection fields silently no-op depending on plan and repository"
  echo "visibility. Do not treat this branch as protected."
  exit 1
fi

echo "Verified: every requested setting is actually in effect."
echo
echo "Note: enforce_admins is false by design. The owner — and anything pushing"
echo "with the owner's token, including coding agents — can push past this check."
echo "The gate that does not depend on who is pushing is .githooks/pre-push,"
echo "and the gate on what the public can see is .github/workflows/pages.yml."
