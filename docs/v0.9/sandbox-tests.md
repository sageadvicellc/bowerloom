# Run the tests in a sandbox

One command runs every gate inside a Linux container. No test runs on your computer.

```
npm run sandbox:test
```

## Status today

The command is close to a gate, and it is not one yet. It can still exit 1 when a test fails by chance. Do not use the exit code as a release gate until the last item below is settled.

The last full run of `npm run sandbox:test` was on 2026-11-11, on the source of commit `865f96a6`, with the release branch merged in:

- Root typecheck and desktop typecheck passed.
- Root tests: 5839 passed, 0 failed, 216 skipped.
- Desktop unit tests: 2029 passed, 0 failed, 18 skipped.
- Desktop end-to-end tests: 303 tests, 274 passed, 0 failed, 29 skipped.
- The four machine-dependent tests all passed, as root.

That run exited 1 only because the end-to-end step skipped 29 tests against a ceiling of 27. The two extra skips are the close-guard specs, which cannot run off macOS. The ceiling is now 29, with the reason under "Skip ceilings".

Earlier runs on 2026-11-10 and 2026-11-11 failed on tests that fail by chance in the container: the lock race test (one lock slot collision in 600 tries), tests that need a new folder identity or distinct times on sibling folders, and close-guard specs that read the app after it quits. Each now passes or skips with its reason in the tables below. The lock race test still fails by chance, and the last item below covers it.

## What runs

The container runs these steps. All of them run, also after a failure.

1. Root typecheck.
2. Root tests.
3. Desktop typecheck.
4. Desktop unit tests.
5. Desktop end-to-end tests, on a virtual screen that exists only in the container. The windows are shown on that screen, because a hidden window gets no frames under Linux (see "What was done about each cause").
6. The four machine-dependent tests, with a short report of each.

Steps 1 to 4 run one at a time through `tools/gates.mjs`. Step 5 runs Playwright directly, with a limit of three hours. The gates tool stops an end-to-end step at 30 minutes, and a full run in the container takes longer. Each long command has its own time limit. A failed build, or a failed `npm run bundle` before the end-to-end step, stops nothing else. It fails the run and prints the end of its log.

Step 5 fails in these cases:

- `npm run bundle` fails, so Playwright does not start.
- Playwright exits with a code other than 0. Code 124 means the time limit stopped it.
- The report holds an error.
- A test was interrupted.
- The report holds fewer tests than the frozen end-to-end suite. That suite has 285 tests in `docs/v0.9/test-inventory.json`.
- The frozen count cannot be read. The summary then says "frozen count unavailable".

## How it stays off your computer

- The command on your computer runs only `docker`.
- The source is copied into the image. The container mounts no folder from your computer, so no test can write there.
- The container publishes no port, has no network, and cannot reach the Docker socket.
- Your home folder is not mounted.
- The container runs as root. Root is what lets the four machine-dependent tests run instead of skip.
- The container drops every capability except six: CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID and KILL. It blocks new privileges. It has a limit of 4096 processes and 8 GB of memory.
- The base image is pinned by tag and by digest.
- At the end of the run, the command removes the container. If the removal fails, the command prints a warning and the command to remove it yourself.

The network is on while the image builds, because the build installs the packages. It is off while the tests run.

## Options

- `--print-commands` prints the docker commands and runs nothing.
- `--out <folder>` copies the result files to a folder on your computer after the run.
- `BOWERLOOM_SANDBOX_LIMIT_SECONDS` sets the time limit of the whole container run. The default is 14400.

The `--out` folder must be a new folder, or an empty one. The command refuses these:

- A folder that holds files.
- `/` and your home folder.
- A link.
- A name that starts with a dash.
- A path with a `..` part.

A relative path counts from the folder where you run the command. The command checks the folder again right before the copy.

 It copies only the named result files, one by one, into a fresh folder inside `--out`. It removes any link or special file, then moves the files up.

The result files are `gates-<step>.json` for each of the four gates steps, `e2e.json`, `machine-dependent.jsonl`, and a `logs` folder.

Exit codes:

- 0: all steps passed.
- 1 or another code from the container: a step failed.
- 2: wrong use.
- 3: Docker is not available.
- 4: the image did not build.
- 5: the result files were not copied.
- 6: the time limit stopped the container.

## Start Docker first

If Docker is not running, the command stops and says so. Start Docker Desktop with `open -a Docker`. Wait until `docker info` works. Then run the command again.

## The four machine-dependent tests

Each skips on macOS and runs in the container:

- The path of more than 1024 bytes, in `registered-folders.test.mjs`.
- The case-sensitive P6 check, in `portable-review.test.mjs`.
- L5, the alias of `.bowerloom`, in `discovery.test.mjs`.
- The real owner check, in `remove-cache.test.mjs`.

## What cannot run here

The container is Linux, and it runs as root. These tests skip there, and each skip carries a reason. The run prints the reason.

