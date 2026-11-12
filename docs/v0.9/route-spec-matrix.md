# Route-to-spec matrix

Status: written for the v0.9 parity item ("What working means", item 1, of `carry-over-scope.md`). Base: `release/v0.9.0-beta.0` (then named `release/0.8.0-beta.2`) at `5ca6df04`.

The data lives in `route-spec-matrix.json`. This page is the reading copy. A test (`apps/desktop/tests/route-spec-matrix.test.ts`) compares the data with `BASE_ROUTES` in `apps/desktop/shared/extensions/defaults.ts`, so a route cannot go missing.

## How to read a row

- A route row has the route params, the sheets that open from it, the modes it renders in, the current screen file, and the default extension that will own it.
- The modes are `sample` (the `--sample` launch, address base `#sample`), `real` (the default launch, `#app`, with the bridges), and `no-bridge` (an `#app` window with no bridge).
- Runs and Compare have a sample mode (made-up runs in the store) and, since beta.2, a real mode: the runs the person recorded, read from main through the `bowerloomRuns` bridge. An empty real list says "No runs yet. Record one after you start an engine."
- The e2e lists name the specs that visit or assert the row in that mode. A listed spec is not proof that every assertion of the row is covered. The file lists come from the address and the labels each spec uses, and from the header of each spec.
- `new spec` names the spec written for a route that had no spec of its own at the base. Each asserts the base behavior and nothing new.
- The screenshot specs (`docs-shots`, `landing-shots`, `screen-tour-shots`) are never listed. They skip unless an environment flag is set.

## Rows

Count: 37 rows. 15 routes, 4 route params, 8 sheets, 4 launches, 3 shell chrome rows and 3 named states.


### Routes

- **welcome** (`route:welcome`)
  - modes: sample, real
  - screen: `screens/Welcome.tsx`
  - target extension: `first-run`
  - e2e sample: `harness-first-run`
  - e2e real: `harness-real-first-run`, `harness-real-empty`, `harness-real-saved-read`
  - unit: `harness-route`
- **choose** (`route:choose`)
  - modes: sample, real, no-bridge
  - screen: `screens/ChooseSources.tsx`, `real/RealChoose.tsx`, `real/mode.ts`
  - target extension: `first-run`
  - e2e sample: `harness-first-run`
  - e2e real: `harness-real-first-run`, `harness-real-empty`, `harness-start-harness-real`
  - e2e no-bridge: `harness-no-bridge`
  - unit: `harness-route`, `harness-boundary`, `harness-real-map`
- **read** (`route:read`)
  - modes: sample, real
  - screen: `screens/ReadSources.tsx`, `real/ReadNotes.tsx`, `real/LastRead.tsx`
  - target extension: `first-run`
  - e2e sample: `harness-first-run`
  - e2e real: `harness-real-first-run`, `harness-real-saved-read`
  - unit: `harness-route`, `harness-real-map`, `saved-scan`
- **notes** (`route:notes`)
  - sheets: save
  - modes: sample, real
  - screen: `notes/NotesFirstRun.tsx`, `notes/NotesStep.tsx`
  - target extension: `first-run`
  - e2e sample: `harness-notes`
  - e2e real: `harness-notes-real`, `journey-5-notes-and-wiki-keeper`
  - unit: `notes-route`, `notes-logic`, `notes-draft`, `notes-screens-markup`, `notes-words`
- **overview** (`route:overview`)
  - sheets: adopt
  - modes: sample, real
  - screen: `screens/Overview.tsx`, `screens/OverviewGrid.tsx`, `screens/OverviewList.tsx`, `screens/OverviewGraph.tsx`, `screens/OverviewDetails.tsx`
  - target extension: `overview`
  - e2e sample: `harness-overview-screen`, `harness-overview-grid`
  - e2e real: `journey-1-cold-start-and-adopt`
  - unit: `overview-contract`, `overview-model`, `overview-markup`, `overview-grid`, `overview-real`
- **harnesses** (`route:harnesses`)
  - params: id
  - sheets: adopt, import, install, start
  - modes: sample, real
  - screen: `screens/HarnessList.tsx`
  - target extension: `harnesses`
  - e2e sample: `harness-list`
  - e2e real: `harness-real-first-run`, `harness-start-real`, `journey-4-export-and-import`
  - unit: `harness-route`, `harness-real-map`, `harness-status`, `harness-store`
