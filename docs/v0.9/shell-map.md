# Shell map of apps/desktop

Status: written for the v0.9 shell question. Read at commit `328dd90b` of `release/0.9.0-beta.1` (then named `release/0.8.0-beta.2`). Three open pull requests change parts of this map. Each item that depends on one says "after PR 171", "after PR 173" or "after PR 172".

This page sorts each part of `apps/desktop` into shell, core, API or page. It names each file that holds two sides. It changes no code. The only new code is one test, `apps/desktop/tests/shell-boundary.test.ts`, which holds the boundary of the main process, the preload and the page.

## Why this page exists

The maintainer answered question 7 of `carry-over-scope.md`: if the desktop shell moves from Electron to Tauri, the core and the API stay the home of the product ideas. The maintainer also chose the order: Electron first, Tauri after. The scope records both answers as relayed in chat.

So a later shell must write again only the shell code. This page says which code that is. A move to Tauri is not part of "v0.9 working". The scope lists it under "Not needed for working". This page is groundwork, not a plan to move.

## Terms

- Shell: code that names Electron, or exists only because of Electron. Examples are windows, menus, dialogs, the start of the main process, the bridge between the page and main, and packaging.
- Core: Node code that does the work. Examples are the engine service, the reader, the kits and the extension loader. It does not import Electron. It does need Node: it reads files, and the export and import work runs in a worker thread.
- API: the contract between the page and the core. It is 3 reader calls and 39 engine calls. Each call has a name, an argument count, a wire channel and refusal codes.
- Wire channel: the name of the message route that carries one call, such as `bowerloom-engine:planImport`.
- Page: the web page in `renderer/`. It runs in a browser engine and holds the screens. This page uses the word "page" for it because the code folder is named `renderer`.
- Main: the Electron main process. In this repository it starts in `main/main.ts`.
- Injected tool: a function that `main/main.ts` hands to core code, so the core can ask the shell for something. The core never imports the shell.
- Mixed file: a file that holds two sides. Each one is in "Mixed files".

## Decisions this page rests on

All are in `carry-over-scope.md` on `main`, except the last two.

- Question 7: if the shell framework changes, the core and the API stay the home of these ideas.
- The Tauri order: Electron first, Tauri after.
- Acceptance item 5: the shell keeps its protections. The scope words it this way. The fuses `runAsNode` and `enableNodeOptionsEnvironmentVariable` stay off. The content security policy, the permission refusal, the page scheme and the close guard work as at the base. The build sets seven fuses in all. See "Shell protections and the test that covers each".
- Acceptance item 3: the page reaches the engine only through one client. No page file reads the two bridges except the transport adapter. No page file imports Electron or a Node module.
- V9-9 and the split into core and optional parts. The pull request that records it is PR 172, still open. Its core list is the engine API, extension loading and protected extensions. Its examples of optional parts are windows, menus and local file access. In this map, windows and menus are shell. Local file access is not shell. Almost every core file uses it, so a host without it cannot run most calls.
- The Tauri plan, PR 163, a draft. It proposes a shell written in Rust and the Node core running beside it as a sidecar. A sidecar is a separate process that the shell starts. The plan puts windows, dialogs, the clipboard, links, the page scheme, the policy, the close guard and the Dock icon in the shell. It names the injection points in `main.ts` as the start of the port. It does not design a request path from the core to the shell. Nothing in this page depends on that plan being accepted.

## The three rules, and the test that holds them

1. Only `main/main.ts` and `preload/real-preload.ts` load Electron. No other file in `main`, `preload`, `shared` or `renderer` does. No package that those folders reach by relative imports does either.
2. Only `renderer/api/transport.ts` reads the two bridges `bowerloomReal` and `bowerloomEngine` in the page. Only `preload/real-preload.ts` puts them on the window.
3. No relative import leaves `main`, `preload`, `shared`, `renderer` and the `src` folders of packages. An import into `tools`, `e2e`, `tests`, another app or a package folder other than `src` fails.

`apps/desktop/tests/shell-boundary.test.ts` holds all three. The scan starts at the four folders. It follows each relative import into `packages/<name>/src` until no new package appears. Today it reaches 27 packages and 499 files. It uses the tokenizer of `tests/fixtures-real/static-check.ts`. A comment or a string does not count as a load. The test reads each file as written and as plain JavaScript, so a type-only import counts.