- The packaged-app spec, because it needs a macOS build.
- The check of the Electron fuses on a built app.
- The launch of a macOS build.
- The macOS container guardian, its supervisor, its recovery collector and the Codex startup guardian. They read the macOS boot session and refuse every other platform.
- The tests that need a file mode to refuse a user. Root ignores modes.
- The tests that need a quick change to show in a file time, or a replaced folder to show as a new folder. The file system in the container stamps from a coarse clock and hands a freed inode to the next folder at once.
- Four close and quit specs that need macOS behavior.
- Two tests that depend on the Node version. They skip while the test runs.

Every skip of this work is listed in "Every skip this work added". They run on a Mac, for a user who is not root, on a file system with fine file times.

### What a green sandbox run does not cover

- **The root-skipped tests.** A green run does not cover the tests in "Skips for root". Each one checks a refusal that needs a file mode, and root ignores modes. They run on a Mac. A second pass of the same tests as a non-root user in the container is a follow-up. In this work, a non-root pass was used by hand to sort causes, and it is not part of the command.
- **A known limit of the file time and folder identity skips.** These tests skip: B5 of the context guard, tests 23 and 36 of the registered folders, B10 of the managed skills, the parent-change tests of `skills-cli`, the three `scan-cache` ordering tests, and S2 of the store. On a file system that reuses folder identity or has coarse file times, a replaced folder or a quick change can look unchanged to Bowerloom. The tests cannot show that Bowerloom tells them apart there. This work records that limit. It does not fix it.
- **The identity probe also answers true when the birth time is missing.** The probe compares device, inode and birth time. A file system that reports no birth time gives the same value twice, so a reused inode reads as the same identity.

## First full run

The first full run in the container, on 2026-11-10, did not pass. It found these:

- Root typecheck and desktop typecheck passed.
- Root tests: 5830 passed, 159 failed, 104 skipped.
- Desktop unit tests: 1959 passed, 17 failed, 4 skipped.
- Desktop end-to-end tests: 269 passed, 11 failed, 23 skipped.
- The four machine-dependent tests all passed.

This work started from that run. It ran the same tree again as a baseline. The numbers moved a little, because a few tests fail by chance. The baseline found 154 failing results in the root tests, which are 140 different test names, 17 failing desktop tests, and 15 failing end-to-end tests.

## What was done about each cause

Each failing test was sorted by cause. Two checks told root causes from the rest. A test that fails as root and passes for a non-root user in the same container is a root cause. A test that fails for both is a file system or Linux cause. The counts below are different test names in the baseline run.

| Cause | Root | Desktop | End-to-end | What was done |
|---|---|---|---|---|
| Code that is macOS only: the boot session of the container guardian, its supervisor and collector, and the Codex startup guardian | 102 | 0 | 0 | The tests skip off macOS, with a reason. No Linux boot-session reader was added (see the decisions below). |
| Root ignores file modes | 30 | 13 | 0 | A test that needs a mode throughout skips as root, with a reason. A test that needs one in only one part is split, or built without the part, so the rest runs as root. |
| The file system has coarse file times or reuses a folder identity | 5 | 3 | 0 | The tests skip when a probe finds the file system too coarse, with a reason. The probe never answers true on macOS. The run prints the answers (see "The probes"). |
| Node 24.21.0 differs from the Node the tests were written for | 2 | 0 | 0 | One test skips while it runs. The other half of the other test still runs. |
| A fixture that depended on the machine | 1 | 1 | 0 | Fixed. A preload now waits for its output to drain. A test input is now really long. |
| The sandbox renamed Electron's binary, so every app counted as packaged | 0 | 0 | 4 | Fixed in the Dockerfile. |
| A hidden window under X11 gets no frames, so a screenshot, the wheel and hover never finish | 0 | 0 | 3 | The sandbox shows the windows on its own virtual screen. |
| Specs that need macOS: the native Quit action, the app staying alive with no window, and the close guard after the last window closes | 0 | 0 | 6 | The specs skip off macOS, with a reason. |
| Specs that read the page before it was drawn, or passed no screen to Electron | 0 | 0 | 4 | Fixed in the specs. No assertion changed. |

The totals are 140, 17 and 15. Nothing was deleted. No assertion changed to make a test pass. Where a test skips, the test body is as it was.

### Decisions for the maintainer

