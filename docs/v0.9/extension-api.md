# Extension API

Lane 1 of the v0.9 next phase. This page is the written API for an extension of the desktop app. It also describes the Extensions harness, the command that makes and checks an extension, and the template extension.

Terms. An extension adds one screen to the app. A manifest is the small JSON file that names an extension. A stock extension ships inside the app. Its screen is code in the app, and its manifest is a folder that ships beside the code. The engine API client is the one module that hands the page its calls (`apps/desktop/renderer/api/client.ts`). A route is the name in the page address that opens a screen.

Only stock extensions load in this version. The app loads no code from outside its own files. Community extensions wait for a later phase, after a security review of this API.

## What an extension is

An extension has two parts.

- A manifest folder: `apps/desktop/extensions/<folder>/manifest.json`. It tells the app that the extension exists, and which routes it owns.
- A screen: a React component under `apps/desktop/renderer/harness/`. It is compiled into the app. The mount table in `apps/desktop/renderer/harness/extension-mounts.tsx` links an extension id to its screen.

The manifest carries no code. No field of it names a file to run. The page leaves out an extension that has no screen in the mount table. The kit reports it as `NO_SCREEN`.

The registry (`apps/desktop/shared/extensions/registry.ts`) is the only route table. A route has one owner. The six default extensions own the 15 base routes and are protected. A stock extension owns the routes in its manifest and is not protected.

## The manifest

The file is `manifest.json`. It holds one JSON object with five fields. The check is `checkManifest` in `apps/desktop/shared/extensions/manifest.ts`.

- `id`: a name of lowercase letters, digits and hyphens. It starts with a letter or a digit. It has at most 64 characters. It is unique.
- `title`: the text shown in the navigation. It is not empty and has at most 120 characters.
- `kind`: the text `"ui"`. It is the only kind.
- `routes`: a list of 1 to 64 route names. Each name has the same shape as an `id`. No name appears twice.
- `protected`: `true` or `false`. A loaded extension must say `false`.

Other rules.

- A field that is not one of the five is dropped. The app never reads it. No field can name code to load.
- The file is UTF-8 text, with or without a byte order mark. It is at most 64 KiB (65,536 bytes).
- The `id` and the routes cannot be a default name. The next block lists the default names.
- The folder name is one plain name. It never holds two dots in a row (`..`) and never starts with a dot. It does not have to equal the `id`. The loader skips a folder whose name starts with a dot.
- A folder or a manifest file that is a link to a place outside the bundle is refused.

The default ids are these six.

```
overview  harnesses  library  projects  interfaces-history-help  first-run
```

The default routes are these 15.

```
welcome  choose  read  notes  overview  harnesses  builder  file
library  projects  runs  compare  interfaces  history  help
```

An example, from `apps/desktop/extension-template/manifest.json`:

```json
{
  "id": "extension-template",
  "title": "Extension template",
  "kind": "ui",
  "routes": ["extension-template"],
  "protected": false
}
```

## Routes and screens

A stock extension that has no route name of its own in the page is reached at the address `#app/extension/<route>`. The sample launch uses `#sample/extension/<route>`. The `<route>` is a route from the manifest.

- The page resolves `<route>` in the registry. If no extension owns it, the screen shows the state `ROUTE_NOT_FOUND`. It never shows a blank page.
- A route of a default extension never opens through this address. It shows `ROUTE_NOT_FOUND` too.
- A route name in the address must match the shape of a manifest name. Any other address opens the harness list.
- The navigation shows one entry for each loaded extension that has a screen. The entry uses the title and the first route. It follows the Runs entry. When the extension is gone, the entry is gone.
- The screen gets the route as the page address named it, and the launch mode.

The Local models extension keeps its own route `local-models`. Its address is `#app/local-models`.

## What a screen reads

A screen reads only through the engine API client. The page makes the client once and hands each side down. A screen asks the tree for the side it needs.

- Reader side: three read-only calls that look at the person's tool folders (`apps/desktop/shared/real/types.ts`). A mount gets it as the `bridge` property. When the window has none, it is null.
- Engine side: 39 calls of the adopt, install and save sheets (`apps/desktop/shared/engine/types.ts`). A screen gets it from `useEngine()` in `apps/desktop/renderer/harness/engine.tsx`. When the window has none, it is null.
- Local side: two read-only calls with no argument, `localModels` and `listExtensions` (`apps/desktop/shared/api/local.ts`). A screen gets it from `useLocal()` in `apps/desktop/renderer/harness/local-models/local.tsx`.
- Runs side: five calls for the run record (`apps/desktop/shared/api/runs.ts`). A screen gets it from `useRuns()` in `apps/desktop/renderer/harness/runs-real/runs-session.tsx`.
- Modules side: five calls for the read scope of a module (`apps/desktop/shared/api/modules.ts`). They list, approve and remove the places a person approved for a module, list the markdown files in such a place by relative path without their contents (`listModuleFiles`), and read one text file inside such a place. A screen gets it from `useModules()` in `apps/desktop/renderer/harness/modules/modules-context.tsx` (`docs/v0.9/modules-view.md`).

