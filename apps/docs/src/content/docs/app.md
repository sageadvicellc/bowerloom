---
title: "Desktop app (beta)"
description: "Open the unsigned macOS app, then build, save, install, and undo a harness on screen."
section: "Start here"
order: 1.5
---

The Bowerloom desktop app is a main part of Bowerloom 0.8.0-beta.1, next to the command line. It is a beta. It does the same adopt, install, and remove steps as the commands in [Adopt and install a harness](/docs/guides/adopt-and-install/). It also has the Builder, the save step, and Save points, which the command line does not have. Both share one install record, so you can use them on the same project.

The app is for macOS. It shows a plan and its words before every change. Nothing is written until you approve the plan.

## Open the unsigned app

Apple did not sign or notarize this app. The first time you open it, macOS blocks it and shows a warning. The source is in the repository, so you can read it first.

1. Download the app from the GitHub release page of Bowerloom 0.8.0-beta.1. The release must be approved and published first. This page does not link a file.
2. Move `Bowerloom.app` to your Applications folder.
3. Open the app once. macOS shows a warning. Close the warning.
4. Open the Apple menu, then System Settings.
5. Click Privacy & Security, then scroll down to Security.
6. Click Open Anyway next to the message about Bowerloom.
7. If macOS asks for your login password, enter it. Then click Open.

After this, the app opens like any other app. If you do not want to allow an unsigned app, use the command line. [Adopt and install a harness](/docs/guides/adopt-and-install/) covers the install steps there.

## The first minute

The app opens on a welcome screen. It says that Bowerloom only reads, and that nothing changes until you press Install. Press **Find my files**.

The app then looks for the engine files of your folders and lists what it found, with counts. Each source is ticked. Untick a source to skip it. Bowerloom reads the names and the text of the files you keep, and the text stays on your computer. Press **Looks right**, and then **Make a harness from this** for each source, or **Make all** for every source. The notes step follows. [Notes and the Notes keeper](/docs/guides/notes/) covers it.

The left menu then holds Harnesses, Library, Projects, Runs, Engines, and Help. Harnesses lists the folders that have a harness. Projects lists your folders and the harnesses installed in them.

## Make a harness from a folder

On Projects, **From a folder** opens New harness from a folder. It has four steps: Folder, Review, Confirm, and Done. It does what `bowerloom harness adopt` does.

- It reads the files of the folder and says how many it read. Nothing is written yet.
- If two copies of one item differ, you pick one copy.
- It lists the rules that differ by engine, and everything it leaves out, with the reason.
- **Use for every engine** is one tick for each part, off by default. It matches `--every-engine`.
- Before it writes, you tick each approval and each acknowledgement. A secret is replaced by a reference.
- It writes only into the `.bowerloom` folder of that project. It changes no engine file.

## Install a folder's harness

**Install from a folder** opens Install a folder's harness. It has four steps: Folder, Engines, Review, and Done. It does what `bowerloom harness install` does.

- The review shows, for each engine and each part, a dot and one of four words: Exact, Translated, Weakened, or Absent, with the reason. [Harness, engines, and fidelity](/docs/concepts/harness-and-fidelity/) explains them.
- A rule that an engine carries more weakly than the harness says needs your tick first. A tick matches `harness accept`.
- The review also shows what waits for your trust, and every command and file of code that it will write, in full.
- When `AGENTS.md` and `CLAUDE.md` differ, it shows which engine reads which. **Accept AGENTS.md** is the default. **Merge** moves the text of `CLAUDE.md` into the harness, with its own plan and its own approval. **Keep both** leaves `CLAUDE.md` as it is.
- You approve the plan by its number. Then **Write N files** writes them.
- **Undo** opens the removal plan, and you approve it the same way. A run that stopped part way gets a recovery plan.
- When only the mode of a file changed after Bowerloom wrote it, the file shows **Restore mode** and **Keep new mode**.

Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness show a Preview tag. You can install to them only when the app starts with `BOWERLOOM_PREVIEW_ENGINES=1`. Reading and removing work for all five.

## The Builder

On Harnesses, **Open <name> in the builder** opens one folder's harness as a graph. Agents sit on the left and skills on the right.

- Drag a skill onto an agent to link them. You can also press the circle of an agent, then a skill.
- Unlink removes a link. **Undo** and **Redo** step through your changes.
- The count of changes shows at the top. Changes stay a draft until you save. Leaving with unsaved changes asks "Discard N changes?"
- You can take a skill out, or copy a skill from another folder.

## The save step

**Save** opens Edit a folder's harness. It has four steps: Folder, Edit, Review, and Done.

1. Review lists each `.bowerloom` file that the save changes, and the skills each agent uses.
2. Tick **I approve plan** with the plan number.
3. Press **Save N files**.

A save changes only the `.bowerloom` harness of that folder. Installed engine files change only when you install. If a save stops part way, the app says so, and the command line refuses install, remove, accept, adopt, and merge until you finish the stopped save in the app.

## Save points, Go back, and Set aside

Every save keeps a save point, which is a copy of the harness as it was. The first save also keeps the harness as it was found, so **Go back** always has somewhere to go.

- The clock button at the top of the Builder opens Save points. Each row has its number, what changed, its time, and how many files it holds. The row marked Now is the current harness.
- **Go back** on a row puts the harness as it was at that save point. Bowerloom also keeps the harness as it is now as a save point, so nothing is lost and the list only grows. Going back changes only `.bowerloom`, and you review and approve it first, as you do for a save.
- **Set old save points aside** shows only when the app refuses the record of save points, because the record is not whole or is not safe to read. It starts a new record. It shows a review first. It deletes nothing, and **Go back** then starts again from the next save.

## Notes

The Notes panel and the Notes keeper kit are covered in [Notes and the Notes keeper](/docs/guides/notes/).

## Help menu

**Help > Report a problem** builds a diagnostic bundle that you read before you send it. **Help > Usage log** shows the local event log. The app makes no network call by itself. [Report a problem](https://github.com/sageadvicellc/bowerloom#report-a-problem) in the README gives the details.