- **No Linux boot-session reader.** A reader of `/proc/sys/kernel/random/boot_id` would not make the container tests pass. The container launch refuses every platform but macOS in its own check (`MCP_CONTAINER_PLATFORM`), and so does the recovery collector (`TRUST`). A Linux reader would only turn on part of a feature that the product keeps off elsewhere. Two new tests pin part of the choice. `darwin-boot-session.test.mjs` shows that `readDarwinBootSession` refuses off macOS, and a new protocol test shows that codex-adapter `start` refuses `UNSUPPORTED_PLATFORM`. The other two refusals have no Linux test: `MCP_CONTAINER_PLATFORM` of the container launch, and the collector refusal. The macOS half of `darwin-boot-session.test.mjs` did not run in the sandbox.
- **Windows are shown in the sandbox.** The e2e step sets `BOWERLOOM_E2E_SHOW=1`. The screen exists only in the container, so nothing shows on your screen. The hidden mode of the specs is then not exercised in the sandbox: the specs that check it take their "watching" branch. The other way is to skip the three specs for hidden windows on Linux. That would also skip the wheel and hover checks of two product screens.
- **The Node version.** The sandbox pins Node 24.21.0, and the engines range is 24.11.0 to below 25. Two tests were written against an earlier Node 24. In 24.21.0 the child of `node --test` also gets `NODE_TEST_WORKER_ID`, and the proof guard in `tools/cli-distribution/installed-container-guard.mjs` refuses every `NODE_` variable except `NODE_TEST_CONTEXT=child-v8`. The guard is not changed here. A person on Node 24.21.0 would meet the refusal when they run that proof under `node --test`.
- **The skip kinds.** The frozen inventory (`docs/v0.9/test-inventory.json`) does not list these skips. Most skip only as root, off macOS, or on a file system with coarse times. The two Node-version skips fire on any system that runs Node 24.21.0, a Mac included. So the inventory check on a Mac does not see the first kind, and it can see the second. The sandbox does not run that check. If it did, each one would count as a skip that must run.

## Every skip this work added

Each row is one skipped test. A skipped test with subtests skips all of them. The helpers are in `tests/support/machine-skips.ts`.

The tables hold 136 different tests. One test, "an aside entry that cannot be removed does not stop the sweep of the older ones" in `apps/desktop/tests/scan-cache.test.ts`, is in two tables, because it needs a mode and fine file times. So the root and file time tables hold 41 + 9 rows, which are 49 different tests.

### Skips off macOS (74 tests)

Each test skips when the platform is not macOS, because the code it checks refuses every other platform. The reason text is "macOS only: the container guardian reads the macOS boot session and refuses every other platform (MCP_GUARDIAN_BOOT_UNKNOWN)" for the tests of the container guardian. The codex-adapter startup and protocol tests carry a reason of their own, written in the test file. The protocol test skips off macOS arm64: Linux and Intel macOS both skip. The helper is `needsMacOS` in `packages/mcp-connections/test/support/macos-only.mjs`.

Ten of these tests, three in `container-guardian.test.mjs`, six in `container-recovery-collector.test.mjs` and one in `container-guardian-provenance.test.mjs`, passed on Linux before only because the platform refusal fired first and the test expected a refusal. They skip now, so a pass here means the real code ran.