A load is `import ... from`, `import 'x'`, `export ... from`, `import('x')`, `require('x')` and `x.require('x')`. The module names that count are `electron`, its subpaths, `electron-*` packages, and `@electron/*` and `@electron-*` packages. Three other forms also fail, because the check cannot say where they go. They are a load with a name that is not a string, `createRequire`, and a `require` that is not a call with a string.

The test fails on an empty file set. It fails on a folder that holds far fewer files than today. It fails on a file that does not parse, on a link, and on a stale list. It feeds each rule bad samples. Each sample must produce a problem that names the load or the bridge, and a parse error does not count. It plants a violation in a file of each extension that the scan reads.

No package that the core reaches imports Electron today. A search of the nine packages that the core imports directly, and of `packages/engine-api`, found no use of the word `electron` in them. The test reaches 18 more packages through them, and none loads Electron.

What the test does not cover:

- The folders `tools/`, `e2e/` and `tests/`.
- A package that only a bare package name reaches.
- A bridge name built at run time or reached through an alias.
- A person who works round the check on purpose.

No runtime check backs the static check yet. The scope asks for one for the bridge names, and it does not exist.

Some checks exist in part already. `tests/api-call-layer.test.ts` holds the one reader of the window. It also holds the absence of `electron` and `node:` strings in the page, by pattern over text with comments removed. `tests/engine-api-imports.test.ts` holds the import graph of `packages/engine-api`. After PR 173, `tests/renderer-client-purity.test.ts` holds the page to the client with a longer rule list.

## Shell: a Tauri shell writes this again

`main/` files (35 files in all):

- `main.ts`. The start of the main process. It makes the window and registers the page scheme `app://viewer`. It locks navigation and refuses permissions. It builds the application menu and shows the native dialogs. It wires quit and close and sets the Dock icon. A refused launch exits with code 2. The file is also mixed. See "Mixed files".
- `close-guard.ts`. The question about unsaved changes. Main asks it at the close of a window.
- `quit-hold.ts`. The wait for a running write before quit.
- `window-failure.ts`. The box that main shows after a window dies.
- `stderr-guard.ts`. The handler for a closed standard error stream.
- `dock-icon.ts`. The Dock icon that follows light and dark.
- `help-menu.ts`. The data of the Help menu.
- `diagnostics-dialogs.ts`. The two Help dialogs. The Usage log dialog can write the summary file that the person picks.
- `notes-dialog.ts`. The words of the notes folder chooser.
- `window-options.ts`, `launch.ts`, `security.ts`, `temp-data.mjs`, `temp-data.d.mts`. All four are mixed. See "Mixed files".

The logic of the files above has no Electron import. Each takes the Electron parts as arguments, so a unit test runs it without Electron. A Tauri shell cannot reuse the wiring in `main.ts`. Whether it reuses this TypeScript or writes it again in Rust is open. The draft plan proposes a Rust shell.

Other shell parts:

- `preload/real-preload.ts`. The bridge. It uses `contextBridge` and `ipcRenderer` to put two frozen objects on the window: `bowerloomReal` with 3 calls, and `bowerloomEngine` with 39 calls and a `mode` field.
- The `build` block of `apps/desktop/package.json`: app id, product name, targets, `asar`, `extraResources`, the signing identity and `electronFuses`. The `main` field is `dist/main.mjs`.
- `tools/check-fuses.mjs`. It reads the Electron fuses of a built app.
- `tools/run.mjs`. The one-command launcher. It finds and starts the Electron binary.
- `tools/render-app-icon.mjs` and the `build/` folder: the app icon and the Dock icons.
- `e2e/hidden.ts`, `e2e/harness-page.ts`, `e2e/packaged-support.ts`, `e2e/temp-dirs.ts`. The launch helpers of the end-to-end suite. Specs that test shell behaviour by name include `e2e/packaged-app.spec.ts`, `e2e/bundle-worker-asar.spec.ts`, `e2e/window-hidden.spec.ts`, `e2e/window-security.spec.ts`, `e2e/quit-menu.spec.ts` and `e2e/harness-close-guard.spec.ts`. A Tauri shell needs its own launch helper. The draft plan says the same.

Shell logic with unit tests: `tests/launch.test.ts`, `tests/launch-fixes.test.ts`, `tests/close-guard.test.ts`, `tests/window-failure.test.ts`, `tests/stderr-guard.test.ts`, `tests/dock-icon.test.ts`, `tests/e2e-hidden.test.ts`, `tests/e2e-temp.test.ts`, `tests/security.test.ts`, `tests/diagnostics-dialogs.test.ts`, `tests/packaging.test.ts` and `tests/packaged-support.test.ts`.

