# Stage 1, macOS phase: results

Machine: macOS 27.2.1 (build 26B8132), Apple silicon (arm64).
Electron 44.10.2 (its own Node 24.22.2, Chromium 152.0.7977.169). System Node 24.11.0 runs the test runner.
Tauri CLI 2.12.5, Tauri crate 2.12.6, Rust 1.100.0. The system web view is WebKit 605.1.15.
Numbers marked "proposal" in the plan are not approved yet. They are the test values here: 10,000 events, 30 seconds, 5 seconds, 100 cycles, 100 runs.
Unless a section says otherwise, every run used no visible window and no dock icon.

All commands run from `spikes/tauri-stage1`. Build first with `npm run build` (the `npm test` script does it).

## Payload baseline (step 1)

- The biggest scan result is the reader's answer for step two (`RealResult`, built by `buildRealResult`). The reader's limits bound its size (`apps/desktop/shared/real/types.ts`): 200 places, 10,000 files per call, 20 MiB read per call, 2 MiB per file, 4,000,000 text characters whole and then 1,000 per text. A saved copy is capped at 24 MiB.
- The repository holds no large realistic input. Its one made-up home (`apps/desktop/tools/made-up-home.ts`) gives 9,572 bytes.
- So the baseline is a generated fixture (`src/fixture.mjs`) that follows the limits. Three shapes were measured in the Electron child process:
  - many-small: 199 projects x 50 skills, 2,000 bytes each (9,950 items): 16,928,305 bytes (16.14 MiB). Chosen as the baseline.
  - balanced: 199 x 25, 4,000 bytes (4,975 items): 10,475,530 bytes (9.99 MiB).
  - few-large: 100 x 10, 20,000 bytes (1,000 items): 5,317,966 bytes (5.07 MiB).
- Size is the UTF-8 bytes of `JSON.stringify(result)`. It varies by about 1% with the length of the temp folder path (16,725,305 bytes in the test run), because paths are inside the result.
- Not proven maximal: only skill files were generated. Agents, notes and tools share the same 10,000-item limit, so the true maximum is somewhat different.
- Command: `npm run payload`

## Gate 1 Part C on macOS (Electron child process: `utilityProcess`)

Result: PASS on every criterion that ran, for the arm64 build, in the dev Electron and in the packaged app (fuses as shipped). The x64 dmg and zip were not built, so Part C has no x64 result.
Command, dev Electron: `npm test` (15 unit tests, 11 Electron tests). Packaged: `npm run package && npm run test:packaged` (5 packaging tests, 11 Electron tests).
The core in the child is the shipped code: the reader and the engine service (which holds the plan shown last), bundled unchanged.

1. Ping: 1 sent, 1 returned. PASS.
2. Large payload (16,725,305 bytes, 9,950 items): returns whole, size and SHA-256 equal on both sides, 1.7 to 1.9 s. Small payload (65,151 bytes, 50 items) also whole. PASS.
3. Events: 10,000 sent, 10,000 received, in order, 0 duplicates, 0 missing. PASS.
4. 30-second limit (proposal): 3 calls. 1 returned in 1,003 ms. 2 failed with `FAILED` at 30,002 ms (one never answers, one child is stuck in a busy loop). Both children were replaced and answered a ping after. PASS. Note: a failing call takes 30,000 ms plus timer delay. The criterion needs the wording "at 30 seconds, plus 1 second". The test allows 1 s.
5. Kill-and-restart: 100 of 100 recovered, 100 of 100 within 5 s (proposal). Slowest 116 ms, median 112 ms (dev). Packaged: slowest 119 ms. 101 distinct child processes. PASS.
6. In-flight call: child killed with SIGKILL while a call ran. The call failed with `FAILED`. The call's side effect ran 1 time. The new child received 0 replays. PASS.
7. Plan state: plan shown in folder A then written (control: written, ok). Folder B: planned, child killed, restarted. A write with the old folder id returned `UNKNOWN_FOLDER`. After the folder was opened again, the write returned `NOT_THE_PLAN_SHOWN`, and folder B's files were unchanged. PASS. Findings: the state lives in the child, so a restart clears it. Folder ids restart from `folder-1`, so a stale id can name a different folder after a restart (the plan guard still refuses the write).
8. No orphan child: normal quit 1 of 1, `kill -9` of the main process 1 of 1, Electron crash (`process.crash()`, SIGSEGV) 1 of 1. In each, the child ended within 5 s. A normal quit without the host's own stop also ends the child (1 of 1). PASS.
9. Fuses: `node apps/desktop/tools/check-fuses.mjs "<packaged exe>"` prints `Fuses are as promised.` and exits 0. `runAsNode` and `enableNodeOptionsEnvironmentVariable` are off. The spike's `build` block equals the shipped one (parity test, 4 of 4). PASS.
10. Packaged installers (arm64 only), ad-hoc signed (`Signature=adhoc`, `TeamIdentifier=not set`, no hardened runtime):
    - zip extracted to a temp folder named `Ünïcode Späce ✓ dir`: child started, exit 0. PASS.
    - dmg mounted read-only, app copied to the same kind of path: child started, exit 0. PASS.
    - Built with the repo's own electron-builder 26.17.0. It downloaded its helper tools into `~/Library/Caches/electron-builder`: 7zip (8.1 MB) and the dmgbuild bundle (96 MB). The Electron arm64 zip was already cached.