| File | Test |
|---|---|
| `packages/codex-adapter/test/protocol.test.ts` | invalid routes, cancelled signals, aliases and unpinned installation reject without any launch |
| `packages/codex-adapter/test/startup-deadline.test.ts` | real private guardian accepts one correctly bound synthetic Node fixture and verifies its acknowledgment |
| `packages/codex-adapter/test/startup-deadline.test.ts` | real guardian refuses expired, future-parent, wrong runtime/boot, tampered and duplicate startup before fixture spawn |
| `packages/codex-adapter/test/startup-deadline.test.ts` | controlled guardian rejects changed prompt and still reaps only its owned child |
| `packages/codex-adapter/test/startup-deadline.test.ts` | supervisor refuses a missing or mismatched controlled started acknowledgment and cleans its guardian |
| `packages/codex-adapter/test/startup-deadline.test.ts` | supervisor sends final post-fork parent sample and binds that exact transferred snapshot |
| `packages/mcp-connections/test/container-guardian-checkpoint.test.mjs` | checkpoint chain pins exact signed bytes, monotonic sequence and prior revision |
| `packages/mcp-connections/test/container-guardian-checkpoint.test.mjs` | terminal CAS refuses unseen normal commit, is exactly idempotent and prevents higher signed checkpoints |
| `packages/mcp-connections/test/container-guardian-checkpoint.test.mjs` | seal is domain separated and exact clean owned incarnation is required |
| `packages/mcp-connections/test/container-guardian-checkpoint.test.mjs` | rollback, checkpoint equality and newer local snapshots never assert latest state |
| `packages/mcp-connections/test/container-guardian-checkpoint.test.mjs` | fresh versioned inspection and private operator receipt preserve authority and falsify every effect flag |
| `packages/mcp-connections/test/container-guardian-checkpoint.test.mjs` | normal PostgreSQL checkpoint compares all authority bytes and invokes live checks under lock; reads create nothing |
| `packages/mcp-connections/test/container-guardian-checkpoint.test.mjs` | normal schema, async authorization, late commit acknowledgement and terminal audit remain fail closed |
| `packages/mcp-connections/test/container-guardian-checkpoint.test.mjs` | inspector fences changed database evidence and never accepts fabricated observations |
| `packages/mcp-connections/test/container-guardian-checkpoint.test.mjs` | lost final COMMIT acknowledgement returns uncertainty while immutable closure remains readable without changing authority |
| `packages/mcp-connections/test/container-guardian-provenance.test.mjs` | actual file and kernel boot inspection verifies historical signatures without freshness or PID authority |
| `packages/mcp-connections/test/container-guardian-provenance.test.mjs` | body, signature, operation and substituted key corruption refuse |
| `packages/mcp-connections/test/container-guardian-provenance.test.mjs` | different boot and unknown attach process remain held despite valid signature |
| `packages/mcp-connections/test/container-guardian-provenance.test.mjs` | legacy and missing journal/binding never receive retroactive provenance |
| `packages/mcp-connections/test/container-guardian-provenance.test.mjs` | authority/binding drift, file change, cross scope and database failure refuse |
| `packages/mcp-connections/test/container-guardian-provenance.test.mjs` | boot command is fixed and failed/ambiguous output cannot establish boot identity |
| `packages/mcp-connections/test/container-guardian-provenance.test.mjs` | binding uses full authority lock, immutable exact identity and explicit schema without authority update |
| `packages/mcp-connections/test/container-guardian-provenance.test.mjs` | binding refuses unavailable schema, live callback drift/async/mutation, corruption and lost commit acknowledgement |
| `packages/mcp-connections/test/container-guardian-provenance.test.mjs` | even signed malformed body shapes do not pass the verifier |
| `packages/mcp-connections/test/container-guardian.test.mjs` | unknown create result stays uncertain and never discovers or removes a container by name |
| `packages/mcp-connections/test/container-guardian.test.mjs` | corrupt persisted journal prevents rewriting ownership and prevents cleanup by guessed identity |
| `packages/mcp-connections/test/container-guardian.test.mjs` | mismatched inspected container identity never starts or removes that container |
| `packages/mcp-connections/test/container-guardian.test.mjs` | existing name collision is never adopted or removed, even when public labels can match |
| `packages/mcp-connections/test/container-guardian.test.mjs` | existing operation directory never resumes or retries creation |
| `packages/mcp-connections/test/container-guardian.test.mjs` | journal replaced by symlink is refused without touching its target |
| `packages/mcp-connections/test/container-guardian.test.mjs` | IPC forwarding checks absolute deadline even before the scheduled timer runs |
| `packages/mcp-connections/test/container-guardian.test.mjs` | monotonic lease is checked at IPC forwarding before a delayed expiry timer can run |
| `packages/mcp-connections/test/container-guardian.test.mjs` | live container loses authority when renewal stops, with exact owned cleanup and no redispatch |
| `packages/mcp-connections/test/container-guardian.test.mjs` | replayed and wrong-session renewal frames fail closed without extending authority |
| `packages/mcp-connections/test/container-guardian.test.mjs` | missing or delayed initial authority creates no container |
| `packages/mcp-connections/test/container-guardian.test.mjs` | repeated valid renewals cannot extend the original absolute deadline |
| `packages/mcp-connections/test/container-guardian.test.mjs` | queued renewal after its challenge expired is rejected before the expiry timer can run |
| `packages/mcp-connections/test/container-guardian.test.mjs` | real child-generated journal signature binds exact operation and independent public key |
| `packages/mcp-connections/test/container-guardian.test.mjs` | missing or wrong binding acknowledgement permits no Docker command |
| `packages/mcp-connections/test/container-guardian.test.mjs` | stop during CREATING fsync drains the write, seals CANCELLED and never requests create |
| `packages/mcp-connections/test/container-guardian.test.mjs` | missing, stopped and late checkpoint acknowledgements cannot create or resume |
| `packages/mcp-connections/test/container-guardian.test.mjs` | stop or lease expiry while STARTED checkpoint awaits acknowledgement cleans up without forwarding |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | collector reads actual private bytes and exact process/container queries while holding provenance unknown |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | actual ps observes this live test process without signaling it |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | present or failed process observations remain distinct and non-authorizing |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | Docker errors, wrong IDs, invalid text, flood and timeout never mean absence |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | missing operation directory and missing journal yield held reports and no read commands |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | symlink files, hardlinks, symlink operation ancestors and unsafe modes refuse before subprocesses |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | journal tampering and exact authority/launch mismatch refuse before Docker contact |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | file content, file identity, and ancestor replacement during observations invalidate the report |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | new journal appearance after an initial missing observation invalidates the report |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | final full-authority comparison detects concurrent changes and DB failure without clearing holds |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | active durable authority and external observation overrides are rejected |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | unresponsive trusted store has a bounded collection deadline and cannot resume host reads later |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | collector-owned persistence takes only fresh observations and retains uncertainty |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | collector persistence error, corrupt acknowledgement or post-commit journal change returns uncertainty |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | collector timeout cannot turn a late persistence completion into success |
| `packages/mcp-connections/test/container-recovery-collector.test.mjs` | v2 envelope normalization does not promote signature-shaped bytes into origin or host trust |
| `packages/mcp-connections/test/container.test.mjs` | container factory pins exact launch and deadline while exposing discovery only |
| `packages/mcp-connections/test/container.test.mjs` | launch changes, missing deadline, secrets and unsupported effects cannot fork a guardian |
| `packages/mcp-connections/test/container.test.mjs` | options and context getters stay inert; explicit trust and private canonical state root required |
| `packages/mcp-connections/test/container.test.mjs` | abort before or during queued filesystem preflight starts nothing |
| `packages/mcp-connections/test/container.test.mjs` | unsolicited data, invalid UTF8, duplicate keys, wrong IDs, extra envelopes and flood close safely |
| `packages/mcp-connections/test/container.test.mjs` | request timeout and local close observe pending rejection and require guardian closure |
| `packages/mcp-connections/test/container.test.mjs` | uncertain container absence or unreaped attach prevents successful close |
| `packages/mcp-connections/test/container.test.mjs` | method order and overlapping requests fail without tool calls or retry |
| `packages/mcp-connections/test/container.test.mjs` | stale connected IPC callback and synchronous errors never recursively cancel or leak |
| `packages/mcp-connections/test/container.test.mjs` | failed initial durable renewal opens no protocol session and cancels the owned guardian |
| `packages/mcp-connections/test/container.test.mjs` | renewal completion after cancellation never sends an authority response or protocol request |
| `packages/mcp-connections/test/container.test.mjs` | missing durable binding capability or failed acknowledgement never reaches a lease or protocol |
| `packages/mcp-connections/test/container.test.mjs` | binding completion after cancellation cannot start lease or protocol |
| `packages/mcp-connections/test/container.test.mjs` | checkpoint failure and delayed acknowledgement after stop never forward or reopen |
| `packages/mcp-connections/test/container.test.mjs` | terminal received with pending normal callback uses last acknowledged head and does not rebase |
| `packages/mcp-connections/test/container.test.mjs` | checkpoint callback getters are inert before guardian fork |