## Core: stays, and runs in any Node host

In `main/`:

- The engine service and its parts: `engine-service.ts`, `engine-save.ts`, `engine-consent.ts`, `engine-events.ts`, `engine-state.ts`, `engine-bundle.ts`, `engine-bundle-host.ts`, `engine-bundle-work.ts`, `engine-bundle-worker.ts`, `engine-bundle-mark.ts`. The host starts the worker from `./bundle-worker.mjs`, found beside the main bundle with `import.meta.url`. A new core bundle must keep that layout.
- The reader and the kept read: `real-scan.ts`, `real-fs.ts`, `safe.ts`, `scan-session.ts`, `scan-cache.ts`.
- `kit.ts`. It loads the ready-made kits. The caller gives it `packaged` and `resourcesPath`.
- `notes-report.ts` and `approver.ts`.
- `extension-loader.ts`. It reads `<bundleRoot>/extensions/<name>/manifest.json` with `node:fs` and `node:path` only. After PR 171, `extension-host.ts` joins it. The host builds one registry from the six protected defaults and the loaded manifests. It imports no Electron.

The core imports these Node modules: `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:crypto`, `node:url` and `node:worker_threads`.

The core also imports nine packages by relative path:

- `adoption`
- `contracts`
- `diagnostics`
- `harness-bundle`
- `harness-definition`
- `notes-source`
- `project-context`
- `project-sync`
- `skill-manifest`

It reads the `kits/` folder at the repository root too. The package `project-context` imports `node:net`.

`engine-state.ts` is the one place of main that reads the environment. It reads `XDG_STATE_HOME`, `BOWERLOOM_PREVIEW_ENGINES`, `BOWERLOOM_EVENT_LOG` and `PATH`. A host that runs the core must give it the same variables.

In `shared/` (8 folders: `api`, `engine`, `extensions`, `harness`, `home`, `real`, `vendor`, `world`): plain code and data that both main and the page import. It holds the call tables and types, the in-memory sample engine, the extension registry, and the model of the harness screens. No file in `shared/` imports Electron or a Node module. A search found no import of a bare package or a `node:` module in `shared/`. Its imports from `packages/` are two value imports and some type-only imports. The two value imports come from `harness-definition/src/defaults.ts` and `words.ts`, and those two files import nothing. The type-only imports come from `adoption`, `project-sync` and `harness-definition`. The page bundles `shared/`, so this matters in a browser engine.

## API: stays, and both shells must keep it

- `shared/api/calls.ts`. One list of calls, one channel table, the refusal codes, and the function that maps an error to its short code.
- `shared/engine/types.ts`. `ENGINE_CALLS` (39 names), `ENGINE_ARITY`, `ENGINE_CHANNELS` and `ENGINE_CALL_REFUSALS`.
- `shared/real/types.ts`. `REAL_CALLS` (3 names: `discoverPlaces`, `pickFolder`, `readSelected`) and `REAL_CHANNELS`.
- `packages/engine-api` and its golden file. The contract imports nothing from `apps/desktop` or Electron.
- Tests that hold it: `tests/engine-api-contract.test.ts`, `tests/engine-api-shape.test.ts`, `tests/engine-api-imports.test.ts` and `tests/api-call-layer.test.ts`.

The wire channel names are Electron IPC names, such as `bowerloom-real:discover-places`. Whether a Tauri shell keeps them or names its commands another way is open. The contract does not say. PR 172 raises the same point.

## Page: stays, and runs in the browser engine of either shell

- `renderer/**`: the screens, the sheets, the router, the words, `brand.css`, `tokens.css`, `styles.css` and `index.html`.
- `renderer/api/client.ts`. It checks that the bridge is whole and hands the calls down. It does not read the window.
- The build copies the fonts from `apps/landing/public/fonts`. A build of `apps/desktop` without `apps/landing` fails on purpose.

The page files that touch the shell are in "Mixed files".

## Mixed files

Each item names the file, the two sides and a proposed split. No split is done here.