The template reads one call: `listExtensions`. A call that fails gives an error. The screen turns the error into a short code with `refusalCode` (`apps/desktop/shared/api/calls.ts`). It never shows the message of an error.

A screen has no other way to the engine. It names no bridge, no channel, no transport and no Electron module. It calls no file function, no process function and no network function. It does not set the page title and does not listen for `beforeunload`. The client purity check holds every file under `apps/desktop/renderer/` to this (`docs/v0.9/client-purity.md`).

## How reads and writes are approved

Five layers approve what a screen does. All five apply to every extension.


The engine side holds write calls. The adopt, install and save sheets use them to change files on this computer. The reader, local and runs sides mostly read. The runs side writes the run record. A stock screen can reach any call of the sides. This section is about reads and writes alike.

1. Only stock extensions exist. A screen is code in a pull request. Review and the gates approve the code before it ships. The app loads no code from a folder, a download or a link.
2. A call must be one of the five sides. The lists of calls are frozen. The engine golden file `packages/engine-api/golden/base-d4c8a478.json` holds the 42 calls of the reader and engine sides. The files `packages/engine-api/golden/local-calls.json`, `run-calls.json`, `module-calls.json` and `module-list-calls.json` hold the local, runs and modules calls. `module-calls.json` holds four modules calls, and `module-list-calls.json` holds the fifth, `listModuleFiles`. The local golden file lists one call, `localModels`. The code (`apps/desktop/shared/api/local.ts`) has two, `localModels` and `listExtensions`. `listExtensions` was added after that golden file was written, and the golden file was not updated. This page does not change it. A new call changes a golden file. That change is a decision for the maintainer, and this API adds none.
3. The client purity test fails the build for any other path to the engine. A new extension is inside its reach as soon as its file is under `apps/desktop/renderer/`.
4. Main checks every call. It refuses a sender that is not the app page (`NOT_ALLOWED`). It refuses a wrong count or shape of arguments (`BAD_ARGUMENT`). The reader reads only places the person chose (`UNKNOWN_PLACE` for any other). An engine call names a folder id that main gave out (`UNKNOWN_FOLDER` for any other). The sender check does not tell one extension from another. Every extension screen runs in the app page, so every extension passes it.
5. The person sees what an extension shows. A screen reads data on this computer. It sends nothing out.

No extension is limited by this API. A read scope exists only inside the Modules view (`docs/v0.9/modules-view.md`): a module there reads only what the person picks, plus home-folder places the person approved once for that module. Generic `#app/extension/<route>` pages are not scoped. An extension on a generic route can ask any call of the sides, including the write calls. There is no write scope. A reviewer reads each screen for the calls it makes, and for the write calls most of all.

## Install and remove

Install and remove work on the manifest folder. When a folder is added or removed, nothing runs.

Where the app looks:

- In a packaged app: `<resources>/extensions`. The build copies `apps/desktop/extensions` there.
- In development: `apps/desktop/extensions`.

How an install goes:

1. Main registers the six default extensions.
2. The loader reads `<bundle>/extensions/<folder>/manifest.json` for each folder, in name order. It reads nothing outside the bundle.
3. The registry takes each valid manifest. It refuses a reserved name, a taken route, a second extension with the same id, and a protected manifest.
4. A bad extension never stops the app. A skipped folder or a refused manifest is written to standard error. When the launch has the local usage log, its code alone is also recorded there, with no name, no path and no manifest text.
5. The page asks `listExtensions` once at launch. If the call fails before the host starts, the page asks again after the normal refresh time. The page registers the screen of each listed manifest that has one.

To install the template, run `node tools/extension-kit.mjs install-template`. It copies the template manifest into the new folder `apps/desktop/extensions/extension-template`. The screen of the template is already in the app. At the next start, the route `extension-template` opens it.

How a removal goes:

- Run `node tools/extension-kit.mjs remove extension-template`. It deletes that one folder and nothing else.
- At the next start the loader finds no manifest. The registry holds no route for the extension. The address shows `ROUTE_NOT_FOUND`. The navigation entry is gone.
- The screen file and the line in the mount table stay. They are source code, and git holds them. The command prints this.
- The command renames the folder to a temporary name `.removing-` and 12 hex digits, inside `apps/desktop/extensions`. It checks the folder again before each delete and deletes only from that folder, with `manifest.json` last.
- A part-way failure gives `REMOVE_INCOMPLETE` and lists what remains. The loader skips a folder whose name starts with a dot, so the extension is no longer loaded. `check` and `list` report the leftover folder with `REMOVE_INCOMPLETE`.
- To finish, run `node tools/extension-kit.mjs remove` with the leftover folder name. Or delete the folder by hand.
- Node has no `unlinkat`, so a swap between the check and a delete is narrowed and not closed.
- The registry frees every route of the removed extension, so the next extension can take them.
- A default extension cannot be removed. The host refuses it with `PROTECTED`. The check fails closed: a registry that throws or gives a strange answer also gives `PROTECTED`.
- No button and no call lets a person remove an extension inside the running app. If one is added later, it must go through `uninstallExtension` in `apps/desktop/main/extension-host.ts`.

