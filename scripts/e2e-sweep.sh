#!/usr/bin/env bash
#
# Run the end-to-end suite against every data profile, one at a time, each on a
# freshly built bundle and a freshly started preview server.
#
# This exists because the ad-hoc version of it lied. Its first line was
#
#     rm -rf test-results playwright-report scratch/e2e-*.log
#
# and under zsh a glob that matches nothing aborts the command before it runs.
# So the cleanup silently did not happen, three legs reported green, and the
# summary said "fresh" about a directory that had never been cleared. Nothing
# downstream could tell, because a setup step that fails silently looks exactly
# like one that succeeded.
#
# Hence: -e so any failure stops the sweep, -u so an unset variable is an error
# rather than an empty string, -o pipefail so a failure inside a pipeline is not
# hidden by the exit status of the last command in it, no bare globs, and a
# count printed for everything removed so "cleared" is a measurement and not a
# claim.
#
# Usage: scripts/e2e-sweep.sh [profile ...]        (default: all three)

set -euo pipefail

cd "$(dirname "$0")/.."

PROFILES=("$@")
if [ ${#PROFILES[@]} -eq 0 ]; then
  PROFILES=(refs-only public)
fi

LOG_DIR="${E2E_SWEEP_LOG_DIR:-$(mktemp -d)}"
mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# Cleanup, counted.
# ---------------------------------------------------------------------------

clear_dir() {
  local dir="$1"
  if [ ! -e "$dir" ]; then
    echo "  $dir — absent, nothing to clear"
    return 0
  fi
  local before
  before=$(find "$dir" -type f | wc -l | tr -d ' ')
  rm -rf -- "$dir"
  if [ -e "$dir" ]; then
    echo "  $dir — FAILED to remove" >&2
    return 1
  fi
  echo "  $dir — removed, held $before file(s)"
}

echo "Clearing previous run artefacts:"
clear_dir test-results
clear_dir playwright-report

# `find -delete` rather than a glob: an empty match is not an error here, and
# a glob that matches nothing would abort the script under `set -e`.
stale_logs=$(find "$LOG_DIR" -maxdepth 1 -type f -name 'e2e-*.log' -print -delete | wc -l | tr -d ' ')
echo "  $LOG_DIR — removed $stale_logs stale sweep log(s)"

stop_preview() {
  # pkill exits 1 when nothing matched, which is the normal case and not a
  # failure. `|| true` keeps `set -e` from treating it as one.
  pkill -f 'vite preview' >/dev/null 2>&1 || true
  sleep 2
}

# ---------------------------------------------------------------------------
# The sweep.
# ---------------------------------------------------------------------------

declare -a SUMMARY=()
failed=0

for profile in "${PROFILES[@]}"; do
  echo
  echo "=== $profile ==="

  stop_preview

  echo "  building…"
  if ! DATA_PROFILE="$profile" npm run build > "$LOG_DIR/build-$profile.log" 2>&1; then
    echo "  BUILD FAILED — last 20 lines:" >&2
    tail -20 "$LOG_DIR/build-$profile.log" >&2
    SUMMARY+=("$profile: BUILD FAILED")
    failed=1
    continue
  fi

  built=$(find dist -type f | wc -l | tr -d ' ')
  echo "  built: $built file(s) in dist/"

  # CI=1 so Playwright starts its own server rather than reusing whatever is
  # already on the port — the whole point of the sweep is that each leg sees
  # the bundle just built for it.
  set +e
  CI=1 npm run test:e2e > "$LOG_DIR/e2e-$profile.log" 2>&1
  status=$?
  set -e

  reported=$(grep -Eo 'data profile under test: [a-z-]+' "$LOG_DIR/e2e-$profile.log" \
    | sed 's/.*: //' | sort -u | paste -sd, - || true)
  counts=$(grep -E '^ +[0-9]+ (passed|failed|flaky)' "$LOG_DIR/e2e-$profile.log" \
    | tr -d '\n' | sed 's/  */ /g' || true)

  echo "  suite reported profile: ${reported:-NONE}"
  echo "  result:${counts:- none parsed} (exit $status)"

  # The suite must say which profile it actually served, and it must be the one
  # asked for. A leg that tests the wrong bundle and passes is the failure this
  # whole sweep exists to make impossible.
  if [ "$reported" != "$profile" ]; then
    echo "  MISMATCH: asked for '$profile', suite served '${reported:-NONE}'" >&2
    SUMMARY+=("$profile: PROFILE MISMATCH (served '${reported:-NONE}')")
    failed=1
    continue
  fi

  if [ $status -ne 0 ]; then
    grep -E '✘|Error:' "$LOG_DIR/e2e-$profile.log" | head -20 >&2 || true
    SUMMARY+=("$profile: FAILED —$counts")
    failed=1
    continue
  fi

  SUMMARY+=("$profile: passed —$counts")
done

echo
echo "=== sweep summary ==="
for line in "${SUMMARY[@]}"; do
  echo "  $line"
done
echo "  logs: $LOG_DIR"

exit "$failed"