### Skips for root (41 tests)

Each test skips when the user is root. The reason text is "root ignores file modes, so this cannot refuse as the test expects:" followed by the last column. The helper is `skipAsRoot` in `tests/support/machine-skips.ts`. A test that needed a mode for only one part was split, so the rest runs as root; the new parts are in the rows below.

| File | Test | What the test needs |
|---|---|---|
| `apps/desktop/tests/engine-review-fixes.test.ts` | item 7: approval drafts that cannot be cleared after an install or a removal are a warning the window gets, and the write stays done | a drafts file in a folder at mode 500 cannot be kept |
| `apps/desktop/tests/engine-save-review.test.ts` | a save point that cannot be kept after a save is a warning in words that Go back has no entry for it, and is logged | a folder at mode 500 cannot take a write |
| `apps/desktop/tests/engine-save-review.test.ts` | a save that finished but left its journal is kept by the recovery: every file stays, the note is cleared, and the save points do not change | a state folder at mode 500 cannot lose its journal file |
| `apps/desktop/tests/engine-save-review.test.ts` | a save whose files are all written is taken back, not finished, when a file outside it changed since, so the recovery can never refuse for good | a state folder at mode 500 cannot lose its journal file |
| `apps/desktop/tests/engine-save-review.test.ts` | the mode of a save recovery is part of the plan shown: when a file outside the save changes after the plan, the run is refused as not the shown plan, and nothing changes | a state folder at mode 500 cannot lose its journal file |
| `apps/desktop/tests/engine-save-review.test.ts` | a finished save whose emptied folder came back with a .DS_Store is taken back, so the recovery never refuses for good, and no journal is left | a state folder at mode 500 cannot lose its journal file |
| `apps/desktop/tests/real-scan.test.ts` | step one counts what it could not read | a folder at mode 000 cannot be opened |
| `apps/desktop/tests/real-tool-home.test.ts` | rootDirs: only the named top-level folders are entered (any case), top-level files still count, and a folder left out is neither listed nor flagged | a folder at mode 000 cannot be opened |
| `apps/desktop/tests/real-tool-home.test.ts` | a link that leads outside, a folder that will not open, a file over 2 MB and a file that is not text are named too; five names at most, each one plain line of at most 80 characters | a folder at mode 000 cannot be opened |
| `apps/desktop/tests/scan-cache.test.ts` | a file that is a folder, or cannot be opened, is damaged and never throws | a cache file at mode 000 cannot be opened |
| `apps/desktop/tests/scan-cache.test.ts` | an aside entry that cannot be removed does not stop the sweep of the older ones, and is reported without a path | a folder at mode 500 cannot be deleted |
| `apps/desktop/tests/scan-fingerprint.test.ts` | a parent folder that cannot be listed cannot be told apart from its neighbours, so the check says it is not complete | a parent folder at mode 311 cannot be listed |
| `packages/adoption/test/save.test.mjs` | a journal that cannot be removed after a finished save is reported, and the save is not undone | a state folder at mode 500 cannot lose its journal file |
| `packages/adoption/test/save.test.mjs` | under umask 002, an undo that stopped part way and is run again finishes cleanly | a folder at mode 555 cannot lose a file |
| `packages/adoption/test/save.test.mjs` | under umask 002, a finish after an undo that stopped part way writes the steps it lists | a folder at mode 555 cannot lose a file |
| `packages/harness-definition/test/load.test.mjs` | silent 2: a file or folder that cannot be read is a problem, not a throw | a file and a folder at mode 000 cannot be read |
| `packages/notes-source/test/summary.test.mjs` | a folder that cannot be listed leaves the count incomplete, not wrong | a folder at mode 000 cannot be listed |
| `packages/project-authoring/test/team-adopt-unlisted.test.mjs` | H2. a read error of the recovery check propagates, and TEAM_EXISTS on the unlisted path names a next step | a team folder at mode 000 cannot be read |
| `packages/project-config/test/shared.test.mjs` | 7. an unreadable config counts as shared and does not throw | a git config at mode 000 cannot be read |
| `packages/project-context/test/discovery.test.mjs` | checkProjectPath refuses when macOS or permissions block the marker: lstat or realpath EACCES | a folder at mode 000 cannot be searched |
| `packages/project-context/test/discovery.test.mjs` | an unreadable folder on the way up refuses PROJECT_UNREADABLE instead of being skipped | a folder at mode 311 cannot be listed |
| `packages/project-context/test/store.test.mjs` | 18. a home folder at mode 0 throws STORE_UNREADABLE | a home folder at mode 0 cannot be read |
| `packages/project-sync/test/cache-admin.test.mjs` | M-A. a folder that cannot be deleted never blocks a rerun: a leftover goes last, and its refusal and cache list name the fix | a folder at mode 500 cannot be deleted |
| `packages/project-sync/test/cache-admin.test.mjs` | L3 (round 4). a .tmp- leftover that fails at the delete step names the .prune- folder it became | a folder at mode 500 cannot be deleted |
| `packages/project-sync/test/cache-admin.test.mjs` | L-2 (round 5). a blocked .prune- leftover goes after every leftover that can be deleted | a folder at mode 500 cannot be deleted |
| `packages/project-sync/test/portable-projection.test.mjs` | a failure part way rolls back every step, and leaves no receipt and no marker | a write into a folder at mode 555 cannot fail |
| `packages/project-sync/test/review-fixes.test.mjs` | F8. the stale check rethrows a store item it cannot read | a store item at mode 000 cannot be read |
| `packages/project-sync/test/review-fixes.test.mjs` | M2. an unknown shared state that causes a refusal says so honestly | a git config at mode 000 cannot be read |
| `packages/skill-sources/test/remove-cache.test.mjs` | 11. a folder that cannot be deleted refuses at the delete step, names the leftover and the inner path, and says how to fix it | a folder at mode 500 cannot be deleted |
| `packages/skill-sources/test/remove-cache.test.mjs` | 14. a leftover whose name holds a control character gets guidance, not a command | a folder at mode 500 cannot be deleted |
| `packages/skill-sources/test/remove-cache.test.mjs` | a cache entry holding a bidi-named folder that cannot be deleted names it on one line | a folder at mode 500 cannot be deleted |
| `packages/team/test/review.test.mjs` | T12: a file that cleanup cannot remove is reported with its path, and no success is claimed | a folder at mode 555 cannot lose a file |
| `packages/team/test/review.test.mjs` | T14: an unreadable team folder is told apart | a folder at mode 000 cannot be listed |
| `packages/team/test/review.test.mjs` | T14: a member folder that is unreadable is told apart | a folder at mode 000 cannot be listed |
| `tests/cache-cli.test.ts` | L-1 (round 5). a delete-step refusal gives a bare command as next and fix; run in a shell, it changes only the leftover | a leftover folder at mode 500 cannot be deleted |
| `tests/harness-review-fixes-cli.test.ts` | item 7: a draft that cannot be cleared after a good install is a warning in the result, not a failure | a drafts file in a folder at mode 500 cannot be kept |
| `tests/item-sources-cli.test.ts` | round 2. a store item file this user cannot read refuses lock update with its own Next: line | a file at mode 000 cannot be read |
| `tests/item-sources-cli.test.ts` | round 4. store migrate: an unreadable item has its own sentence | a skill file at mode 000 cannot be read |
| `tests/store-foundation-cli.test.ts` | 16. store status with the home folder at mode 0 prints Store: refused (STORE_UNREADABLE) and exits 0 | a home folder at mode 0 cannot be read |
| `tests/store-write-cli.test.ts` | 29. F6: a seed that fails after the pin is written says so in plain words for the store | a folder at mode 500 cannot take a write |
| `tests/store-write-cli.test.ts` | 34. F5: a store team folder that cannot be read is not "not found" | a team folder at mode 000 cannot be listed |

