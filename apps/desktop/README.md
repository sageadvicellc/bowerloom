# Bowerloom desktop (beta)

The desktop app of Bowerloom. It is a beta, and it is a main part of Bowerloom 0.8.0-beta.1, next to the command line. It does the adopt, install, and remove steps on screen, with a plan to read before every change. It also has the Builder, where you edit a harness, the save step, and save points, which the command line does not have. Help > Report a problem builds a diagnostic bundle, and Help > Usage log shows the local event log.

## Open it

Copy one line into a terminal window. It works from any folder. The first time, it installs what it needs and builds the app, which takes a few minutes. After that it opens in seconds.

Your own folders:

```
npm --prefix "<path-to-bowerloom>" run desktop
```

Made-up sample folders, so you can see every state at once and nothing on your computer is read or written:

```
npm --prefix "<path-to-bowerloom>" run desktop:sample
```

Put the folder of your Bowerloom checkout between the quote marks.

A built app opens the same way as the first line: with no flag, on your own folders. It keeps its settings in the normal data folder of the app, so they last between starts. The sample keeps nothing: it makes a temporary data folder and removes it when it closes.

## What the app reads, in plain English

1. It looks in the tool folders of your home folder: Claude Code, Codex and OpenCode. It also notices a Hermes folder, but Hermes is not an engine of Bowerloom 0.8, so the app does not show what is in it. It says how many things it left out. You can also pick a folder, and it finds the projects inside it.
2. Question one shows the places it found with counts, and no file names. Question two, "Read what is inside?", reads only the places you ticked.
3. It reads names, descriptions, structure and the names of keys, plus the text of the skills, agents and saved prompts you tick, the project instruction files, settings, hooks and tool entries of the folders you tick, and the first lines of notes pages. Known key and password shapes are hidden. That check goes by shape, so look at anything private before you share it.
4. You then choose which agents go on the map. "Find more" does the same again and adds to what you have.
5. The app keeps its last read, so the next start shows it without reading any folder. The file is `last-read/last-read.json` in the private state folder (`$XDG_STATE_HOME/bowerloom`, or `~/.local/state/bowerloom`). It holds only what the window already received: paths under your home folder written with `~`, and text with key shapes hidden. Only you can open it (mode 0600). A short check then lists the files the reader would list (names, sizes and change times, never contents) and says when a folder changed. It does not read again by itself: "Read again" goes back to question one. A missing file starts the app as before. A damaged, linked, oversized or wrong-version file is ignored, and the Welcome screen says so. A short check, limited to a few seconds, can also answer "Some folders could not be checked." (a folder cannot be found again from the path the window shows, or the check ran out of time). That is never taken for "nothing changed". Delete the folder to forget the last read. If the state folder sits inside a folder that a sync service copies, the saved read is copied too.

The tests run on a made-up home folder (`tests/fixtures-real`), never on yours.

The install sheet shows Claude Code and Codex, and shows OpenCode, Pi, and DeepSeek Harness with a Preview tag. Bowerloom 0.8.0-beta.1 supports Claude Code and Codex. The three preview engines can be installed to only when the app starts with `BOWERLOOM_PREVIEW_ENGINES=1`. Reading and removing work for all five. The sample locks the three too: they show the tag, unticked and disabled. The sample cannot turn them on; only the e2e specs that install to OpenCode do, with a launch argument.

## Make a harness from a folder, and install it

Two sheets on the Projects screen work on your own folders. In the sample they run on made-up folders and write nothing.

- **From a folder** makes a harness from the files your engines already use. It shows what it found and where, the copies that differ (you pick one), the rules that differ by engine, and everything it leaves out, with the reason. Before it writes, you read and tick each approval (a hook or a server that runs a command, a secret it replaced) and each acknowledgement (a rule it does not carry). It writes only into the folder's `.bowerloom` folder.
- **Install from a folder** writes the folder's harness into each engine's own files. First it lists any rule that an engine carries weaker than the harness asks, and you tick each one. Then it shows, for each engine and each part, a dot and a word (Exact, Translated, Weakened, Absent) with the reason, what waits for your trust, and every command and file of code it will write, in full. When the folder has both AGENTS.md and a CLAUDE.md that differ, it shows which engine reads which, with Accept AGENTS.md as the default. You approve the plan by its number, and only then can you write. Undo opens the removal plan, which you approve the same way. A run that stopped part way gets a recovery plan.

On your own folders the main process does the work with Bowerloom's own packages. It plans without writing, and writes only the plan you approved: it plans again and stops if anything changed. Main also asks its own yes-or-no question before every write. The window gets plain words and paths inside the folder, never your full paths. Bowerloom keeps its records in its private state folder (`$XDG_STATE_HOME/bowerloom`, else `~/.local/state/bowerloom`), in the same place the command line uses: one `harness` folder per project. A record the earlier app kept under `desktop/` moves there once, when you choose the folder. If both exist, the app stops and says so, and changes nothing. To open a tidy-up report of a notes folder, the main process copies the report into a new private folder in the system temporary folder and opens the copy, never the report itself. The copy goes on the next open, and when the app quits.

