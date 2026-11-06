---
title: "Desktop app (beta)"
description: "Open the unsigned macOS app, then build, save, install, and undo a harness on screen."
section: "Start here"
order: 1.5
---

The Bowerloom desktop app is a main part of Bowerloom 0.8.0-beta.1, next to the command line. It is a beta. It does the same adopt, install, and remove steps as the commands in [Adopt and install a harness](/docs/guides/adopt-and-install/). It also has the Builder, the save step, and Save points, which the command line does not have. Both share one install record, so you can use them on the same project.

The app is for macOS. It shows a plan and its words before every change. Nothing is written until you approve the plan.

## Open it on your folders or on a sample

The app opens with no flag, on your own folders. It reads the folders you tick, and it writes only a plan you approve. From a source checkout, run `npm run desktop`.

`npm run desktop:sample` opens the same app on invented sample folders. Nothing on your computer is read or written, and the mark at the foot of the menu says **Preview** instead of **Beta**. Use it to see every state of the app at once.

## Open the unsigned app

Apple did not sign or notarize this app. The first time you open it, macOS blocks it and shows a warning. The source is in the repository, so you can read it first.

1. Download the app from the [GitHub release page of Bowerloom 0.8.0-beta.1](https://github.com/sageadvicellc/bowerloom/releases/tag/v0.8.0-beta.1). Pick the `arm64` file for a Mac with Apple silicon. Check the download against its SHA-256 hash, which is listed with it.
2. Move `Bowerloom.app` to your Applications folder.
3. Open the app once. macOS shows a warning. Close the warning.
4. Open the Apple menu, then System Settings.
5. Click Privacy & Security, then scroll down to Security.
6. Click Open Anyway next to the message about Bowerloom.
7. If macOS asks for your login password, enter it. Then click Open.

After this, the app opens like any other app. If you do not want to allow an unsigned app, use the command line. [Adopt and install a harness](/docs/guides/adopt-and-install/) covers the install steps there.

## The first minute

The app opens on a welcome screen. It says that Bowerloom only reads, and that nothing changes until you press Install. Press **Find my files**.

::visual{id="app-welcome"}

The app then looks for the engine files of your folders and lists what it found, with counts. Each source is ticked. Untick a source to skip it. Bowerloom reads the names and the text of the files you keep, and the text stays on your computer. Press **Looks right**, and then **Make a harness from this** for each source, or **Make all** for every source. The notes step follows. [Notes and the Notes keeper](/docs/guides/notes/) covers it.

::visual{id="app-find-files"}

The left menu then holds Harnesses, Library, Projects, and Runs. At its foot are Engines, Install history, and Help. Harnesses lists the folders that have a harness. Projects lists your folders and the harnesses installed in them. Engines lists each engine with its health and a switch. The switch decides whether the install offers that engine.

::visual{id="app-engines"}

Install history is the install undo list. Each row is one change, newest first, with an **Undo** that puts back what the change replaced. Only the newest change of one install can be undone. On your own folders the list starts empty, and a folder install is not listed here. To undo a folder install, press **Undo** in the install sheet, then approve the removal.

::visual{id="app-install-history"}

## The Beta mark and the blocked controls

Under the menu, a **Beta** mark opens a short note about this beta. It lists the controls that are **Not in beta.1**. Those controls show the words "Not in beta.1" and do nothing yet:

- Start, on a harness
- Compare
- Runs
- Assign to project, in the details of a harness
- Assign harness, in Projects
- Add, the plus button in the Library

**From a folder** and **Install from a folder** in Projects work, and so does the save step in the Builder. So do **Add a folder**, **Install**, **Update**, and **Review** in Projects. This page covers them below.

## Make a harness from a folder

On Projects, **From a folder** opens New harness from a folder. It has four steps: Folder, Review, Confirm, and Done. It does what `bowerloom harness adopt` does.

- It reads the files of the folder and says how many it read. Nothing is written yet.
- If two copies of one item differ, you pick one copy.
- It lists the rules that differ by engine, and everything it leaves out, with the reason.
- **Use for every engine** is one tick for each part, off by default. It matches `--every-engine`.
- Before it writes, you tick each approval and each acknowledgement. A secret is replaced by a reference.
- It writes only into the `.bowerloom` folder of that project. It changes no engine file.

::visual{id="app-adopt-sheet"}

## Install a folder's harness

**Install from a folder** opens Install a folder's harness. It has four steps: Folder, Engines, Review, and Done. It does what `bowerloom harness install` does.

- The review shows, for each engine and each part, a dot and one of four words: Exact, Translated, Weakened, or Absent, with the reason. [Harness, engines, and fidelity](/docs/concepts/harness-and-fidelity/) explains them.
- A rule that an engine carries more weakly than the harness says needs your tick first. A tick matches `harness accept`.
- The review also shows what waits for your trust, and every command and file of code that it will write, in full.
- When `AGENTS.md` and `CLAUDE.md` differ, it shows which engine reads which. **Accept AGENTS.md** is the default. **Merge** moves the text of `CLAUDE.md` into the harness, with its own plan and its own approval. **Keep both** leaves `CLAUDE.md` as it is.
- You approve the plan by its number. Then **Write N files** writes them.
- **Undo** opens the removal plan, and you approve it the same way. A run that stopped part way gets a recovery plan.
- When only the mode of a file changed after Bowerloom wrote it, the file shows **Restore mode** and **Keep new mode**.

::visual{id="app-install-review"}

## Projects: Add a folder, Install, Update, and Review

Projects lists the folders the read found and the folders you add. Press the plus button, **Add a folder**, and choose a folder in the system chooser. The folder joins the list. Nothing is written.

Each row shows whether the folder holds a harness, and a dot for each engine. These dots come from the install record of the folder and from a plan that only reads. The button follows the state:

- **Install** when the folder has a harness and no install. It opens Install a folder's harness with that folder picked.
- **Update** when the harness has moved past what Bowerloom wrote. It opens the plan at once.
- **Review** when a file that Bowerloom wrote was changed or removed, when a run stopped part way, or when the harness does not load. It opens the plan, or the recovery plan, and says what it found.

A folder that the read found but that Bowerloom has not opened yet shows **Not checked**. Its button opens the system chooser first. Bowerloom takes only the folder shown, and refuses any other. These buttons write only after you approve the plan and say yes in the second question. **Undo** in the sheet removes the install the same way.

Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness show a Preview tag. You can install to them only when the app starts with `BOWERLOOM_PREVIEW_ENGINES=1`. Reading and removing work for all five.

## The Builder

On Harnesses, **Open <name> in the builder** opens one folder's harness as a graph. Agents sit on the left and skills on the right.

- Drag a skill onto an agent to link them. You can also press the circle of an agent, then a skill.
- Unlink removes a link. **Undo** and **Redo** step through your changes.
- The count of changes shows at the top. Changes stay a draft until you save. Leaving with unsaved changes asks "Discard N changes?"
- You can take a skill out, or copy a skill from another folder.

::visual{id="app-builder"}

## The save step

**Save** opens Edit a folder's harness. It has four steps: Folder, Edit, Review, and Done.

1. Review lists each `.bowerloom` file that the save changes, and the skills each agent uses.
2. Tick **I approve plan** with the plan number.
3. Press **Save N files**.

A save changes only the `.bowerloom` harness of that folder. Installed engine files change only when you install. If a save stops part way, the app says so, and the command line refuses install, remove, accept, adopt, and merge until you finish the stopped save in the app.

::visual{id="app-save-review"}

## Save points, Go back, and Set aside

Every save keeps a save point, which is a copy of the harness as it was. The first save also keeps the harness as it was found, so **Go back** always has somewhere to go.

- The clock button at the top of the Builder opens Save points. Each row has its number, what changed, its time, and how many files it holds. The row marked Now is the current harness.
- **Go back** on a row puts the harness as it was at that save point. Bowerloom also keeps the harness as it is now as a save point, so nothing is lost and the list only grows. Going back changes only `.bowerloom`, and you review and approve it first, as you do for a save.
- **Set old save points aside** shows only when the app refuses the record of save points, because the record is not whole or is not safe to read. It starts a new record. It shows a review first. It deletes nothing, and **Go back** then starts again from the next save.

::visual{id="app-save-points"}

## Export and import

Press **Export** in the header of the Builder to write the saved harness to one file. Press **Import from a file** in the Folders block of Harnesses, or in the empty state when you have no harness, to read such a file. Each opens a sheet that shows what the file holds. Import writes nothing until you tick the boxes and approve. Export asks for a tick only when the files hold a path from this computer. Import goes only into a folder with no harness, or an empty one. [Share a harness](/docs/guides/share-a-harness/) covers what the file holds, what to read first, and the limits.

::visual{id="app-import-sheet"}

## See everything in one graph

The Overview is the first screen after the read. It shows every place Bowerloom found, in one graph or a list: your folders, the agents, skills, and tools in each, and the sets of notes they use. Every place starts closed, except your home, which is open. When there are more than 40 parts, the home starts closed too. Press **Expand** or **Collapse** on a place, or **Expand all** or **Collapse all**.

- A place under your home folder marked **In Bowerloom** has a harness, and **Open in builder** opens it. Every other place has **Choose this folder**. It asks you to pick that folder. If you pick another, the app says "That is not the folder shown" and adds nothing.
- A place marked **Not in Bowerloom yet** is under your home folder and has files but no harness. A folder outside your home folder shows no mark, because the app cannot tell, and it never reads **In Bowerloom**.
- A folder that already holds a harness that Bowerloom has not opened gets a place of its own, named after the harness with **(Bowerloom)** added. It has **Choose this folder**, like any place the app has not opened. If the files of that harness cannot be read, the place says "Bowerloom could not read this harness."
- Select a part to see what it uses, what uses it, and the other places where it is found. A part that runs code says so.
- Use **Graph or list** to switch the view. The arrow keys move, Enter selects, and Escape clears.
- The Overview is read-only. It changes no file. Open a place in the builder to change it.

::visual{id="app-overview"}

## Notes

The Notes panel and the Notes keeper kit are covered in [Notes and the Notes keeper](/docs/guides/notes/).

## Help menu

**Help > Report a problem** builds a diagnostic bundle that you read before you send it. **Help > Usage log** shows the local event log. The app makes no network call by itself. [Report a problem](https://github.com/sageadvicellc/bowerloom#report-a-problem) in the README gives the details.

::visual{id="app-help"}