### Skips for coarse file times (9 tests)

The probe also checks two sibling folders made one after the other: on a coarse clock the second can carry the same change time as the first, so a sort by change time cannot tell which was made last.

Each test skips when a probe of the temporary folder finds that two quick changes can carry one timestamp. The probe never answers true on macOS. The helper is `skipOnCoarseFileTimes`. The reason text is "this file system gives two quick changes one timestamp, so the test cannot see" followed by the last column.

| File | Test | What the test needs |
|---|---|---|
| `apps/desktop/tests/scan-cache.test.ts` | a save keeps only the newest of the folders it moved aside, and leaves everything that is not one of them | which of several folders was made last |
| `apps/desktop/tests/scan-cache.test.ts` | an aside entry that vanishes between the listing and the look does not stop the sweep of the others | which of several folders was made last |
| `apps/desktop/tests/scan-cache.test.ts` | an aside entry that cannot be removed does not stop the sweep of the older ones, and is reported without a path | a folder at mode 500 cannot be deleted |
| `packages/managed-skills/test/v2-slice.test.mjs` | 14. readSliceTree throws MANAGED_SKILL_STALE_APPROVAL when a file changes during the read | a folder change when a file is added, or a file change when it is appended to |
| `packages/project-context/test/store.test.mjs` | S2: verifyStorePins re-checks the change time of store.json | store.json change when it is rewritten in place |
| `tests/skills-cli.test.ts` | a parent folder that changes once during the first read is read again once, then the command dispatches | the parent folder change when a file is added |
| `tests/skills-cli.test.ts` | a parent folder that changes during the check before dispatch is read again once, and the same value dispatches | the parent folder change when a file is added |
| `tests/skills-cli.test.ts` | a parent folder that keeps changing still refuses SKILLS_CHANGED after exactly one more read, with no dispatch | the parent folder change when a file is added |
| `tests/skills-cli.test.ts` | the record file changing during the first read refuses at once: only a parent change is read again | the record file change when it is rewritten |