1. `main/main.ts`. Shell start and core wiring in one file. It also builds the arguments of `registerRealIpc` and `registerEngineIpc`. The words of the native dialogs sit inside it, except the notes chooser. Proposed split: a function that builds the core and the API handlers from injected tools, and a smaller `main.ts` that makes the window and passes the tools.
2. `main/engine-ipc.ts` and `main/real-ipc.ts`. They hold API rules: the call must come from the main frame of the app page, the argument count, and the mapping of errors to short codes. They are written against an Electron-shaped interface, `ipc.handle(channel, listener)` and `event.senderFrame`. Neither imports Electron. Proposed split: the rules stay as plain functions, and the registration moves to the shell. `docs/v0.9/engine-api-library.md` already treats the move of these files as later work.
3. `main/security.ts`. It holds portable policy: the `CSP` text, the allowed outside hosts, `isAppUrl`, `resolveAppFile`, `decideNavigation`, `isAllowedRealSender` and `allowRequest`. It also holds `webPreferences()`, which uses Electron option names, and the scheme constants. It re-exports `temp-data.mjs`. Proposed split: policy in one file and `webPreferences` in another.
4. `main/window-options.ts`. The size, the minimum size and the title are plain data (1280 by 800, minimum 900 by 600, title Bowerloom). The `--e2e-hidden` switch, `paintWhenInitiallyHidden`, the Dock hide and the quiet-dialog replacement are Electron-shaped.
5. `main/launch.ts`. The launch plan is pure, and any shell needs the same flag rules: the `--sample` flag and the refusal of near-miss flags. Its field `preload` and some comments use Electron words.
6. `main/temp-data.mjs` and `temp-data.d.mts`. Plain Node code. It exists for the temporary Electron data folder of the sample launch, and `tools/run.mjs` imports it too.
7. `preload/real-preload.ts`. The call list comes from `shared`. The file also holds two refusal patterns written out as literal codes, one for the reader and one for the engine. A search found no test that compares these two patterns with the shared tables.
8. `tools/bundle.mjs`. The page and worker entries are portable. The `main.ts` and preload entries and `external: ['electron']` are shell.
9. `renderer/api/transport.ts`. The one page file that names the two bridges. A Tauri shell must fill these two names on the window, or this file must change. After PR 173 the file also reads the attribute that main puts on the body of the sample page.
10. The side channels between the page and main. They carry no engine call:
    - The page sets its own title. `renderer/harness/close-guard.ts` writes the unsaved count into the page title and holds a `beforeunload` listener. Main reads the title in `main/close-guard.ts`.
    - `renderer/harness/real/Nothing.tsx` calls `window.close()`.
    - Main rewrites `index.html` for the sample launch. It adds one attribute to the body through the page scheme handler in `main.ts`, using `withSamplePreviewEngines` from `shared/engine/sample-switch.ts`.
    - Main tells the page its mode through the address hash (`#app` or `#sample`), set in `main/launch.ts`.
    After PR 173, the new `docs/v0.9/client-purity.md` records the first two as allowances. Moving them into the engine API needs new calls, and that changes the frozen contract, so it is a decision for the maintainer.
11. The content security policy. Two copies exist. The `<meta http-equiv="Content-Security-Policy">` tag in `renderer/index.html` is the policy in force, because it is the only copy that reaches the browser engine. The `CSP` constant in `main/security.ts` is not read by `main.ts`. `tests/security.test.ts` holds the two copies equal, and `tests/real-static.test.ts` holds the tag equal to a written-out string. A Tauri shell keeps the tag, or sets the same policy in its own configuration. If it sets its own, a test must hold the two together.
12. `package.json`. One file holds the app dependencies and the shell build block.
13. `e2e/*.spec.ts`. The specs test the page and the core. The launch is Electron.

## Calls from the core into the shell

The core asks the shell for these things through injected tools, all handed over in `main/main.ts`:

- The reader: `chooseFolder`.
- The engine service: `confirm` (the question before every write), `chooseFolder`, `chooseBundleOpen`, `chooseBundleSave`, `chooseNotesFolder`, `openPath` (opens a report in another app), `writeClipboard` and `quitBegun`.

If the core runs in its own process, each of these becomes a request from the core to the shell. The API contract does not describe them, because the page never sees them. The draft plan names the injection points but does not design a request path from the core to the shell.

## Shell protections and the test that covers each

Acceptance item 5 asks for a map of the file that covers each protection. A text match reads `main/main.ts` as text and checks that a line is there. It does not show that the line works. A behavior check runs code.