- **builder** (`route:builder`)
  - params: id
  - sheets: adopt, export, project, save
  - modes: sample, real
  - screen: `screens/Builder.tsx`, `screens/builder/BuilderDetails.tsx`, `screens/builder/Graph.tsx`, `screens/builder/SavePointsDrawer.tsx`, `screens/builder/DiscardSheet.tsx`, `FolderEditor.tsx`
  - target extension: `harnesses`
  - e2e sample: `harness-builder`, `harness-builder-component`, `harness-close-guard`, `harness-share-component`
  - e2e real: `harness-builder-save-real`, `journey-2-build-and-project`, `journey-3-undo-and-versions`
  - unit: `builder-draft`, `builder-drop`, `builder-words`, `folder-draft`, `folder-editor-markup`, `draft-undo`
- **file** (`route:file`)
  - params: partId
  - modes: sample, real
  - screen: `screens/FileView.tsx`, `parts/PathDisclosure.tsx`
  - target extension: `harnesses`
  - e2e sample: `harness-file`, `harness-path-disclosure`
  - e2e real: `harness-real-first-run`
  - unit: `harness-path-disclosure`, `harness-route`
  - new spec: `harness-file.spec.ts`
- **library** (`route:library`)
  - params: kind, partId
  - sheets: add
  - modes: sample, real
  - screen: `screens/Library.tsx`
  - target extension: `library`
  - e2e sample: `harness-list`, `harness-path-disclosure`
  - e2e real: `harness-library-add-real`, `harness-real-words`
  - unit: `library-add`, `library-add-map`, `harness-route`
- **projects** (`route:projects`)
  - params: id
  - sheets: adopt, install, project, save, import
  - modes: sample, real
  - screen: `screens/Projects.tsx`, `screens/ProjectsReal.tsx`
  - target extension: `projects`
  - e2e sample: `harness-engine`, `harness-install`, `harness-save`, `harness-window-items`, `harness-preview-demo`, `harness-path-disclosure`
  - e2e real: `harness-engine-real`, `harness-real-projects`, `harness-save-real`, `harness-window-items-real`, `harness-real-words`
  - unit: `real-projects`, `harness-install`, `saved-scan-screens`
- **runs** (`route:runs`)
  - params: id
  - modes: sample, real
  - screen: `screens/Runs.tsx`, `runs-real/RunsReal.tsx`
  - target extension: `projects`
  - e2e sample: `harness-compare`, `harness-runs`
  - e2e real: `harness-runs-real`, `harness-real-words`, `harness-start-real`
  - unit: `harness-runs`, `runs-real-model`, `runs-store`, `runs-logs`, `runs-ipc`, `runs-bridge`
  - new spec: `harness-runs.spec.ts`
  - note: Sample mode keeps its made-up runs in the store. A real launch shows the runs the person recorded (the bowerloomRuns bridge), with the figures of each from the engine's own session log. An empty list says "No runs yet. Record one after you start an engine."
- **compare** (`route:compare`)
  - params: group
  - modes: sample, real
  - screen: `screens/Compare.tsx`, `runs-real/CompareReal.tsx`
  - target extension: `projects`
  - e2e sample: `harness-compare`
  - e2e real: `harness-compare-real`
  - unit: `harness-runs`, `runs-real-model`
  - note: Sample mode compares made-up runs. A real launch compares the recorded runs of one instruction across engines. An address with no group parses to the runs route.
- **interfaces** (`route:interfaces`)
  - params: id
  - modes: sample, real
  - screen: `screens/Interfaces.tsx`
  - target extension: `interfaces-history-help`
  - e2e sample: `harness-install`, `harness-interfaces`
  - unit: `harness-words`, `harness-status`
  - new spec: `harness-interfaces.spec.ts`
  - note: Real mode has a gap: no spec opens the Interfaces route on the #app launch. harness-real-first-run.spec.ts opens #sample/interfaces/codex after a real read, which is not an #app address, so it is not listed.
- **history** (`route:history`)
  - modes: sample, real
  - screen: `screens/History.tsx`, `undo-note.ts`
  - target extension: `interfaces-history-help`
  - e2e sample: `harness-install`, `harness-history`
  - e2e real: `harness-real-projects`, `harness-real-words`
  - unit: `harness-store`, `draft-undo`
  - new spec: `harness-history.spec.ts`
- **help** (`route:help`)
  - sheets: save
  - modes: sample, real
  - screen: `screens/Help.tsx`
  - target extension: `interfaces-history-help`
  - e2e sample: `harness-help`
  - e2e real: `harness-real-words`
  - unit: `harness-words`
  - new spec: `harness-help.spec.ts`

### Extension routes

These are routes of bundled extensions. They are not base routes, so the 15 above stay exact. The data is in the `extensionRoutes` list of `route-spec-matrix.json`.

