#!/bin/sh
# Test tooling, never shipped. Runs inside the sandbox container only. Every step runs, also after a failure, so that one failed
# step does not hide the later ones. Steps 1 to 4 run one at a time through tools/gates.mjs. The e2e step runs Playwright directly,
# because that tool stops an e2e step at 30 minutes and the full e2e run in a container takes longer. Each long command has its own
# time limit. The records stay in /out for `docker cp`: one JSON file for each gates step, e2e.json, machine-dependent.jsonl, logs/.
# Exit 0 only when every step passed and the four machine-dependent tests passed.
set -u
OUT="${BOWERLOOM_SANDBOX_OUT:-/out}"
if [ "$(id -u)" != "0" ] || [ -z "${BOWERLOOM_SANDBOX:-}" ]; then echo "in-container.sh: refusing to run outside the sandbox container" >&2; exit 2; fi
mkdir -p "$OUT/logs"
# Bowerloom refuses a project folder that other users can write to. /tmp is mode 1777, so give the tests a private temp folder, as a person's own temp folder is on macOS.
mkdir -p -m 700 /root/tmp
export TMPDIR=/root/tmp
failed=0

echo "== gates, one step at a time, all inside the container"
files=""
for step in root-typecheck root-test desktop-typecheck desktop-test; do
  node tools/gates.mjs --only "$step" --json > "$OUT/gates-$step.json" 2> "$OUT/gates-$step.stderr" || failed=1
  files="$files $OUT/gates-$step.json"
done
cp .trellis/gates/*.log "$OUT/logs/" || echo "warning: could not copy the gates logs"
# shellcheck disable=SC2086
node tools/sandbox/summarize-gates.mjs $files || failed=1

echo "== desktop e2e, on a virtual screen"
pw=1
if (cd apps/desktop && timeout -k 30 1800 npm run bundle > "$OUT/logs/desktop-e2e-bundle.log" 2>&1); then
  # The specs hide every window by default, so that a run never shows a window on a person's screen. On Linux a hidden window under X11 gets no frames, so
  # a screenshot and the mouse wheel and hover of Playwright never finish. The screen here exists only in this container, so the windows are shown on it.
  (cd apps/desktop && BOWERLOOM_E2E_SHOW=1 PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/e2e.json" timeout -k 30 10800 xvfb-run -a --server-args="-screen 0 1280x1024x24" \
    npx playwright test --config playwright.config.ts --reporter=list,json > "$OUT/logs/desktop-e2e.log" 2>&1)
  pw=$?
else
  echo "desktop e2e: the bundle step failed. Last lines of its log:"; tail -n 20 "$OUT/logs/desktop-e2e-bundle.log"
fi
echo "$pw" > "$OUT/logs/desktop-e2e.exitcode"
[ "$pw" = "124" ] && echo "desktop e2e: Playwright timed out (exit code 124)"
[ "$pw" = "0" ] || { echo "desktop e2e: Playwright exit code $pw"; failed=1; }
node tools/sandbox/summarize-e2e.mjs "$OUT/e2e.json" --exit-code "$pw" || failed=1

echo "== the four machine-dependent tests"
if [ ! -d dist/tests ]; then
  if ! timeout -k 30 1800 npm run build > "$OUT/logs/build.log" 2>&1; then
    echo "build failed. Last lines of $OUT/logs/build.log:"; tail -n 20 "$OUT/logs/build.log"; failed=1
  fi
fi
MD_FILES="${BOWERLOOM_SANDBOX_MD_FILES:-packages/project-context/test/registered-folders.test.mjs packages/project-sync/test/portable-review.test.mjs packages/project-context/test/discovery.test.mjs packages/skill-sources/test/remove-cache.test.mjs}"
# shellcheck disable=SC2086
timeout -k 30 900 node --test --test-timeout=120000 --test-reporter=./tools/inventory-reporter.mjs $MD_FILES > "$OUT/machine-dependent.jsonl" 2> "$OUT/machine-dependent.stderr"
nodeexit=$?
node tools/sandbox/machine-dependent.mjs "$OUT/machine-dependent.jsonl" --node-exit "$nodeexit"
md=$?
echo "== gates failed: $failed, machine-dependent exit: $md"
[ "$failed" = "0" ] && [ "$md" = "0" ]