## Make an extension

The Extensions harness is one command: `tools/extension-kit.mjs`. It is listed in `tools/manifest.json`. It loads no code and edits no source file.

```
node tools/extension-kit.mjs new <id> [--title TEXT]
node tools/extension-kit.mjs check [<folder>]
node tools/extension-kit.mjs install-template
node tools/extension-kit.mjs remove <folder>
node tools/extension-kit.mjs list
```

Add `--json` to any command for one JSON object on standard output. The exit code is 0 for a done command. It is 1 for a refused command or a problem that `check` finds. It is 2 for wrong use.

The steps:

1. Run `node tools/extension-kit.mjs new weekly-notes --title "Weekly notes"`. It writes the manifest in the new folder `apps/desktop/extensions/weekly-notes`, and a screen file made from `apps/desktop/renderer/harness/extensions/ExtensionTemplate.tsx`. It never writes over a file. The `id` is also the route.
2. Add the two lines that the command prints to `apps/desktop/renderer/harness/extension-mounts.tsx`. The import goes with the other imports. The table line goes inside `BUNDLED_MOUNTS`.
3. Edit the screen. Keep to the rules in "What a screen reads".
4. Run `node tools/extension-kit.mjs check weekly-notes`. It reads the folder the way the app does and reports each problem with the code the app gives. When step 2 is not done, it adds `NO_SCREEN`.
5. Run the desktop tests. The client purity test reads the new screen with no further work.

The kit holds a copy of the manifest and loader rules, because it is plain JavaScript and cannot import the app. A test holds the copy equal to the real code (`apps/desktop/tests/extension-kit-parity.test.ts`).

## The tests

- `apps/desktop/tests/extension-template.test.ts` proves that the template installs, mounts a screen, reads through the client and removes cleanly. It proves that a bad manifest file is refused, that a removed extension leaves no route, and that the client purity check covers the screen.
- `apps/desktop/tests/renderer-client-purity.test.ts` reads every file under `apps/desktop/renderer/`.
- `apps/desktop/tests/extension-kit-parity.test.ts` holds the kit equal to the app.
- `tools/test/extension-kit.test.mjs` tests the kit and its command line.
- `apps/desktop/tests/extension-api-doc.test.ts` holds this page to the code. When a code is missing from the list below, it fails.

## Error codes

Each line gives one code and says what it means. A code that two groups share has a line in each group.

### The extension mechanism

The registry and the host give these. The list is `EXTENSION_CODES` in `apps/desktop/shared/extensions/types.ts`.

- `PROTECTED` The extension is part of the app, so an uninstall is refused. The host also gives it for an uninstall it cannot check.
- `UNKNOWN_EXTENSION` No registered extension has the id given to an uninstall.
- `BAD_MANIFEST` The manifest fails the check in "The manifest". The message says which rule.
- `ROUTE_TAKEN` A route in the manifest already belongs to another extension.
- `EXTENSION_EXISTS` An extension with the same id is already registered.
- `RESERVED` The id or a route is a default name, or the manifest says protected. A loaded extension can be neither.
- `MOUNT_FAILED` The app failed to make the mount of the extension, so the extension is not registered.

### The route

- `ROUTE_NOT_FOUND` No extension owns the route. The page shows this code on screen. It is a named state and not a crash.

### The loader

The loader skips a folder and gives one of these. The list is `SKIP_CODES` in `apps/desktop/main/extension-loader.ts`.

- `BAD_NAME` The folder name is not one plain name. It starts with a dot, or it has two dots in a row (`..`).
- `OUTSIDE_ROOT` The folder or the manifest file is a link to a place outside the bundle.
- `UNREADABLE` The loader failed to read the folder or the file. The message holds the system code.
- `NOT_A_FILE` The manifest path is not a regular file.
- `TOO_LARGE` The manifest is over 64 KiB, so it is not read.
- `NOT_JSON` The manifest is not valid JSON. The message gives the position and never the text.
- `BAD_MANIFEST` The manifest is JSON and fails the manifest check.
- `DUPLICATE` Two names point to the same real folder or the same real manifest file.

### The kit

These codes come from `tools/extension-kit.mjs`. The kit also repeats codes of the app. Where it does, the code means what the app code means. The kit is stricter than the app in four places, listed here.