- **local-models** (`extension-route:local-models`)
  - modes: sample, no-bridge
  - owner: the bundled extension `local-models`
  - e2e (sample): `apps/desktop/e2e/harness-local-models.spec.ts`
  - e2e (no bridge): `apps/desktop/e2e/harness-local-models-no-bridge.spec.ts`
  - real mode has no spec yet. It needs a fixture server inside the sandbox.

### Route params

- **id** (`param:id`)
  - routes: harnesses, builder, projects, runs, interfaces
  - shows: Which harness, folder, run or engine is picked. An id the world does not know shows the list or a named empty state.
  - modes: sample, real
  - target extension: none (shell level)
  - e2e sample: `harness-list`, `harness-builder`, `harness-runs`, `harness-interfaces`
  - e2e real: `harness-builder-save-real`
  - unit: `harness-route`
- **kind** (`param:kind`)
  - routes: library
  - shows: Which tab of the Library: agent, skill, tool or context. Anything else opens the skill tab.
  - modes: sample, real
  - target extension: none (shell level)
  - e2e sample: `harness-list`
  - e2e real: `harness-library-add-real`
  - unit: `harness-route`
- **partId** (`param:partId`)
  - routes: file, library
  - shows: Which part the File view shows or the Library picks.
  - modes: sample, real
  - target extension: none (shell level)
  - e2e sample: `harness-file`, `harness-path-disclosure`
  - unit: `harness-route`
- **group** (`param:group`)
  - routes: compare
  - shows: Which group of runs Compare shows. An unknown group shows a named empty state.
  - modes: sample, real
  - target extension: none (shell level)
  - e2e sample: `harness-compare`
  - unit: `harness-route`

### Sheets

- **start** (`sheet:start`)
  - opened from: harnesses
  - modes: sample, real
  - screen: `sheets/StartSheet.tsx`, `sheets/StartRealSheet.tsx`
  - target extension: `projects`
  - e2e sample: `harness-compare`, `harness-list`
  - e2e real: `harness-start-real`, `harness-start-harness-real`
  - unit: `start-command`, `start-real-model`, `start-words`
  - note: The sample sheet starts runs in memory. The real sheet shows an engine command and runs nothing.
- **adopt** (`sheet:adopt`)
  - opened from: overview, harnesses, builder, projects, shell:New harness
  - modes: sample, real
  - screen: `sheets/AdoptSheet.tsx`, `sheets/adopt-review.tsx`
  - target extension: `projects`
  - e2e sample: `harness-engine`, `harness-small`
  - e2e real: `harness-engine-real`, `harness-sheets-component`, `journey-1-cold-start-and-adopt`
  - unit: `engine-adopt-empty`, `engine-service`
- **project** (`sheet:project`)
  - opened from: builder, projects
  - modes: sample, real
  - screen: `sheets/ProjectSheet.tsx`, `sheets/project-review.tsx`
  - target extension: `projects`
  - e2e sample: `harness-engine`, `harness-small`
  - e2e real: `harness-engine-real`, `harness-sheets-component`, `harness-real-projects`, `journey-2-build-and-project`
  - unit: `engine-preview`, `engine-gates`
- **save** (`sheet:save`)
  - opened from: notes, builder, projects, help
  - modes: sample, real
  - screen: `sheets/SaveSheet.tsx`
  - target extension: `projects`
  - e2e sample: `harness-save`, `harness-window-items`
  - e2e real: `harness-save-real`, `harness-window-items-real`, `harness-builder-save-real`
  - unit: `save-draft`, `save-draft-items`, `save-sheet-markup`, `engine-save`, `engine-save-review`
- **install** (`sheet:install`)
  - opened from: harnesses, projects
  - modes: sample, real
  - screen: `sheets/InstallSheet.tsx`, `sheets/install-review.tsx`, `sheets/install-steps.tsx`
  - target extension: `projects`
  - e2e sample: `harness-install`, `harness-preview-demo`
  - unit: `harness-install`
  - note: The sample install sheet. On the person's own folders the project sheet does this work.
- **add** (`sheet:add`)
  - opened from: library
  - modes: real
  - screen: `sheets/AddSheet.tsx`
  - target extension: `library`
  - e2e real: `harness-library-add-real`
  - unit: `library-add`, `library-add-map`
  - note: Mounted from Library on the person's own folders only. The sample has no Add sheet.
- **export** (`sheet:export`)
  - opened from: builder
  - modes: sample, real
  - screen: `sheets/ExportSheet.tsx`, `sheets/share-parts.tsx`
  - target extension: `projects`
  - e2e sample: `harness-share-component`
  - e2e real: `harness-share-real`, `harness-share-hostile`, `journey-4-export-and-import`
  - unit: `share-contract`, `share-sample`, `share-sheets-markup`, `share-words`, `share-no-stubs`
