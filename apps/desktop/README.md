# Bowerloom Viewer

A desktop window that shows you everything Bowerloom looks after: your skills, prompts, teams, helpers, knowledge folders, and which project uses what. It only looks. It never changes your library or your projects.

## Open it

Copy one line into a terminal window. It works from any folder. The first time, it installs what it needs and builds the app, which takes a few minutes. After that it opens in seconds.

Your own Bowerloom:

```
npm --prefix "/Users/hannamacintosh/Sage Advice/code/internal-tools/bowerloom-desktop" run desktop
```

Made-up sample data, so you can see every state at once:

```
npm --prefix "/Users/hannamacintosh/Sage Advice/code/internal-tools/bowerloom-desktop" run desktop:sample
```

If you keep the code somewhere else, put that folder between the quote marks instead.

The first time you open your own Bowerloom, the app looks once at the folders right inside your home folder for ones that hold Bowerloom, and starts with those. Home shows what it is reading, with Remove and Add buttons, so you can change it. It never looks inside Documents or Desktop by itself. It reads a few levels deep inside each folder, finds projects set up the older way (a .bowerloom folder) as well as newer ones, and skips folders named examples, fixtures or test unless you turn that on in Settings. Nothing in those folders changes.

## What each screen shows

- **Home.** One sentence on what is set up, the counts of teams, skills, prompts, and projects, and a "Needs attention" list. Each item says what it means and what a person would do about it.
- **Library.** Your skills, prompts, and teams. Each row says where it came from (Yours, From GitHub, From npm), whether it is fixed to a version, and how many projects use it. Click one to read what is inside it. A helper with powerful settings gets a yellow warning.
- **Projects.** Each project with a status: Ready, Drifted, Lock problem, or Not set up. Open one to see what it uses, whether each item matches what was locked, what drifted and why, its helpers, its knowledge slices, and its project list and lock file in plain sentences. "Show the raw files" shows the files as they are.
- **Knowledge folders.** Folders of notes outside your projects, which projects may read them, and a bar for each slice that compares what a helper reads at the start with reading everything.
- **Storage.** Where your library is, whether it is shared on GitHub, whether a GitHub access key is set (never the key itself), and the saved copies and their sizes.
- **Settings.** The folders the viewer searches for projects (adding or removing one only changes the viewer's own list), sample or your own data, light or dark, the version, and "Check for updates".

## What is not built yet

- No buttons that change anything. This is a viewer only.
- Updates are off until the first release. The footer says "Updates turn on after the first release".
- The app is not signed with a Developer ID. The macOS build carries only a self-made local signature, which the safety switches need in order to start. A signed installer needs an Apple Developer ID certificate. macOS will not let an unsigned app update itself.
- Windows and Linux installers are set up in the build settings but have not been built or tried.

## For developers

All commands run from the repository root, or with `npm --prefix <repo>`.

- `npm run desktop` opens the app. `npm run desktop:sample` opens it with sample data. `npm run desktop:dev` is the same as sample.
- `npm run desktop:test` runs the viewer tests (security rules, folder scan, read functions against the sample, and what each screen says).
- `npm run desktop:build` makes the macOS app, with a local signature only, in `apps/desktop/release`. It never publishes. In `apps/desktop`, `npm run verify:fuses` checks the built app's safety switches.
- In `apps/desktop`: `npm run screenshots` launches the app and saves every screen, light and dark, into `screenshots/`.
- `npm run sample:make` rebuilds `sample-data/` with the real Bowerloom commands (run `npm run build` at the root first).

Design colors and sizes live in one file, `renderer/tokens.css`, so the Sage brand can replace them later. The app reads Bowerloom's own functions inside one process. It starts no command line, opens no port, and sends nothing over the network.
