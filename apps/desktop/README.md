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
- **Map.** Everything Bowerloom looks after as things you can move, in the shape of your own setup: this computer, the workspace, projects, context stores, teams, helpers, skills, prompts, reading lists and knowledge folders, with wires for what holds, uses, reads, owns, and comes from what. Drag a thing to arrange it, drag a box to select several, press **Tidy up** to lay it out from left to right, **Fit all** to see everything, **Undo** to take back a move, **Reset layout** to forget your places. Choose **This computer** (the shared library and the knowledge folders) or **Projects** to see one side. Click a thing for a panel with what it is, why it has a status, and what it is connected to. Use Tab and Enter to reach and open things, and the arrow keys (after Space) to move one. **Text outline** gives the same map as a list. Your places are kept by the viewer only.
- **Knowledge graph.** A picture of a context store (for example your knowledge-base): each page is a dot, each link between pages is a line. Pages with more links are bigger. Pages with no links are drawn as rings. Point at a page to light up its neighbours, click it to open a panel with what it links to, what links to it, its tags, and a button to read its text. Search, filter by folder or tag, hide pages with no links, or show only the pages near the one you chose. Colour pages by folder or by tag. **Pause** stops the picture moving. **Show as a list** gives the same pages as a plain list you can use with the keyboard. The panel also says which Bowerloom items point at the store. The viewer reads only markdown files, follows no links to other places, and stops at 5,000 pages and 20,000 links, with a plain note when it does. Pages are read in the viewer's main part and the window gets only titles and links, never the text, until you press **Read this page**.
- **Sketch** (a tab on the Map). A drawing board for a harness. Drag teams, helpers, skills and prompts from the shelf (or press Enter on one), pull a thread from one to the next (a team to a helper, a helper to a skill or a prompt), give the sketch a name and save it. A sketch is only a drawing. **Apply to a project** is switched off until the app can safely write.
- **Library.** Your skills, prompts, and teams. Each row says where it came from (Yours, From GitHub, From npm), whether it is fixed to a version, and how many projects use it. Click one to read what is inside it. A helper with powerful settings gets a yellow warning.
- **Projects.** Lists projects only. The workspace (the folder that holds the rest) and the context stores (the central knowledge) have their own places on the same screen. Each folder's page has "What kind of folder is this?", where you can change what the viewer guessed. Your choice is kept by the viewer only.  Each project with a status: Ready, Drifted, Lock problem, or Not set up. Open one to see what it uses, whether each item matches what was locked, what drifted and why, its helpers, its knowledge slices, and its project list and lock file in plain sentences. "Show the raw files" shows the files as they are.
- **Knowledge folders.** Folders of notes outside your projects, which projects may read them, and a bar for each slice that compares what a helper reads at the start with reading everything.
- **Storage.** Where your library is, whether it is shared on GitHub, whether a GitHub access key is set (never the key itself), and the saved copies and their sizes.
- **Settings.** The folders the viewer searches for projects (adding or removing one only changes the viewer's own list), sample or your own data, light or dark, the version, and "Check for updates".

## Motion

Every duration, easing and distance of the app's motion is in one file, `renderer/motion-tokens.ts`, so you can retune it in one edit. Hanna confirmed the weighting on 2026-10-24 (see the header of `renderer/motion-tokens.ts`): the map is mostly restraint and speed, with a little playfulness only when you drop or connect something or tidy up; the knowledge graph is the gentle settling of the graph; panels are short and polished. If your computer is set to reduce motion, everything is instant.

## Prototype

A clickable prototype of Bowerloom 0.8, with six screens: setup, harness, skills, agents, knowledge, and versions. Every action is simulated in memory, so nothing is written, and a restart resets it. It runs with a temporary data folder that is removed when you close it. Open it with:

```
npm --prefix "<repo>" run desktop:prototype
```

## Where the viewer may write

The viewer writes in only two places. One is its own folder (its settings, and later your sketches). The other is the **sandbox**, a folder made only for trying things. It never writes in your real folders. A short piece of code, the write boundary, checks every place before anything is written there. It refuses a path with "..", a path through a shortcut (a link), a path outside the allowed folders, your home folder, any folder that holds your home folder, any of your real folders, and any folder that does not carry the mark the viewer puts in the sandbox. The list of allowed folders is fixed in the program. The settings file cannot change it, and neither can anything in the window.

Widening the places the viewer may write is not available. A later version will do it only with an explicit, confirmed step. Until then the viewer has no way to change a Bowerloom file of yours.

## The sandbox

A copy of the shape of your own setup, made of invented content, in the folder `Sage Advice Sandbox` next to `Sage Advice`. It has its own pretend home with its own shared library, so you can try everything without touching the real ones. A banner on every screen says "Sandbox: safe to break".

- `npm --prefix "<repo>" run desktop:sandbox` makes it if it is missing and opens the viewer on it.
- `npm --prefix "<repo>" run sandbox:reset` deletes it and builds it again. It refuses to delete anything unless the folder is exactly the sandbox folder and carries the viewer's mark, and has no shortcut that leads outside.

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