## Tauri work

Dev dependencies of the spike, pinned exactly: `@tauri-apps/cli` 2.12.5 and `@tauri-apps/api` 2.12.5. The install also added the CLI's own binary package `@tauri-apps/cli-darwin-arm64`.
Rust crates: Tauri 2.12.6 and its dependencies (427 packages locked). The shell uses the standard library to run the sidecar, not the shell plugin. The Gate 3 crates are listed under Gate 3.
Cargo registry: 0 KB before the first build. After the first build, 177,600 KB (237 crates). After the Gate 3 crates, 215,300 KB (289 crates). The first build, with the download, took 19 s and stopped on a missing icon. Later builds took 6 to 15 s. Warnings: 0. The build output folder is 1.1 GB (ignored by git).
Bundle: 127.59 MiB. The shell binary is 14.5 MB. The sidecar is a copy of the repository's Node 24.11.0 runtime (112.1 MiB). The core script (1.7 MB) is a resource. This is the plan's second way to package Node.
Channel: the sidecar's stdin and stdout, one JSON line each way. Only the shell holds the pipe. No port is open (checked with `lsof`). The plan shown last lives in the sidecar, in the shipped engine service, next to the writes it guards.
Reproduce: `npm run build:tauri`, then `npm run test:tauri`.

### Gate 1 Part A on macOS (Tauri shell, Node sidecar)

Result: PASS on all 10 criteria.
- Core with no shell: 9 of 9 plain Node tests pass. They cover ping, 10,000 ordered events, bad input, exit on closed stdin, no port, the watchdog, and the saved read. File: `test/sidecar-core.test.mjs`.
- Ping 1 of 1. Large payload (16,725,305 bytes, 9,950 items) returns whole through the page, 1.9 s, size and hash equal. Small payload whole.
- Events: 10,000 sent, 10,000 received in the page, in order, 0 duplicates, 0 missing.
- 30-second limit (proposal): 1 call returned in 1,002 ms. 2 failed with `FAILED` at 30,007 ms. Both sidecars came back.
- Kill and restart: 100 of 100 recovered, 100 of 100 within 5 s (proposal). Slowest 124 ms, median 120 ms.
- In-flight call: `FAILED`, ran 1 time, 0 replays.
- Plan state: control write ok. After a restart the old folder id gives `UNKNOWN_FOLDER`. After the folder is opened again, the write gives `NOT_THE_PLAN_SHOWN`, and folder b is unchanged.
- Orphans: normal quit 1 of 1, `kill -9` of the shell 1 of 1, shell crash (abort, SIGABRT) 1 of 1. The sidecar ends because its stdin closes.
- Finding, then fix: a sidecar stuck in a busy loop did not read its stdin. After `kill -9` of the shell it was LEFT BEHIND (1 of 1 observed). The Electron utility process does not have this gap.
- Fix: a watchdog in a worker thread inside the sidecar (`src/stdio.ts`, Node only, no package). The worker reads stdin and polls the parent process id every 250 ms. On end of stdin or a changed parent it tells the main thread to exit. If the main thread has not exited after 1 s, the worker ends the process with SIGKILL.
- Time limit tested: 3 s (proposal, not approved).
- After the fix: 10 of 10 stuck sidecars ended after `kill -9` of the shell. Times in ms: 1010, 1018, 1012, 1008, 1011, 1011, 1009, 1010, 1009, 1006. Slowest 1,018 ms.
- Core tests with no shell: a busy core ended 1.4 s after its stdin closed. It also ended 1.4 s after SIGKILL of its parent. A healthy core answered 20 pings.
- Kill and restart before the fix: slowest 109 ms, median 107 ms. After it: slowest 124 ms, median 120 ms. The cost is about 12 to 15 ms per start, because a worker thread starts with the core.
- Command: `node --test --test-concurrency=1 test/part-a.test.mjs`.