- Page scheme (`app://viewer`, with only files below the page folder served):
  - Behavior: `tests/security.test.ts`, test `the page is served by the app itself, and only files below its renderer folder can be asked for`. It runs `decideNavigation`, `allowRequest` and `resolveAppFile` on good and bad paths.
  - Text match: the same test matches `protocol.handle(APP_SCHEME`, `registerSchemesAsPrivileged` and `loadURL` in `main.ts`. `tests/real-static.test.ts` matches the line that picks the file.
  - Real window: every end-to-end spec loads the page through the scheme.
  - Not covered: no test found sends a traversal request through the registered handler.
- Permission refusal:
  - Text match only: `tests/security.test.ts`, lines 65 to 69, test `the packaged window turns the developer tools off, and every frame navigation and device permission is refused`. It matches `setPermissionRequestHandler`, `setPermissionCheckHandler` and `setDevicePermissionHandler` in `main.ts`.
  - Not covered: no test requests a browser permission in a window, so no test shows that the refusal works.
- Content security policy:
  - Text match: `tests/security.test.ts` holds the `CSP` constant equal to the tag in `renderer/index.html`. `tests/real-static.test.ts` holds the tag equal to a written-out string.
  - Behavior: `e2e/window-security.spec.ts` shows in a real window that an inline script does not run. It runs in the sandbox, with a Linux Electron.
- Close guard:
  - Behavior: `tests/close-guard.test.ts` runs the guard with fake tools. `e2e/harness-close-guard.spec.ts` and `e2e/quit-menu.spec.ts` run it in a real window.
  - Text match: `tests/close-guard.test.ts`, test `main handles will-prevent-unload with the guard and a synchronous box...`, matches the wiring in `main.ts`.
- Fuses:
  - Package file: `tests/packaging.test.ts` holds the `electronFuses` block of `package.json` against the list in `tools/check-fuses.mjs`. This is a comparison of two files, not a read of a binary.
  - Binary: the test `the built binary has those fuses` and `e2e/packaged-app.spec.ts` read a built app. Both need a macOS arm64 build, so neither runs in the sandbox. See `docs/v0.9/packaged-app-spec.md`, item F1.

## What a Tauri shell writes again

1. Window creation and options.
2. A page scheme that serves only the page folder, with path containment.
3. The navigation lock, no new windows, no webview, no outside request, and refusal of every permission.
4. The application menu and the two Help dialogs.
5. The native dialogs: the folder choosers, the harness file open and save, the question before every write, and the error box.
6. The close guard, the quit hold and the window-failure box.
7. The bridge: 3 plus 39 calls, the sender check, the argument count and the short refusal codes.
8. The sample launch with a temporary data folder, and the refusal of unknown mode flags with exit code 2.
9. The Dock icon that follows light and dark.
10. Packaging, a replacement for the Electron fuses, signing, and a launch helper for tests.

## What a Tauri shell does not touch

The engine and reader code, the kits, the extension registry and loader, the API contract and the page screens.

## Changes after the open pull requests

- After PR 171: `main/extension-host.ts` is new core code. `main.ts` starts the extensions once the app is ready. The bundle root is `process.resourcesPath` in a packaged build and `apps/desktop` in development. Nothing reads the host yet, and no channel lets a person uninstall.
- After PR 173: `renderer/api/client.ts` imports the sample engine and `fallbackEngine` replaces direct imports in `HarnessApp.tsx`. `transport.ts` reads the sample attribute. The rule list for the page grows.
- After PR 172: `carry-over-scope.md` holds the core and optional split.

## Checks that keep this map true

1. Electron is loaded by two files only, and the bridges are named by two files only. Test: `tests/shell-boundary.test.ts`. It runs in the sandbox container.
2. The engine API library imports nothing from `apps/desktop` or Electron. Test: `tests/engine-api-imports.test.ts`.
3. The call lists agree with the preload and with main. Test: `tests/api-call-layer.test.ts`.
4. A core file that gains an Electron import fails the new test. This holds in `main/`, in `shared/`, and in any package that the four folders reach by relative imports. It does not hold for a file in `tools/`, `e2e/` or `tests/`.

## Unknown

- Whether a Tauri shell reuses the TypeScript of the shell behaviours or writes them again in Rust. The draft plan proposes Rust.
- Whether any test sends a traversal request through the registered page handler, or requests a browser permission in a window. None was found.
- The Tauri names for the wire channels.
- The way the core asks the shell for a dialog. This is open for a core in its own process.
- Whether the sample launch needs a Tauri counterpart for the rewritten body attribute and the temporary data folder.
- The content of these files was read only by header: `main/notes-report.ts`, `main/approver.ts`, `tools/render-app-icon.mjs` and `tools/made-up-home.ts`.
