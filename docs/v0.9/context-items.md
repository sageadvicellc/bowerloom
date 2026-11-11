# Context items

Status: written with the beta.2 Context page (issue 143). It records what a context item is and the gap the diagnosis found.

## What a context item is

A context item is a set of notes pages that the Library lists under Context. It comes from markdown files, never from a skill, an agent or a tool. A page is one `.md` file. A set is the pages of one folder, plus one set for each topic folder that holds at least `TOPIC_MIN_PAGES` pages.

The Library lists two kinds of context item.

- A notes set. The reader walks a place's own folder for markdown and builds the set from the pages it finds (`notesWalk`, `main/real-scan.ts`).
- A notes folder named by a harness. A harness lists a notes folder in `.bowerloom/knowledge.json` (`wiki-folder`, with an absolute path). The Library lists that name as a part of the harness. Since beta.2 the reader also walks the folder and lists its pages as a notes set.

## The gap the diagnosis found

Before beta.2 the Context tab was empty for a person who had notes, for four reasons.

1. The automatic walk never runs for a home place, so notes in the home folder were never read.
2. The walk stops at any subfolder that holds a tool folder or a project file, so a wiki with such a subfolder lost every page below it.
3. A folder named in `knowledge.json` was listed by name only. Its pages were never read.
4. Linking was an unlabeled plus that needed a folder with a harness already. The empty tab only said "Nothing in the Library matches."

## What the Library does now

- The reader of `main/real-scan.ts` is the frozen library of the base (`packages/engine-api/golden`). It stays as it is. `main/linked-notes.ts` adds the linked notes to the result the reader made, through the `keepRead` hook in `main/main.ts`. The check of the saved read looks at the linked folders too.
- The home folder is still never scanned for notes on its own. A notes folder is read only after the person links it.
- A link is stored in one of three forms: `.` (the harness folder), a plain path below it, or `~/` and a plain path below the home folder. No stored form is absolute. The reader refuses anything else (an absolute path, `..`, a hidden part, a drive letter), and a folder outside both the harness folder and the home folder has no stored form, so the link flow refuses it before anything is written.
- A link below the harness folder is part of the project and is read. A link in `~/` form is read only when the person picked that folder with "Use my notes" in main's own notes chooser ("Start fresh" records nothing). The pick is the approval: `main/notes-pick.ts` calls `packages/notes-source` (`approveFolder`), which records the native real path of the folder (`realpathSync.native`, SHA-256, cut to 32 characters) in `<state>/linked-notes/approved.json`. Only `main/notes-pick.ts` can call it, with the answer of the dialog of main; `tests/notes-pick-pins.test.ts` holds that.
- An approval is global for the folder: it holds for any harness that links that folder. The key is the name the file system itself gives the folder, on the write and on the read: on a volume that ignores case, `~/documents/notes` and `~/Documents/Notes` are one folder and one key; on a volume that keeps case they are two folders. A shortcut swapped later is another folder and needs a new pick. A `knowledge.json` from a cloned repository can name a folder, and it is not read until the person picks it.
- The limits: 8 linked folders for a harness (the rest is a problem), 200 sources of a `knowledge.json` looked at, 2000 approved folders in the record. The record folder is checked as the saved read is: a real folder, owned by this user, not writable by others, on a read and on a write.
- A failed approval is told at once in a message box of main, and the pick is handed back unchanged. main keeps the last failure of each folder in memory for the session (`main/pick-failures.ts`, no file), so the Library says "could not save approvals" for a link to it and never "link it again" while the cause stands. Each case has its own words and way out. A damaged record: the Library says "Saved approvals could not be read. Pick the folder again to start a new list." and the next pick moves the damaged file aside under a dated name and starts a new record; nothing is lost. A folder that cannot be used or written: "Bowerloom could not save approvals on this computer." A pick that is not a folder, and a damaged record that cannot be set aside, have words of their own. A damaged record is set aside under a name that nothing holds yet, so no earlier file is clobbered, and there is no cap on the files set aside. A full record: "Bowerloom keeps at most 2000 approved folders." Neither of the last two says "link it again", because that cannot work.
- Anything unexpected while the linked notes are read leaves the reader's result as it was and adds an "unreadable" problem; the check of the saved read becomes unresolved.
- A linked folder is read whole. The stop at a subfolder with a tool folder does not apply to it. The automatic walk of a work folder keeps that stop.
- The same caps hold for a place and its linked folders together: `filesPerPlace` files read, `pagesPerPlace` pages shown.
- Each link that is not read is a problem with a reason (not found, path not read, needs approval, record damaged, list unreadable, over a limit). The Context tab shows it. An empty tab with a problem shows the problem before any action.
- The empty Context tab shows "Link a notes folder". It opens the folder chooser. The label of a folder never picks the folder that gets the link: the person picks it from the list. A folder with no harness starts the New harness sheet, with its own approval. Nothing is written before an approval.
- The plus of every Library tab shows the word "Add".
