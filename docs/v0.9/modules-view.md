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
3. Main checks the pick. The folder must be below the home folder (the home folder itself is too wide), must have no hidden part, must have no control or bidirectional character in any name, must be at most 512 characters from the home folder, must not be, hold or sit in the state folder of Bowerloom, and must not be in `~/Library`. Each refusal has its own code and words. A home folder that cannot be read is told apart from a pick that cannot.
   The window of the chooser names the module. Main takes the title from its own registry. The page does not give it.
4. Main records the place once for that module in `<state>/module-scope/approved.json`. The record holds the home-relative path and a key of the real folder. It holds no full path.
5. The page sees an id, a label such as `~/Documents/notes`, and the day. Never a full path.

If a damaged record is set aside during an approval, main logs it and the page is told (the notice says the old list was set aside). If the new list then cannot be written, the refusal is `RECORD_RESET_FAILED`, and the words say the old list was set aside. A failure carries only its cause class (an error code or name) in the log, never a message or a path.

The record follows the approval model of linked notes folders (`docs/v0.9/context-items.md`): a private folder, owned by this user, not writable by others; a temporary file renamed over the old record; a damaged record moved aside under a dated name when the person next approves. The spec marks this reuse as inferred. It is not stated in the maintainer's notes.

Two differences from linked notes:

- An approval is for one module. The same folder approved for two modules is two approvals. Removing one leaves the other.
- The key is checked at each read. A folder swapped for another one (a shortcut) is no longer the approved folder: the read says `PLACE_CHANGED`.

## How a read works

`readModuleFile(moduleId, placeId, path)` is the only read. The decision is in `packages/module-scope`, in this order:

1. The module id and place id are well formed. A damaged or blocked record is `RECORD_DAMAGED` or `RECORD_BLOCKED`. The record must hold that place for that module, otherwise `NOT_APPROVED`.
2. The place is still the same folder, otherwise `PLACE_CHANGED`. It must still pass every check of an approval (home, hidden, odd characters, state folder, Library), otherwise `NOT_APPROVED`.
3. The path is one plain relative path: no `..`, no absolute path, no hidden part, no empty part, no control, bidirectional or lone surrogate character. Otherwise `BAD_PATH`.
4. The real path of the file is inside the real path of the place. A link that leads out is `OUTSIDE_PLACE`. Every part of the real path inside the place must be plain too, so a link to `.env` or `.git` is `BAD_PATH`.
5. The file is opened without following a link and without blocking, and the opened file must be the one that was looked at. The real path is worked out again before the read. The file is a regular file, never a pipe or a device (`NOT_A_FILE`), at most 256 KiB (`TOO_LARGE`), and valid UTF-8 text with no NUL byte (`NOT_TEXT`). A home folder that cannot be read is `HOME_UNREADABLE`. Any other failure is `UNREADABLE`. After the second real path, the file at that path must still be the file that is open.

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

## Required before community extensions

These are not fixed, because stock extensions only load in this phase (decision D3 A). Fix both before any extension from outside the app can load.

- Module identity is the page's word. The page names the module id on every call, and main trusts any id of a loaded stock extension. Any module could name another module's id and use its approved folders. Main must bind each call to the extension that made it.
- The residual of the approval window. Main now names the module in the chooser from its own registry. The page still chooses which module id it asks for, so the window can name a module other than the one whose screen the person is looking at. This closes with the first item.

## Choices made where the spec was silent

- The list of modules is the bundled extensions that are not protected. The spec says "the stock extensions". The six protected defaults are the work areas of the app and are not listed.
- The page of a module inside the view is a small table, `renderer/harness/modules/embeds.tsx`. It is not part of the manifest, because a manifest carries no code. It is marked "to align with lane 1" in the code.
- A module id is checked against the loaded, unprotected extensions on every call (`UNKNOWN_MODULE`). The module id is not a secret: the page names it, and main trusts only the list it holds.
- Places must be below the home folder, have no hidden part, and not be in `~/Library`. The spec says "home-folder places". This keeps a module out of `.ssh`, application data and similar folders.
- Local models reads no file. It shows the same read rule as every module, with no folder approved.

## Not done

- No module other than Local models runs inside the view. Lanes 3 to 5 add them.
- No real-mode end-to-end test of an approval. The chooser is a native window. The unit tests hold the bridge, main and the steps of the screen.