### Gate 1 Part B on macOS, unsigned part

- B1 pass: the bundle holds the runtime beside the shell and the core script in Resources.
- B2 pass: the shell binary is ad-hoc, linker-signed. The bundle is not sealed. No team, no Developer ID.
- B3 and B4 pass (4 of 4 with B1 and B2). The app was copied to a folder named `Ünïcode Späce ✓ dir` under the system temp folder. The sidecar started and a ping returned (B3). A scan call returned whole (B4). Hidden window.
- Finding: the first run failed with `unknown path`. Tauri's `resource_dir()` fails for an app that sits under a symlinked folder, such as the temp folder under /var. Copies under a real path worked. The shell now falls back to the fixed bundle layout (`Contents/Resources`). Without this fallback the install check fails there.
- Notarized criterion: NOT RUN. It waits for the Apple spend decision. Gate 1 cannot pass for macOS until it runs.

### Gate 2 on macOS (WKWebView) and WebGL 2

macOS 27.2.1, WebKit 605.1.15 (the system WKWebView, and the user agent gives no finer number). The window was hidden for every test. No test needed a visible window.
Result: PASS, 6 of 6 (`node --test --test-concurrency=1 test/gate2.test.mjs`).
- 7 of 7 web features work: container queries, `:has()`, `color-mix`, `backdrop-filter`, `text-wrap`, `ResizeObserver`, Web Animations.
- Caveat: a hidden window gets no animation frames (`requestAnimationFrame` did not run, `visibilityState` = hidden). So Web Animations was tested by finishing the animation by hand, not by letting time pass. Natural playback is not verified. The plan's frame test is Linux only.
- Page scheme: `tauri://localhost`, secure context, not `file:`. PASS.
- CSP: an inline script, a remote script, a remote fetch and a remote image were each blocked (4 of 4, 5 violation events). One more violation shows the page's own IPC channel `ipc://localhost` is blocked by this policy, and Tauri falls back to another path. The real policy needs an `ipc:` rule.
- Permissions: geolocation `prompt` and the request returned an error (refused). Notifications `default` (not granted). `window.open` returned null. Clipboard: the permission state is not available in WKWebView (TypeError). Calling `navigator.clipboard.readText()` in the hidden window never answers and stops the page (observed, 60 s), so it was not used. So "clipboard refused" is only "not granted". The Electron app refuses every request through a handler. Here the refusal is WebKit's default, tested in a hidden window, and a visible window is untested. Camera and microphone were not asked, to avoid a system prompt.
- WebGL 2 (engine amendment proposal): PASS. Context made, vertex and fragment shaders compiled, program linked, one frame drawn, pixel read back [255, 0, 0, 255]. `WebGL 2.0`, renderer `Apple GPU`, GL error 0.

### Gate 3 on macOS

Packages, all from the npm registry and pinned exactly in the spike's `package.json`:
- `@wdio/tauri-service` 1.5.1 (5.5 MB on disk)
- `webdriverio` 9.31.9 (13.3 MB)
- `@wdio/cli` 9.31.9 (97,334 bytes unpacked), `@wdio/local-runner` 9.31.9 (33,293 bytes), `@wdio/mocha-framework` 9.31.9 (31,455 bytes)
- `@wdio/tauri-plugin` 1.5.1, the page-side package (39,417 bytes)
- The driver download scripts (edgedriver, geckodriver) did not run. `node_modules` is 159 MB.
- Version fix: `@wdio/cli`, the local runner and the mocha framework were first installed at 10.2.0 next to `webdriverio` 9.31.9. The Tauri service then failed in every spec (`before() failed ... reading 'bind'`). At 9.31.9 the error is gone.