### Skips for reused folder identity (4 tests)

Each test skips when a probe finds that a folder removed and made again at one path can come back with the same device, inode and birth time. The probe never answers true on macOS. The helper is `skipOnReusedFolderIdentity`. The reason text is "this file system gives a replaced folder the same inode and birth time, so the test cannot tell" followed by the last column.

| File | Test | What the test needs |
|---|---|---|
| `packages/managed-skills/test/v2-slice.test.mjs` | B10. planning refuses when the folder was replaced between the request and the read | a replaced wiki folder from the one it replaced |
| `packages/project-context/test/registered-folders.test.mjs` | 23. folder add refuses STALE_APPROVAL, and writes nothing, when the folder was replaced after the plan | a replaced folder from the one it replaced |
| `packages/project-context/test/registered-folders.test.mjs` | 36. folder allow refuses an unknown name, a folder that is gone or unsafe, and a stale plan | a replaced folder from the one it replaced |
| `tests/context-guard-cli.test.ts` | B5. a registered folder replaced by a new folder at the same path denies every call with GUARD_ROOT_MISSING | a registered folder replaced by a new folder from the one it replaced |

Both S6 tests (the catalog root of the managed skills, and the registered slices) no longer skip. A run in the container showed the new folder getting the id of the deleted one, although the probe said "not reused". Each test now renames the old folder aside instead of deleting it, so both folders exist at once and cannot share an inode. The assertions are unchanged. Nothing is deleted: the old folder is removed with the test fixture.

### End-to-end skips off macOS (6 tests)

Each spec skips through `test.skip(process.platform !== 'darwin', reason)`. The reason is in the spec.

| File | Test |
|---|---|
| `apps/desktop/e2e/harness-close-guard.spec.ts` | closing the window with a change: Discard closes it |
| `apps/desktop/e2e/harness-close-guard.spec.ts` | a window that stayed after Keep editing asks again at the next close, and Discard closes it |
| `apps/desktop/e2e/harness-close-guard.spec.ts` | Quit from the application menu (Cmd+Q) with a change asks, and no quit happens while the window refuses to close |
| `apps/desktop/e2e/harness-close-guard.spec.ts` | Quit from the application menu (Cmd+Q) with no change quits at once and asks nothing |
| `apps/desktop/e2e/harness-close-guard.spec.ts` | with no change, the window closes and no box appears |
| `apps/desktop/e2e/harness-close-guard.spec.ts` | a change that was undone asks nothing when the window closes |

### Skips for one direction (3 tests)

These tests check that other platforms refuse. The refusal test of `darwin-boot-session` skips on macOS. Its UUID test skips elsewhere. The protocol test skips on macOS arm64 only, because that platform passes the check it expects to fail.

| File | Test |
|---|---|
| `packages/codex-adapter/test/protocol.test.ts` | on a platform other than macOS arm64, start refuses UNSUPPORTED_PLATFORM before the pin check, and still refuses invalid routes and cancelled signals |
| `packages/mcp-connections/test/darwin-boot-session.test.mjs` | a platform other than macOS never reports a boot session: it refuses MCP_GUARDIAN_BOOT_UNKNOWN |
| `packages/mcp-connections/test/darwin-boot-session.test.mjs` | on macOS the boot session is one valid UUID, and the same on every read |

### Skips decided while a test runs