- **import** (`sheet:import`)
  - opened from: harnesses, projects
  - modes: sample, real
  - screen: `sheets/ImportSheet.tsx`, `sheets/share-parts.tsx`
  - target extension: `projects`
  - e2e sample: `harness-share-component`
  - e2e real: `harness-share-real`, `harness-share-hostile`, `journey-4-export-and-import`
  - unit: `share-contract`, `share-sample`, `share-sheets-markup`, `share-words`, `share-no-stubs`

### Launches

- **sample launch** (`launch:sample`)
  - shows: The --sample launch: the made-up world in memory, no bridge, address base #sample.
  - modes: sample
  - screen: `mount.tsx`, `HarnessApp.tsx`
  - target extension: none (shell level)
  - e2e sample: `harness-first-run`, `harness-small`, `harness-preview-demo`, `window-security`
  - unit: `sample-preview`, `world-sample`, `made-up-home`
- **sample launch with preview engines** (`launch:sample-preview-engines`)
  - shows: The --sample-preview-engines switch, which shows preview engines in the sample sheets.
  - modes: sample
  - screen: `mount.tsx`, `HarnessApp.tsx`
  - target extension: none (shell level)
  - e2e sample: `harness-preview-demo`, `harness-sheets-component`
  - unit: `sample-preview`
- **real launch** (`launch:real`)
  - shows: The default launch on the person's own folders, address base #app, with the reader and engine bridges.
  - modes: real
  - screen: `mount.tsx`, `HarnessApp.tsx`
  - target extension: none (shell level)
  - e2e real: `harness-real-first-run`, `harness-real-empty`, `window-security`, `packaged-app`
  - unit: `real-static`, `launch`
- **real launch with no bridge** (`launch:no-bridge`)
  - shows: An #app address whose window has no bridge shows the no-bridge screen, never the sample.
  - modes: no-bridge
  - screen: `mount.tsx`, `real/mode.ts`
  - target extension: none (shell level)
  - e2e no-bridge: `harness-no-bridge`
  - unit: `harness-boundary`

### Shell chrome

- **navigation reaches each registered route** (`chrome:navigation`)
  - shows: The left navigation: Overview, Harnesses, Library tabs, Projects, Runs, Engines, Install history, Help; the first-run routes have none.
  - modes: sample, real
  - screen: `Navigation.tsx`, `Shell.tsx`
  - target extension: none (shell level)
  - e2e sample: `harness-small`, `harness-list`
  - e2e real: `harness-real-words`
  - unit: `harness-route`
- **toast** (`chrome:toast`)
  - shows: The note with an optional Undo that sits over the shell.
  - modes: sample, real
  - screen: `parts/Toast.tsx`, `ui.tsx`, `undo-note.ts`
  - target extension: none (shell level)
  - e2e sample: `harness-runs`, `harness-history`
  - unit: `draft-undo`
- **unsaved-count title** (`chrome:unsaved-title`)
  - shows: The window title carries the count of unsaved changes, and the close guard holds the unload while there are any.
  - modes: sample, real
  - screen: `close-guard.ts`
  - target extension: none (shell level)
  - e2e sample: `harness-close-guard`
  - unit: `close-guard`

### Named states

- **path disclosure** (`state:path-disclosure`)
  - shows: A file path stays out of sight behind "Show details" in Library, Projects and the File view.
  - modes: sample
  - screen: `parts/PathDisclosure.tsx`
  - target extension: none (shell level)
  - e2e sample: `harness-path-disclosure`
  - unit: `harness-path-disclosure`
- **nothing found (real, empty home)** (`state:empty-real`)
  - shows: Welcome and Choose say "Nothing found yet" and offer Add a folder and Use the sample.
  - modes: real
  - screen: `real/Nothing.tsx`, `screens/ChooseSources.tsx`
  - target extension: `first-run`
  - e2e real: `harness-real-empty`
- **hostile export and import files** (`state:hostile-share`)
  - shows: Each hostile file is refused in words on the sheet and writes nothing.
  - modes: real
  - screen: `sheets/ImportSheet.tsx`, `sheets/ExportSheet.tsx`
  - target extension: `projects`
  - e2e real: `harness-share-hostile`
  - unit: `share-contract`

## Not in the matrix

- Assertion-level coverage of the old specs. A reviewer other than the author checks the replacement table of the rebuild, as the scope says.
- The packaged app (`packaged-app.spec.ts`) is listed under the real launch. It skips on a machine with no build in `release/`.
