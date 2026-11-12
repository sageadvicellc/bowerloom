# Engine API library, stage 1

Stage 1 of lane L2 of the 0.9 scope. It adds a contract for the engine API, a golden file of the base, and tests that hold the app to both. It moves no engine code. Stage 2 does that.

Terms. The engine API is the set of calls the app window makes on the engine in the main process. The reader is the separate three-call API that looks at existing setups. The base is release commit `d4c8a478`. A refusal is an answer that says no, with a code.

## What the contract holds

The package is `packages/engine-api`. It holds data and two small functions.

- 39 engine calls and 3 reader calls (counted from the call lists of the base). Each has a name, an argument count, a wire channel, and a return kind.
- `chooseFolder` takes no argument and accepts one extra. The contract writes that as `optionalArgs: 1`.
- The engine call refusals: `NOT_ALLOWED`, `BAD_ARGUMENT`, `UNKNOWN_FOLDER`, `UNKNOWN_BUNDLE`, `FAILED`.
- The two named outcomes: `NOT_THE_PLAN_SHOWN` and `CANCELLED`.
- The refusals of main that come with words from a words table (17 at the base, counted from the `*_MAIN_WORDS` tables).
- The refusals of main that come with words written where they are made (`ENGINE_MAIN_ANSWER_REFUSAL_CODES`, 14 codes). The next section lists them.
- The steps a FAILED refusal can name in `refusal.step` (`ENGINE_REFUSAL_STEPS`, 5 words).
- The reader gate codes and the reader's own codes.

### How the extra refusal tables were decided

Each code in the golden file that sat in no table was read in the base source and put in exactly one class. The classification test holds this to the golden file.

- Main answer refusals, so in `ENGINE_MAIN_ANSWER_REFUSAL_CODES`: `NOT_THE_FOLDER_SHOWN`, `NOT_A_FOLDER`, `QUIT_BEGUN`, `EXPORT_TARGET_IN_HARNESS`, and the ten `START_*` codes. Main returns each of them as an `Answer` with words.
- Steps, so in `ENGINE_REFUSAL_STEPS`: `READ_TIMED_OUT` and the four `WORKER_*` causes. The base returns the code `FAILED` for these and puts the cause in `refusal.step`. They are not codes of their own. The contract `Refusal` type now has the optional `step` and `drift` fields that the base type has.
- Open package codes: a code with the prefix `ADOPTION_`, `PORTABLE_`, `SAVE_`, `EDIT_`, `VERSION_`, `NOTES_` or `BUNDLE_` that no table of the contract holds. Examples: `BUNDLE_USAGE`, `SAVE_STALE`, `NOTES_PATH_UNSAFE`.
- Known non-codes, listed by name in `packages/engine-api/test/classify.test.mjs`, each group with its reason:
  - `UNKNOWN_BUNDLE_HELD` is a mark between the worker and main. Main answers `UNKNOWN_BUNDLE` for it, so no window sees it.
  - `ERR_*` and `MODULE_NOT_FOUND` are Node error codes that the worker host reads.
  - `SECRET_VALUE` is a problem code of a definition file, shown inside a path line.
  - Environment variable names and made-up words inside sample text.

A literal in none of these classes fails the test. A literal in two classes fails it too.

The package imports nothing from `apps/desktop`, nothing from Electron, and no Node module that opens a port or starts a program. Types are restated, not imported.

Codes that come from other packages (`ADOPTION_*`, `PORTABLE_*`, `SAVE_*` and so on) are an open list. The contract fixes only their format.

## The module calls

Lane 2 of the v0.9 next phase adds a fifth bridge, `bowerloomModules`, with its own list and its own golden file. The 39 engine calls, the 3 reader calls and their golden file do not change. `callSpec` does not find a module call.

- `listModulePlaces(moduleId)`: the folders approved for one module.
- `approveModulePlace(moduleId)`: main opens its own folder chooser, and the pick is the approval. The page gives no folder.
- `revokeModulePlace(moduleId, placeId)`: removes one approved folder from the list of that module. It deletes no file.
- `readModuleFile(moduleId, placeId, path)`: reads one text file inside an approved folder.

The list is `MODULE_CALLS` in `packages/engine-api/src/calls.ts`. The refusal codes are `MODULE_CALL_REFUSAL_CODES`. `packages/engine-api/golden/module-calls.json` holds both, and `packages/engine-api/test/module-calls.test.mjs` compares the file with the code. `docs/v0.9/modules-view.md` says what the calls are for.

## The golden file

`packages/engine-api/golden/base-d4c8a478.json` was made by `packages/engine-api/scripts/make-golden.mjs`. The script reads these files as text and runs none of them:

- `apps/desktop/main/engine-*.ts` and `main/real-*.ts`
- `apps/desktop/shared/engine/*.ts` and `shared/real/*.ts`

The file lists every call with its argument count and channel, the refusal tables, every code-like literal in those files, and the SHA-256 of each file read. The scan reads comments too, so a few entries are not codes (an environment variable name, for example). The file records the full commit it came from.

The scan covers those globs under the rules in `scripts/scan.mjs` and nothing else. A code written anywhere else in the app is not seen. The scan throws when a folder, a file, a block or a table is missing, when a call has no argument count or channel, and when a list is empty. It never returns an empty result by accident.

To regenerate, check out the commit to describe and run this from the repository root:

    node packages/engine-api/scripts/make-golden.mjs --commit "$(git rev-parse HEAD)"

Add `--check` to compare the file on disk with the source without writing. `--check` needs the same `--commit`, because the file name comes from it. `npm run check:golden` runs it for the base commit. The script takes the commit as a flag because it starts no program, so it cannot ask git. Exit code 0 means written or equal. Exit code 1 means a difference, an unreadable source, or an empty list. Exit code 2 means a bad flag.