| File | Test | Why it skips |
|---|---|---|
| `packages/skill-sources/test/response-headers.test.mjs` | a guarded repeat after 1000 padding headers refuses, including when Node dropped the repeat | Node 24.21.0 keeps only 1000 header pairs, so the repeat at the end of 1004 pairs never reaches the guard. The test is split in two, with its assertions unchanged. The 1100-header half runs on every Node. |
| `tools/cli-distribution/test/installed-container.test.mjs` | real node --test subprocess permits only its exact child-v8 bookkeeping metadata | The child of `node --test` gets `NODE_TEST_WORKER_ID` too. The test probes the child first and skips with that reason. |

Tests that need a mode in one part only were narrowed, so that the rest runs as root. No assertion changed.

- `tests/item-sources-cli.test.ts`: the row "a file this user cannot read" of the round 2 test, and the unreadable half of the round 4 migrate test, are tests of their own that skip for root.
- `packages/team/test/review.test.mjs`: the two T14 tests are split into a missing part, which runs, and an unreadable part, which skips for root.
- `packages/project-context/test/store.test.mjs`: S2 is split. The mode, owner and size checks run. The check of a file rewritten in place skips on a coarse file system.
- `tests/harness-bundle-cli.test.ts`: only the step that reaches `BUNDLE_FILE_FAILED` needs a mode. For root the test skips that step, says so with `t.diagnostic`, and expects every other code.
- `apps/desktop/tests/real-scan.test.ts` and `real-map.test.ts`: the fixture leaves out its folder at mode 000 for root, so the redaction and counting checks run. The one assertion that counts that folder (`couldNotRead`) is a test of its own that skips for root.
- `tests/skills-cli.test.ts`: the parent change tests were not split. Every assertion in them needs a changed file time, and none needs root alone.

## Still failing, and what did not run

- **One end-to-end spec failed by chance, and its cause is not known.** `harness-compare.spec.ts`, "unticking an engine drops the notice and changes the count; an empty instruction or no tick disables Start". A `status` element stayed on the page. The spec passed four times in a row when run alone in the container. This work did not find out why it failed once in the full run.
- **One root test can fail by chance.** The lock race test in `packages/project-context/test/lock.test.mjs` asserts that four processes never meet a lock slot collision. It met one in 600 tries in one full run, and it did not in the next two runs. The test uses `node:test` directly, and not the retry wrapper that the other lock tests use, so it was not changed.
- **A tree of this size has more tests like the ones skipped.** Tests that replace a folder and expect a new identity pass or fail by chance on this file system. Repeated runs of 16 test files that do this found one more (S6 of the registered slices, now fixed by renaming the old folder aside). Other files were not repeated. A later run can find another.
- **The macOS half of this work did not run.** Nothing ran on a Mac, by design. The skips for root, file times, folder identity and the macOS-only code evaluate to false on macOS. The two Node-version skips do not: they fire on any system that runs Node 24.21.0. The macOS branch of `darwin-boot-session.test.mjs` has not run anywhere.
- **No second full run.** After the last two skips, the second run through the script stopped at the image build with an input and output error, because the disk of the host was full. The evidence for those two skips is the two root runs above.

## Skip ceilings

A skipped test is not a passed test, and the run cannot see a skip that a later change adds. So each suite has a ceiling, in `tools/sandbox/skip-ceilings.json`. The run exits 1 when a suite skips more tests than its ceiling.

| Suite | Ceiling | Why this number |
|---|---|---|
| `root-test` | 222 | 212 skipped in the last full run, 10 more for the guardian tests that passed only by refusal, and 1 for the item-sources test split off for root, less 1 for the bundle test that now runs as root. |
| `desktop-test` | 18 | 20 skipped in the last full run, less 1 for `real-map` and 1 for `real-scan`, which now run as root. |
| `desktop-e2e` | 29 | 27 skipped in an earlier full run, plus the 2 close-guard specs that now skip off macOS, because the app quits when its last window closes there. Measured: 29. |

A full run on 2026-11-11 measured 216 root, 18 desktop and 29 end-to-end skips, all at or under these ceilings. If a later run reports more, check why, and raise the number only when the extra skips are right.

To raise a ceiling, change the number in `skip-ceilings.json` and the count in this doc in the same pull request, and say why in the pull request. To lower one, do the same when tests stop skipping.

## The probes

Two probes in `tests/support/machine-skips.ts` decide which tests skip for the file system. The run prints their answers just before the end-to-end step, and writes them to `logs/probes.log`:

- The file time probe answers "coarse" when two quick changes can share one timestamp.
- The folder identity probe answers "reused" when a folder removed and made again can come back with the same device, inode and birth time. It also answers "reused" when the file system gives no birth time, because a missing birth time reads the same twice. The report prints whether the birth time was missing.

## If the build hangs

The credential helper of Docker Desktop can hang while the build pulls the base image. The command then prints nothing after "load metadata". Run the command with an empty Docker config folder that links to the same plug-ins and the same socket.
