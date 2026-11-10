#!/bin/sh
# Test tooling, never shipped. Runs inside the sandbox container only. It runs each gate under a virtual screen, one step at a time so
# that a failed step does not hide the later ones, then the four machine-dependent tests with the inventory reporter. The records
# (a JSON file for each step, the step logs, the reporter output) stay in /out for `docker cp`.
# The e2e step runs Playwright directly and not through tools/gates.mjs, because that tool stops an e2e step at 30 minutes and the
# full e2e run in a container takes longer. This script sets its own limit of three hours.
# Exit 0 only when every gate passed and the four tests passed.
set -u
if [ "$(id -u)" != "0" ] || [ -z "${BOWERLOOM_SANDBOX:-}" ]; then echo "in-container.sh: refusing to run outside the sandbox container" >&2; exit 2; fi
mkdir -p /out/logs
# Bowerloom refuses a project folder that other users can write to. /tmp is mode 1777, so give the tests a private temp folder, as a person's own temp folder is on macOS.
mkdir -p -m 700 /root/tmp
export TMPDIR=/root/tmp
echo "== gates, one step at a time, all inside the container"
failed=0
files=""
for step in root-typecheck root-test desktop-typecheck desktop-test; do
  node tools/gates.mjs --only "$step" --json > "/out/gates-$step.json" 2> "/out/gates-$step.stderr" || failed=1
  files="$files /out/gates-$step.json"
done
cp .trellis/gates/*.log /out/logs/ 2>/dev/null
# shellcheck disable=SC2086
node tools/sandbox/summarize-gates.mjs $files || failed=1
echo "== desktop e2e, on a virtual screen"
(cd apps/desktop && npm run bundle > /out/logs/desktop-e2e-bundle.log 2>&1 \
  && PLAYWRIGHT_JSON_OUTPUT_NAME=/out/e2e.json timeout 10800 xvfb-run -a --server-args="-screen 0 1280x1024x24" \
     npx playwright test --config playwright.config.ts --reporter=list,json > /out/logs/desktop-e2e.log 2>&1)
node tools/sandbox/summarize-e2e.mjs /out/e2e.json || failed=1
echo "== the four machine-dependent tests"
if [ ! -d dist/tests ]; then npm run build > /out/build.log 2>&1; fi
node --test --test-timeout=120000 --test-reporter=./tools/inventory-reporter.mjs \
  packages/project-context/test/registered-folders.test.mjs packages/project-sync/test/portable-review.test.mjs \
  packages/project-context/test/discovery.test.mjs packages/skill-sources/test/remove-cache.test.mjs > /out/machine-dependent.jsonl 2> /out/machine-dependent.stderr
node tools/sandbox/machine-dependent.mjs /out/machine-dependent.jsonl
md=$?
echo "== gates failed: $failed, machine-dependent exit: $md"
[ "$failed" = "0" ] && [ "$md" = "0" ]