When AGENTS.md and CLAUDE.md differ, **Merge** moves the CLAUDE.md text into the harness instructions. It shows its own plan, and writes only after you approve it and say yes again. The install that follows uses Accept AGENTS.md. When only a file's mode changed after Bowerloom wrote it, the file shows **Restore mode** and **Keep new mode**. Keep new mode is refused when the new mode lets others write the file.

## Where the app may write

Apart from the steps you approve on your own folders (see above), the app has no way to change a Bowerloom file of yours. The app also writes a local usage log of what was done, with no name and no path (`BOWERLOOM_EVENT_LOG=off` turns it off), and it moves the state record of an earlier version into the private state folder of Bowerloom. Two small writes remain in the main process: the usage summary, which goes only to the path you pick in the save dialog, and the private copy of a tidy-up report, which the app removes when it closes. The browser engine keeps its own profile folder (window settings and cache) between starts. `tests/writers.test.ts` and `tests/writers-imports.test.ts` hold the list of files that can write.

## Look

The app has the look of the website, bowerloom.ai: the Rose Conservatory colours in light, After Hours in dark, Newsreader for headings and Manrope for everything else. The colours are in `renderer/brand.css`, a copy of the website's, and `tests/brand-parity.test.ts` fails when the two copies differ. The font files are the website's own; the build copies them into the app with their licences. `renderer/harness/brand-layer.css` puts the look on the app's parts.

To see every screen in light and dark, run `SCREEN_SHOTS=<a folder outside the repo> npx playwright test --config playwright.config.ts e2e/screen-tour-shots.spec.ts` from this folder. The window stays hidden.

## Motion

Every duration, easing and distance of the app's motion is in one file, `renderer/motion-tokens.ts`, so you can retune it in one edit. If your computer is set to reduce motion, everything is instant.

## What is not built yet

- Updates are not part of this build. There is no update check.
- The app is not signed with a Developer ID. The macOS build carries only a self-made local signature, which the safety switches need in order to start. A signed installer needs an Apple Developer ID certificate. macOS will not let an unsigned app update itself.
- Windows and Linux installers are set up in the build settings but have not been built or tried.

## For developers

All commands run from the repository root, or with `npm --prefix <repo>`.

- `npm run desktop` opens the app on your own folders. `npm run desktop:sample` opens it on made-up folders. `npm run desktop:dev` is the same as sample.
- `npm run desktop:test` runs the unit tests (security rules, launch plans, writers, the reader, the engine service, and what each screen says).
- `npm run desktop:build` makes the macOS app, with a local signature only, in `apps/desktop/release`. It never publishes. In `apps/desktop`, `npm run verify:fuses` checks the built app's safety switches.
- In `apps/desktop`, `npm run e2e` runs the end-to-end specs. Take the lock `/tmp/bowerloom-test.lock` around a run. Every e2e run is hidden: no window shows, no other app loses focus, and the Dock shows no icon. `e2e/hidden.ts` adds the switch `--e2e-hidden` to every start, and gives the windows that a spec opens from the main process the same rule. The switch changes only whether a window is shown. To watch a run, set `BOWERLOOM_E2E_SHOW=1`, for example `BOWERLOOM_E2E_SHOW=1 npm run e2e -- e2e/window-hidden.spec.ts`. A run that watches shows the windows and may take focus. The spec `e2e/packaged-app.spec.ts` launches the built app from `release/` when one is there.

Manual check of the close question, on a Mac. The e2e specs answer the box with a stub and cannot press real keys, so check the real box by hand after a change to `main/close-guard.ts` or the app menu:

1. Run `npm run desktop:sample`. Open a folder in the Builder and tick one box, so the page says "1 change, not saved yet."
2. Press Cmd+Q. A box asks "Discard 1 change?" with the note "Your changes are not saved. If you go on, they are lost." Choose Keep editing: the window and the change stay, and the app keeps running. Press Cmd+Q again and choose Discard: the app quits.
3. Open it again and make a change. Click the red close button of the window. The same box appears. Keep editing keeps the window. Discard closes it.
4. Make a change, minimize the window to the Dock, and choose Quit from the Dock icon. The window comes back and the box shows on it.
5. Press Cmd+W. This build's Window menu has no Close item, so Cmd+W does nothing. Note what you see.
6. Undo the change so the page says "No change yet." Cmd+Q now quits with no box.

Design colors and sizes live in one file, `renderer/tokens.css`, so the Sage brand can replace them later. The app reads Bowerloom's own functions inside one process. It opens no port and sends nothing over the network. The only programs it starts are git, for notes folders, and the version command of each engine, for the problem report.
