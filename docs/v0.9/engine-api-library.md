# Engine API library, stage 1

Stage 1 of lane L2 of the 0.9 scope. It adds a contract for the engine API, a golden file of the base, and tests that hold the app to both. It moves no engine code. Stage 2 does that.

Terms. The engine API is the set of calls the app window makes on the engine in the main process. The reader is the separate three-call API that looks at existing setups. The base is release commit `d4c8a478`. A refusal is an answer that says no, with a code.

## What the contract holds

The package is `packages/engine-api`. It holds data and two small functions.

- 39 engine calls and 3 reader calls. Each has a name, an argument count, a wire channel, and a return kind.
- `chooseFolder` takes no argument and accepts one extra. The contract writes that as `optionalArgs: 1`.
- The engine call refusals: `NOT_ALLOWED`, `BAD_ARGUMENT`, `UNKNOWN_FOLDER`, `UNKNOWN_BUNDLE`, `FAILED`.
- The two named outcomes: `NOT_THE_PLAN_SHOWN` and `CANCELLED`.
- The 17 refusals of main that come with words.
- The reader gate codes and the reader's own codes.

The package imports nothing from `apps/desktop`, nothing from Electron, and no Node module that opens a port or starts a program. Types are restated, not imported.

Codes that come from other packages (`ADOPTION_*`, `PORTABLE_*`, `SAVE_*` and so on) are an open list. The contract fixes only their format.

## The golden file

`packages/engine-api/golden/base-d4c8a478.json` was made by `packages/engine-api/scripts/make-golden.mjs`. The script reads these files as text and runs none of them:

- `apps/desktop/main/engine-*.ts` and `main/real-*.ts`
- `apps/desktop/shared/engine/*.ts` and `shared/real/*.ts`

The file lists every call with its argument count and channel, the refusal tables, every code-like literal in those files, and the SHA-256 of each file read. The scan reads comments too, so a few entries are not codes (an environment variable name, for example). The file records the full commit it came from.

To regenerate, check out the commit to describe and run this from the repository root:

    node packages/engine-api/scripts/make-golden.mjs --commit "$(git rev-parse HEAD)"

Add `--check` to compare the file on disk with the source without writing. The script takes the commit as a flag because it starts no program, so it cannot ask git.

## What the tests cover

- `packages/engine-api/test/contract.test.mjs` checks the contract is well formed and frozen.
- `packages/engine-api/test/golden.test.mjs` checks the golden file against the contract, in both directions. It also checks that every code literal in the library source today is in the golden file. A test removes one literal from a copy and expects a failure.
- `apps/desktop/tests/engine-api-contract.test.ts` imports the real lists and compares names, argument counts, channels, and refusals with the contract. It also drives the reader handler with one argument too many and one too few.
- `apps/desktop/tests/engine-api-imports.test.ts` reads every file of the package with the tokenizer of the reader's static check. It rejects static imports, `export ... from`, `import()`, `require`, `createRequire`, Electron, `apps/`, and port modules. Negative samples prove it can fail.
- `apps/desktop/tests/engine-api-shape.test.ts` runs the shape suite on the sample engine. For each call it checks the call exists, its declared parameter count, and that the answer fits the return kind or the call refusal codes. It also checks that `runExport` with a wrong revision answers `NOT_THE_PLAN_SHOWN`.
- The same file holds the no-port spy. It wraps `net.Server.prototype.listen`, `http.createServer`, `https.createServer`, `dgram.createSocket`, `net.connect` and `net.createConnection` during the suite. A negative test proves each wrapper fires.

To run the suite on the real library later, call `defineShapeSuite` from `tests/helpers-engine/engine-api-shape.ts` with a factory for the real bridge. Set `declaresEveryParameter: true` for it.

What the suite does not cover. The sample has no dialogs, so `CANCELLED` is not reached. The sample declares fewer parameters than the contract on some calls (`recordCheck: () => ...`), so the wire in `main/engine-ipc.ts` is where the exact count is held.

## STAGE 2 PLAN

