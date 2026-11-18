# Stage 1, macOS phase: results

Machine: macOS 27.2.1 (build 26B8132), Apple silicon (arm64).
Electron 44.10.2 (its own Node 24.22.2, Chromium 152.0.7977.169). System Node 24.11.0 runs the test runner.
Numbers marked "proposal" in the plan are not approved yet. They are the test values here: 10,000 events, 30 seconds, 5 seconds, 100 cycles.
Every run below used no window and no dock icon (activation policy `prohibited`).

All commands run from `spikes/tauri-stage1`. Build first with `npm run build` (the `npm test` script does it).

## Payload baseline (step 1)

- The biggest scan result is the reader's answer for step two (`RealResult`, built by `buildRealResult`). Its size is bounded by the reader's limits (`apps/desktop/shared/real/types.ts`): 200 places, 10,000 files per call, 20 MiB read per call, 2 MiB per file, 4,000,000 text characters whole and then 1,000 per text. A saved copy is capped at 24 MiB.
- The repository holds no large realistic input. Its one made-up home (`apps/desktop/tools/made-up-home.ts`) gives 9,572 bytes.
- So the baseline is a generated fixture (`src/fixture.mjs`) that follows the limits. Three shapes were measured in the Electron child process:
  - many-small: 199 projects x 50 skills, 2,000 bytes each (9,950 items): 16,928,305 bytes (16.14 MiB). Chosen as the baseline.
  - balanced: 199 x 25, 4,000 bytes (4,975 items): 10,475,530 bytes (9.99 MiB).
  - few-large: 100 x 10, 20,000 bytes (1,000 items): 5,317,966 bytes (5.07 MiB).
- Size is UTF-8 bytes of `JSON.stringify(result)`. It varies by about 1% with the length of the temp folder path (16,725,305 bytes in the test run), because paths are inside the result.
- Not proven maximal: only skill files were generated. Agents, notes and tools share the same 10,000-item limit, so the true maximum is somewhat different.
- Command: `npm run payload`

## Gate 1 Part C on macOS (Electron child process: `utilityProcess`)

Result: PASS on all criteria, in the dev Electron and in the packaged app (fuses as shipped).
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
    - Built with the repo's own electron-builder 26.17.0. It downloaded its helper tools into `~/Library/Caches/electron-builder`: 7zip (8.1 MB) and dmgbuild bundle (96 MB). The Electron arm64 zip was already cached.

Not run: the x64 dmg and zip. The Electron dist used is the arm64 one, and an x64 run needs Rosetta. The shipped app's own packaging is unchanged. The spike packages its own app with the same settings.

Existing gates: root and desktop `typecheck`: 0 errors. Spike `typecheck`: 0 errors. Desktop `npm test`: 2,656 pass, 1 fail, in `tests/context-linked-notes.test.ts` ("a swapped shortcut needs a new pick": `rmSync` on a directory, `ERR_FS_EISDIR`). That test is outside this change and not touched. The repo has no `lint` script. Desktop `npm run build` was not run (it builds x64 too and nothing in the app changed).
