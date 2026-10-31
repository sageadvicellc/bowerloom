# Bowerloom desktop (experimental)

The desktop app of Bowerloom. It is experimental, and it is possibly not part of v1. The command line gives you every feature. The app shows the harness of a project and installs it into Claude Code and Codex, with a preview before every change. Help > Report a problem builds a diagnostic bundle, and Help > Usage log shows the local event log.

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

1. It looks in the tool folders of your home folder: Claude Code, Codex and OpenCode. It also notices a Hermes folder, but Hermes is not an engine of Bowerloom 0.8, so the harness preview does not show what is in it. It says how many things it left out. You can also pick a folder, and it finds the projects inside it.
2. Question one shows the places it found with counts, and no file names. Question two, "Read what is inside?", reads only the places you ticked.
3. It reads names, descriptions, structure and the names of keys, plus the text of the skills, agents and saved prompts you tick, and the first lines of notes pages. Known key and password shapes are hidden. That check goes by shape, so look at anything private before you share it.
4. You then choose which agents go on the map. "Find more" does the same again and adds to what you have.

The tests run on a made-up home folder (`tests/fixtures-real`), never on yours.

The install sheet shows Claude Code and Codex, and shows OpenCode, Pi, and DeepSeek Harness with a Preview tag. Bowerloom 0.8.0-beta.1 supports Claude Code and Codex. The three preview engines can be installed to only when the app starts with `BOWERLOOM_PREVIEW_ENGINES=1`. Reading and removing work for all five. The sample locks the three too: they show the tag, unticked and disabled. The sample cannot turn them on; only the e2e specs that install to OpenCode do, with a launch argument.

## Make a harness from a folder, and install it

Two sheets on the Projects screen work on your own folders. In the sample they run on made-up folders and write nothing.

- **From a folder** makes a harness from the files your interfaces already use. It shows what it found and where, the copies that differ (you pick one), the rules that differ by interface, and everything it leaves out, with the reason. Before it writes, you read and tick each approval (a hook or a server that runs a command, a secret it replaced) and each acknowledgement (a rule it does not carry). It writes only into the folder's `.bowerloom` folder.
- **Install from a folder** writes the folder's harness into each interface's own files. First it lists any rule that an interface carries weaker than the harness asks, and you tick each one. Then it shows, for each interface and each part, a dot and a word (Exact, Translated, Weakened, Absent) with the reason, what waits for your trust, and every command and file of code it will write, in full. When the folder has both AGENTS.md and a CLAUDE.md that differ, it shows which interface reads which, with Accept AGENTS.md as the default. You approve the plan by its number, and only then can you write. Undo opens the removal plan, which you approve the same way. A run that stopped part way gets a recovery plan.

On your own folders the main process does the work with Bowerloom's own packages. It plans without writing, and writes only the plan you approved: it plans again and stops if anything changed. Main also asks its own yes-or-no question before every write. The window gets plain words and paths inside the folder, never your full paths. Bowerloom keeps its records in its private state folder (`$XDG_STATE_HOME/bowerloom`, else `~/.local/state/bowerloom`), in the same place the command line uses: one `harness` folder per project. A record the earlier app kept under `desktop/` moves there once, when you choose the folder. If both exist, the app stops and says so, and changes nothing. To open a tidy-up report of a notes folder, the main process copies the report into a new private folder in the system temporary folder and opens the copy, never the report itself. The copy goes on the next open, and when the app quits.

When AGENTS.md and CLAUDE.md differ, **Merge** moves the CLAUDE.md text into the harness instructions. It shows its own plan, and writes only after you approve it and say yes again. The install that follows uses Accept AGENTS.md. When only a file's mode changed after Bowerloom wrote it, the file shows **Restore mode** and **Keep new mode**. Keep new mode is refused when the new mode lets others write the file.

## Where the app may write

Apart from the steps you approve on your own folders (see above), the app has no way to change a Bowerloom file of yours. Two small writes remain in the main process: the usage summary, which goes only to the path you pick in the save dialog, and the private copy of a tidy-up report. `tests/writers.test.ts` holds this list.

## Motion

Every duration, easing and distance of the app's motion is in one file, `renderer/motion-tokens.ts`, so you can retune it in one edit. If your computer is set to reduce motion, everything is instant.

## What is not built yet

- Updates are not part of this build. There is no update check.
- The app is not signed with a Developer ID. The macOS build carries only a self-made local signature, which the safety switches need in order to start. A signed installer needs an Apple Developer ID certificate. macOS will not let an unsigned app update itself.
- Windows and Linux installers are set up in the build settings but have not been built or tried.

## The 0.8 home app (dev only)

The earlier 0.8 home app is still in the source and is not part of the shipped screens. Two dev flags open it: `npm --prefix "<repo>" run desktop -- --home-sample` for a made-up sample world, and `npm --prefix "<repo>" run desktop -- --home-real` for your own setup, read only. Its tests and the persona tool still use it.

## For developers

All commands run from the repository root, or with `npm --prefix <repo>`.

- `npm run desktop` opens the app on your own folders. `npm run desktop:sample` opens it on made-up folders. `npm run desktop:dev` is the same as sample.
- `npm run desktop:test` runs the unit tests (security rules, launch plans, writers, the reader, the engine service, and what each screen says).
- `npm run desktop:build` makes the macOS app, with a local signature only, in `apps/desktop/release`. It never publishes. In `apps/desktop`, `npm run verify:fuses` checks the built app's safety switches.
- In `apps/desktop`, `npm run e2e` runs the end-to-end specs. Take the lock `/tmp/bowerloom-test.lock` around a run. The spec `e2e/packaged-app.spec.ts` launches the built app from `release/` when one is there.

Design colors and sizes live in one file, `renderer/tokens.css`, so the Sage brand can replace them later. The app reads Bowerloom's own functions inside one process. It opens no port and sends nothing over the network. The only programs it starts are git, for notes folders, and the version command of each engine, for the problem report.