### Provenance

The `commit` field is a label. The script does not check it against git. What ties the golden file to the source are the SHA-256 hashes of the files it read. A test compares each hash with the live file. A file that differs fails the test with its file name until the golden file is made again. A file that is not listed, and a listed file that is gone, fail the same way. So a change to one of these files in a later stage means a new golden file, made on purpose.

### What the check does in each direction

- Calls and tables: the check goes both ways. An entry in the source and not in the golden file fails. An entry in the golden file and not in the source fails.
- Code literals: a literal added to the source must be in the golden file. A literal removed from the source may stay in the golden file, because the file is the record of the base and a removal needs a decision. The hash test above still fails when the file that held it changed.

## What the tests cover

- `packages/engine-api/test/contract.test.mjs` checks the contract is well formed and frozen.
- `packages/engine-api/test/golden.test.mjs` checks the golden file against the contract, in both directions. It checks that every code literal in the library source today is in the golden file, and the exact counts (39 engine calls, 3 reader calls, every table not empty). It checks that the source list equals the list of files in the golden file, and the hashes. It makes the scanner throw on a missing folder, block, file, argument count and channel. It runs `make-golden.mjs --check` as a child and expects exit code 0.
- `packages/engine-api/test/classify.test.mjs` holds every code literal of the golden file to exactly one class: contract refusal, open package code, or known non-code.
- `apps/desktop/tests/engine-api-contract.test.ts` imports the real lists and compares names, argument counts, channels, and refusals with the contract, including the `START_*` words and the worker causes. It also drives the reader handler with one argument too many and one too few.
- `apps/desktop/tests/engine-api-imports.test.ts` reads every file of the package with the tokenizer of the reader's static check. It rejects static imports, `export ... from`, `import()`, `require`, `createRequire`, Electron, `apps/`, and port modules, including `node:module` and `node:process`. The source of the package is also held to the banned names of that static check (`process`, `globalThis`, `eval`, `Function`, `binding`, `dlopen`, `fetch`, `WebSocket`, `Worker`, and string keys that name one). A link anywhere inside the package fails. One negative sample for each way round an import proves the checks can fail. A test of the package may start the golden check as a child. The source may not start a program.
- `apps/desktop/tests/engine-api-shape.test.ts` runs the shape suite on the sample engine. For each call it checks the call exists (found by name, so a class works), its declared parameter count, and that the answer fits the return kind or the call refusal codes. It checks that at least one call of each family (plan, read, save, export) answers `ok: true`, and that a stub whose every call throws or refuses fails that check. It checks that `runExport` with a wrong revision answers `NOT_THE_PLAN_SHOWN`.
- The same file drives `registerEngineIpc` (`main/engine-ipc.ts`) with a fake `ipc.handle`. It proves that one argument too many and one too few are refused with `BAD_ARGUMENT`, and that `chooseFolder` takes one extra argument. That test is where the wire count is held.
- The no-port spy is `apps/desktop/tests/helpers-engine/no-port-spy.ts`. Its self-tests are in `engine-api-shape.test.ts`. It wraps the routes of the repository's own deny list (`tests/helpers/deny.mjs`) that open a port or look up a name: the `net`, `tls`, `http`, `https`, `http2`, `dgram` and `dns` routes, `fetch` and `WebSocket`. It leaves out the routes that start a program, because a program is not a port. It calls `syncBuiltinESMExports()` after it patches and after it restores, so a named import sees the patch. A self-test fires every wrapped route, and some of them through a named import.

To run the suite on the real library later, call `defineShapeSuite` from `tests/helpers-engine/engine-api-shape.ts` with a factory for the real bridge. Leave `declaresEveryParameter` out: the suite then holds the real bridge to the exact parameter count.

What the suite does not cover. The sample has no dialogs, so `CANCELLED` is not reached. The sample declares fewer parameters than the contract on some calls (`recordCheck: () => ...`), so it passes `declaresEveryParameter: false`, and its parameter test says "takes at most N arguments". The exact count on the wire is held by `main/engine-ipc.ts` and proved by the wire test in `engine-api-shape.test.ts`.

## STAGE 2 PLAN

Facts below come from reading the base files. Anything not read is marked not checked.

### Files that serve the 42 calls

Engine calls (`apps/desktop/main`):

- `engine-ipc.ts` registers one handler per call. It routes `savedScan` and `checkSavedScan` to the kept-read tools and the other 37 to the service.
- `engine-service.ts` (1297 lines at this commit, counted with `wc -l`) is the service. It imports the other `engine-*` files plus `kit.ts` and `notes-report.ts`.
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

- About 46 test files import `main/engine-*` or `main/real-*`, and about 88 import `shared/engine` or `shared/real`. Counted with a text search for import lines in `apps/desktop/tests/*.test.ts` at this commit. Re-export files keep them green during the move.
- Path-keyed tests break on a move: `no-network.test.ts` (allow-lists by module path), `bundle-worker-static.test.ts`, `harness-words.test.ts`, and `real-static.test.ts` (it expects exactly three `real-*` files in `main/`).
- `tools/bundle.mjs` names `main/engine-bundle-worker.ts` as an entry in two places. The host finds the worker as `bundle-worker.mjs` beside the bundle. Both must follow the move.
- Moved files fall under the root `tsc`, whose config differs from `apps/desktop/tsconfig.json`. Whether the moved code compiles there is not checked.
- Relative paths to packages change depth. `project-context` imports `net`, and the no-port rule must still hold for the moved code.
- The shipped kits path comes from `main.ts` (`shippedKits`). Keep it injected.
- The renderer and preload import `shared/engine` types. Whether a `packages/` import suits their browser bundle is not checked.