- It refuses every link. The loader keeps a link that stays inside the bundle.
- It needs `routes` to include the `id`.
- It refuses a new `id` that does not start with a letter.
- It refuses a new title with a character that is not plain text.

- `BAD_ID` A new id is not a valid name or does not start with a letter. A folder name is not one plain name.
- `BAD_TITLE` The title for a new extension holds a quote, a brace, an angle bracket, a backtick, a backslash or a control character. It also refuses format and invisible characters, such as a zero-width space. It refuses non-ASCII space characters too.
- `NO_MOUNT_TABLE` The kit cannot read the mount table `BUNDLED_MOUNTS`, so it cannot say that any screen exists. The message names the cause: a missing file, an unreadable file (with the system code), or a file with no table.
- `ROUTE_MISMATCH` The routes of the manifest do not include the id, and the mount draws the screen only for the route that equals the id.
- `REMOVE_INCOMPLETE` A removal stopped part way. The message lists the files that remain and the leftover folder. `check` and `list` report that folder with this code.
- `BAD_TEMPLATE` The template screen does not hold exactly one title literal, so the kit cannot set a title safely.
- `NO_SCREEN` The manifest is valid and the mount table has no screen for its id, so the app does not register it.
- `NOT_A_TREE` The root is not the Bowerloom repository, or it is not an absolute path.
- `UNSAFE_PATH` A link or a folder in the way means the kit does not write or delete.
- `NOT_INSTALLED` No folder with that name is in `apps/desktop/extensions`.

A manifest field that the app drops is a warning, not a refusal. `check` and `list` give the warning `FIELD_DROPPED` with the field names, in text and in JSON. A warning does not fail a check.

### The reader side

The list is `READER_REFUSALS` in `apps/desktop/shared/api/calls.ts`.

- `NOT_ALLOWED` The sender of the call is not the app page.
- `BAD_ARGUMENT` The count or the shape of the arguments is wrong.
- `UNKNOWN_PLACE` The place is not one the reader listed.
- `TOO_MANY` The call named more places than the limit.
- `BUSY` Another look is still running.
- `NO_HOME` The reader says the home folder cannot be used. No call in main throws it in this version.
- `FAILED` Anything else. Main logs the class of the cause and the page never sees a message.
- `NO_BRIDGE` The window has no reader bridge. The page gives this word itself. Main never throws it.

### The engine side

The list is `ENGINE_CALL_REFUSALS` in `apps/desktop/shared/engine/types.ts`. Main also answers with named refusals that carry words. `docs/v0.9/engine-api-library.md` lists them.

- `NOT_ALLOWED` The sender of the call is not the app page.
- `BAD_ARGUMENT` The count or the shape of the arguments is wrong.
- `UNKNOWN_FOLDER` Main did not give out that folder id.
- `UNKNOWN_BUNDLE` The bundle is not held, because the worker restarted or the bundle was dropped.
- `FAILED` Anything else. Main logs the class of the cause and the page never sees a message.

### The local side

The list is `LOCAL_REFUSAL_CODES` in `apps/desktop/shared/api/local.ts`.

- `NOT_ALLOWED` The sender of the call is not the app page.
- `BAD_ARGUMENT` The call carried an argument. Both local calls take none.
- `HOST_NOT_STARTED` `listExtensions` ran before main started the extension host.
- `FAILED` Anything else. Main logs the class of the cause and the page never sees a message.

### The runs side

The list is `RUN_REFUSAL_CODES` in `apps/desktop/shared/api/runs.ts`.

- `NOT_ALLOWED` The sender of the call is not the app page.
- `BAD_ARGUMENT` The count or the shape of the arguments is wrong.
- `UNKNOWN_FOLDER` Main did not give out that folder id, or the folder is not there.
- `UNKNOWN_RUN` No record has that id.
- `RUN_LIMIT` The most runs are saved already.
- `STORE_DAMAGED` The saved file cannot be read, and nothing was written.
- `TOO_LONG` The instruction or the notes are over the limit.
- `FOLDER_CHARACTER` The folder name holds a character Bowerloom cannot use.
- `FOLDER_LINK` The folder is a link.
- `FAILED` Anything else. Main logs the class of the cause and the page never sees a message.

## What this version does not do

- It loads no third-party or community code.
- It changes nothing in the protection of the shell: the fuses and the policy stay as `docs/v0.9/packaged-app-spec.md` records them.
- It adds no call to the engine API. This lane leaves the golden files as they were. The files `module-calls.json` and `module-list-calls.json` are new: lane 2 added `module-calls.json` for the four modules calls, and lane 4 added `module-list-calls.json` for `listModuleFiles`.
- It has no read scope for generic extension routes. The read scope is part of the Modules view (`docs/v0.9/modules-view.md`).
- It has no uninstall inside the running app.