Rust crates, behind one cargo feature `e2e` that only the test build turns on: `tauri-plugin-wdio` 1.5.1 (41.7 KB packed) and `tauri-plugin-wdio-webdriver` 1.5.1 (113.9 KB packed, the embedded WebDriver server), with their dependencies (axum, tokio, uuid, tracing and others). Registry: 289 crates, 215,300 KB.
The test build has its own page with a small screen (`tauri/page/e2e.js`). It has a capability that names the `wdio:default` and `wdio-webdriver:default` permissions. It turns `withGlobalTauri` on. It has a test-only folder answer (`pick_folder`). It builds into its own target folder with `npm run build:e2e`.

Release build check (the plan's Security item): `npm run check:release` reads the built release binary. It looks for 6 test-only markers. They are both plugin crate names in two spellings, the plugin command prefix, and `pick_folder`.
- Release binary: 0 of 6 found. PASS.
- Test binary (positive control): markers found, so the check can see them. PASS.
- The release capability file does not name a wdio permission. PASS.
- Test file: `test/no-e2e-in-release.test.mjs`, 4 of 4.

The slice: 8 spec files in `e2e/specs`, run with `npm run test:e2e` (embedded WebDriver provider, hidden window).
1. launch: the window has its title and the core becomes ready.
2. call path: a ping returns `pong`.
3. folder pick: the test-only switch answers the chooser with the fixture folder.
4. adoption plan: a plan revision and at least 1 approval show.
5. plan shown last: after the core restarts, the old plan gives `NOT_THE_PLAN_SHOWN`.
6. adoption run: the plan that was shown writes.
7. scan cache: nothing saved at first, a scan keeps its read (9 items), and the read is found after the core restarts.
8. close guard: with the guard on, a close request is held and asks, Stay keeps the window, and Leave ends the app. The runner's `onComplete` check proves the app and its core process ended.
Result of one run: 8 of 8 spec files pass, exit code 0, no process left behind.

Differences from the plan, stated plainly:
- The 8 specs run against a small test page, not the real screens. They test the same call path, the same shipped core code and the same refusal codes. They are not the 48 Electron specs.
- The folder pick is a Rust test-only command. It answers from environment variables. The plan's design is a native dialog answered from a fixture. The close guard question is a page element, not a native dialog.
- The service starts the app once, and the page keeps its state between spec files. Each spec reloads the page first.
- A runner fault: when a spec ends the app, the runner then fails to end its session. So Leave is pressed 4 s after the last spec ends, and `onComplete` does the check.

FLAKE_COUNT_PLACEHOLDER

Smoke check (unsigned release build, launch and normal quit): NOT RUN. It needs a visible window and an Accessibility permission for the harness app only.
- Harness: `Bowerloom Smoke Harness`, bundle id `com.sageadvice.bowerloom.smokeharness`, ad-hoc signed with a designated requirement that names only its identifier (`npm run build:harness`, `npm run test:harness`, 6 of 6).
- Its dry run through `open` reported parent process 1 (launchd), `trusted` false, and no Accessibility call.
- It has no crate dependency and no network symbol. It probes only the app it starts as its own child.

## What did not run

- The notarized Part B build. It waits for the Apple spend decision.
- The x64 dmg and zip of Part C.
- The Gate 3 smoke check, which waits for the Accessibility grant to the harness app.
- Gate 2 in a visible window: animation playback over time, and permission prompts.
- Camera and microphone permission checks, to avoid a system prompt.
- Gate 3 against the real screens and the 48 Electron specs.

Existing gates: root and desktop `typecheck`: 0 errors. Spike `typecheck`: 0 errors. Desktop `npm test`: 2,656 pass, 1 fail, in `tests/context-linked-notes.test.ts` ("a swapped shortcut needs a new pick": `rmSync` on a directory, `ERR_FS_EISDIR`). That test is outside this change and not touched. The repo has no `lint` script. Desktop `npm run build` was not run (it builds x64 too and nothing in the app changed).