Facts below come from reading the base files. Anything not read is marked not checked.

### Files that serve the 42 calls

Engine calls (`apps/desktop/main`):

- `engine-ipc.ts` registers one handler per call. It routes `savedScan` and `checkSavedScan` to the kept-read tools and the other 37 to the service.
- `engine-service.ts` (1297 lines) is the service. It imports the other `engine-*` files plus `kit.ts` and `notes-report.ts`.
- `engine-save.ts`, `engine-consent.ts`, `engine-events.ts`, `engine-state.ts`, `engine-bundle.ts`, `engine-bundle-host.ts`, `engine-bundle-work.ts`, `engine-bundle-worker.ts`, `engine-bundle-mark.ts`.

Reader calls: `real-ipc.ts`, `real-scan.ts`, `real-fs.ts`, and `safe.ts`. `scan-session.ts` and `scan-cache.ts` serve the kept read. `main.ts` wires them.

### Which import Electron or other apps/desktop modules

- Electron. In `main/`, `preload/` and `shared/`, only `main/main.ts` and `preload/real-preload.ts` import it. None of the `engine-*` or `real-*` files do. Electron reaches them through functions that `main.ts` passes in: `ipc`, `confirm`, the folder and file choosers, `openPath` and `writeClipboard`. The renderer was not checked.
- Node built-ins used: `fs`, `path`, `os`, `crypto`, and `worker_threads` (in `engine-bundle-host.ts` and `engine-bundle-worker.ts`).
- Other app modules. `engine-ipc.ts` and `real-ipc.ts` import `security.ts`, which re-exports `temp-data.mjs`. `real-scan.ts` imports `shared/world/sample.ts`. `scan-cache.ts` imports `shared/harness/real-map.ts`. The rest import `shared/engine/*`, `shared/real/*`, `kit.ts`, `notes-report.ts` and each other.
- Packages used: adoption, contracts, diagnostics, harness-bundle, harness-definition, notes-source, project-context, project-sync, skill-manifest. All by relative `../../../packages/...` paths.

### Proposed move order

1. Shared types and pure helpers: `shared/engine/*`, `shared/real/*`. Leave a re-export file in `apps/desktop/shared` so the renderer and tests keep working.
2. Leaf files that use only Node and packages: `safe.ts`, `kit.ts`, `notes-report.ts`, `engine-bundle-mark.ts`, `engine-state.ts`, `engine-events.ts`, `engine-consent.ts`, `engine-save.ts`.
3. The worker trio: `engine-bundle-work.ts`, `engine-bundle-host.ts`, `engine-bundle-worker.ts`.
4. `engine-bundle.ts`, then `engine-service.ts`.
5. The reader: `real-fs.ts`, `real-scan.ts`, `scan-cache.ts`, `scan-session.ts`.
6. Last, decide whether `engine-ipc.ts`, `real-ipc.ts` and `security.ts` move. They hold the sender check and the wire argument count, and they take Electron only as injected functions.

Run the shape suite and the contract tests after each step.

### Risks

- 45 test files import `main/engine-*` or `main/real-*`, and 89 import `shared/engine` or `shared/real`. Re-export files keep them green during the move.
- Path-keyed tests break on a move: `no-network.test.ts` (allow-lists by module path), `bundle-worker-static.test.ts`, `harness-words.test.ts`, and `real-static.test.ts` (it expects exactly three `real-*` files in `main/`).
- `tools/bundle.mjs` names `main/engine-bundle-worker.ts` as an entry in two places. The host finds the worker as `bundle-worker.mjs` beside the bundle. Both must follow the move.
- Moved files fall under the root `tsc`, whose config differs from `apps/desktop/tsconfig.json`. Whether the moved code compiles there is not checked.
- Relative paths to packages change depth. `project-context` imports `net`, and the no-port rule must still hold for the moved code.
- The shipped kits path comes from `main.ts` (`shippedKits`). Keep it injected.
- The renderer and preload import `shared/engine` types. Whether a `packages/` import suits their browser bundle is not checked.
