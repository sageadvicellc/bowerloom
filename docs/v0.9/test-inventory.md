# Frozen test and skip inventory

Status: written for the v0.9 parity item ("What working means", item 6, of `carry-over-scope.md`). Base: `release/0.8.0-beta.2` at `5ca6df04`.

`test-inventory.json` lists every test file and every test name that ran at the base, with the skip list. Every number below comes from reporter output of a real run at the base. Nothing is a guess.

## What was run

- `root`: the `node --test` file list of the root `test` script, run through `tools/inventory-reporter.mjs`. The root build ran first.
- `desktop`: the `.build/tests/*.test.mjs` files of `apps/desktop`, bundled as the desktop `test` script does, run through the same reporter.
- `e2e`: `playwright test --reporter=json` in `apps/desktop`, with hidden windows, with no `CI` variable and no skip flag set, and with no build in `release/`.

## Counts at the base


- `root`: 264 files, 6065 tests, 6014 pass, 45 skip, 6 todo, 0 fixme, 0 fail.
- `desktop`: 149 files, 1957 tests, 1955 pass, 2 skip, 0 todo, 0 fixme, 0 fail.
- `e2e`: 48 files, 285 tests, 265 pass, 18 skip, 0 todo, 2 fixme, 0 fail.

The scope text names 142 desktop unit files and 48 end-to-end specs. The base reading is 149 desktop unit test files and 48 end-to-end specs. The cause of the difference in the unit file count was not checked.

## Skip kinds

The scope sorts every skip into two kinds. This inventory adds a third, because some skips fit neither.

- `never-runs-in-gate`: the skip depends on an environment flag, or the test is `fixme`. The names are frozen.
- `must-run-on-gate`: every other skip. It is not frozen as allowed. It is listed under `observedMustRun` so the check can fail on it.
- `needs-decision`: a skip the rule does not sort. Frozen by name until the maintainer decides its kind.

### Frozen, by suite

- `root`: 47 frozen skips (40 never-runs-in-gate, 7 needs-decision).
- `desktop`: 0 frozen skips (none).
- `e2e`: 19 frozen skips (19 never-runs-in-gate).

Root `never-runs-in-gate` skips come from files that read these variables: the `TRELLIS_*_PROOF` set, the `BOWERLOOM_MCP_*_PROOF` set, `BOWERLOOM_LIVE_ENGINES`, `BOWERLOOM_PACK_INSTALL_PROOF`, `BOWERLOOM_PACK_ONLINE_PROOF` and `BOWERLOOM_RELEASE_GATE`. The end-to-end ones come from `docs-shots`, `landing-shots` and `screen-tour-shots` (17 tests, flags `DOCS_SHOTS`, `LANDING_SHOTS`, `SCREEN_SHOTS`) and two `fixme` tests in journeys 1 and 5.

### Skips that must run on the gate machine

- `root`: `dist/tests/support/lock-slot-retry.js`: 20. a path of more than 1024 bytes below home refuses FOLDER_UNSAFE
- `root`: `dist/tests/support/lock-slot-retry.js`: P6: two definition files that differ only in case are refused (case-sensitive file systems only)
- `root`: `packages/project-context/test/discovery.test.mjs`: L5: an alias of .bowerloom beside the pinned folder is refused when the pins are checked
- `root`: `packages/skill-sources/test/remove-cache.test.mjs`: 3 (real owner). an entry that another user owns refuses CACHE_PRUNE_FAILED
- `desktop`: `.build/tests/launch.test.mjs`: the built app exits with code 2 and the words on stderr for a misspelled or retired flag, and opens no window
- `desktop`: `.build/tests/packaging.test.mjs`: the built binary has those fuses (checked when a macOS build is present)
- `e2e`: `apps/desktop/e2e/packaged-app.spec.ts`: the built app opens the harness-first app on the person's own folders, with no viewer, and keeps its data folder

### Findings

- Four root skips of the must-run kind are decided by the machine, not by a flag: the case-sensitive disk test, the over-long path test, the alias test, and the test that needs a second user (it skips unless the user is root, and the scope says the gate user is not root). On a macOS machine with the default disk they skip. The rule asks for zero skips of this kind, so the gate fails at the base on such a machine. The maintainer needs to decide: move them to `never-runs-in-gate`, or change the machine.
- `needs-decision` holds six `todo` tests in `packages/team/test/start.test.mjs` and one unconditional skip in `packages/fidelity/test/oracle.test.mjs`. The rule names no kind for either.
- The base run on this machine had 13 root tests fail in the first run, among them tests that take a project lock port and a process-group test. All 13 passed when their files ran again alone, so the inventory records them as passing. This shows a load flake in the root suite when it runs beside other work. It is a finding and not a fix.
- The tests that wrap their body in `tests/support/lock-slot-retry.ts` report that file as their file. The inventory keeps the reported file, so those names sit under `dist/tests/support/lock-slot-retry.js`.
- The packaged-app spec skipped because no build was in `release/`. `desktop:build` was not run for the inventory. The spec stays in the must-run list.

## The check

`tools/test-inventory.mjs` compares a run with the frozen inventory.

- `node tools/test-inventory.mjs check <root|desktop|e2e> <reporter output>` reads the output of `tools/inventory-reporter.mjs` (root, desktop) or of `playwright test --reporter=json` (e2e).
- It fails when a frozen test is missing, when a frozen test fails, when a test skips and is not frozen by name, when a frozen never-runs skip runs, and when a must-run test skips.
- A test that is not in the inventory is an addition. It passes the check, unless it skips or fails.
- It compares names and not only counts.
- `record` builds a suite entry from reporter output and a kinds file. The kinds file maps a file, or a file and a test name, to a kind and a reason.

Run against the three base recordings, the check reports exactly the seven must-run skips above and nothing else.

A change to a frozen name needs a named decision from the maintainer, as the scope says. The `mapped` option of `checkRun` carries those decisions: a frozen test listed there may be absent from a run.
