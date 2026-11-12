# Modules view and read scope

Status: written with lane 2 of the v0.9 next phase. It records what the Modules view does, the rule for what a module may read, and the choices made where the spec was silent.

## Terms

- Module: a stock extension that ships inside the app. The view lists the bundled extensions that are not protected. It does not list itself.
- Place: a folder in the home folder that the person approved for one module.
- Read scope: the rule for what a module may read.

## The rule

The maintainer answered on 2026-11-11:

- A module reads only what the person picks. That is a project the person picked, plus places in the home folder that the person approved once for that module.
- Data stays on this computer.

A project the person picked is read through the engine calls, as before. Places are the new part.

## What the view does

- It is the bundled extension `modules`. Its route is `#app/modules`. `#app/modules/<id>` opens one module.
- It lists the modules from `listExtensions`, the same call the navigation uses.
- The module that is open runs inside the view. Local models is the first one. The page of Local models on its own route and its navigation entry stay as they were.
- Above the module, the view says what that module can read, lists its approved folders, and has two buttons: Approve a folder and Remove.
- The sample launch lists the modules and runs Local models. It keeps no approval, says so, and has no Approve button.

## How an approval works

1. The person presses Approve a folder. The page sends the module id only.
2. Main opens its own folder chooser, on the home folder. The pick is the approval. A cancel records nothing.
3. Main checks the pick. The folder must be below the home folder (the home folder itself is too wide), must have no hidden part, and must not be, hold or sit in the state folder of Bowerloom.
4. Main records the place once for that module in `<state>/module-scope/approved.json`. The record holds the home-relative path and a key of the real folder. It holds no full path.
5. The page sees an id, a label such as `~/Documents/notes`, and the day. Never a full path.

The record follows the approval model of linked notes folders (`docs/v0.9/context-items.md`): a private folder, owned by this user, not writable by others; a temporary file renamed over the old record; a damaged record moved aside under a dated name when the person next approves. The spec marks this reuse as inferred. It is not stated in the maintainer's notes.

Two differences from linked notes:

- An approval is for one module. The same folder approved for two modules is two approvals. Removing one leaves the other.
- The key is checked at each read. A folder swapped for another one (a shortcut) is no longer the approved folder: the read says `PLACE_CHANGED`.

## How a read works

`readModuleFile(moduleId, placeId, path)` is the only read. The decision is in `packages/module-scope`, in this order:

1. The module id and place id are well formed, and the record holds that place for that module. Otherwise `NOT_APPROVED`.
2. The place is still the same folder. Otherwise `PLACE_CHANGED`.
3. The path is one plain relative path: no `..`, no absolute path, no hidden part, no empty part. Otherwise `BAD_PATH`.
4. The real path of the file is inside the real path of the place. A link that leads out is `OUTSIDE_PLACE`.
5. The file is a regular file (`NOT_A_FILE`), at most 256 KiB (`TOO_LARGE`), and valid UTF-8 text with no NUL byte (`NOT_TEXT`). Any other failure is `UNREADABLE`.

The answer is the text or one code. It never holds a path.

## Limits

- 16 places for each module and 64 modules in the record.
- A record file over 128 KiB reads as damaged.

## Tests

- `packages/module-scope/test/scope.test.mjs`: the approval, the read gate, the swapped place, the damaged record.
- `packages/engine-api/test/module-calls.test.mjs`: the calls and the golden file `packages/engine-api/golden/module-calls.json`.
- `apps/desktop/tests/modules-ipc.test.ts`: main answers, and a module cannot read an unapproved place.
- `apps/desktop/tests/module-pick-pins.test.ts`: only `main/module-pick.ts` can approve, and the page cannot name a folder.
- `apps/desktop/tests/modules-bridge.test.ts`: the table, the preload, the client and the purity of the page.
- `apps/desktop/tests/modules-view-model.test.ts`, `modules-flow.test.ts`, `modules-screen.test.ts`: the words, the steps and the markup.
- `apps/desktop/e2e/harness-modules.spec.ts` and `harness-modules-no-bridge.spec.ts`.

## Choices made where the spec was silent

- The list of modules is the bundled extensions that are not protected. The spec says "the stock extensions". The six protected defaults are the work areas of the app and are not listed.
- The page of a module inside the view is a small table, `renderer/harness/modules/embeds.tsx`. It is not part of the manifest, because a manifest carries no code. It is marked "to align with lane 1" in the code.
- A module id is checked against the loaded, unprotected extensions on every call (`UNKNOWN_MODULE`). The module id is not a secret: the page names it, and main trusts only the list it holds.
- Places must be below the home folder and have no hidden part. The spec says "home-folder places". This keeps a module out of `.ssh` and similar folders.
- Local models reads no file. It shows the same read rule as every module, with no folder approved.

## Not done

- No module other than Local models runs inside the view. Lanes 3 to 5 add them.
- No real-mode end-to-end test of an approval. The chooser is a native window. The unit tests hold the bridge, main and the steps of the screen.
