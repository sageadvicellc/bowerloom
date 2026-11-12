# Memory explorer

Status: written with lane 4 of the v0.9 next phase. It records what the Memory explorer reads, what it shows, the four analytics layers, and the choices made where the spec was silent.

## Terms

- Memory: the notes a person keeps as markdown files in a folder, in the style of Obsidian. A note is one `.md` or `.markdown` file.
- Harness context: what the Context tab of the Library shows. It holds the agents, skills, tools and sets of notes the reader found.
- Layer: one kind of count over a folder of notes.
- Read scope: the rule for what a module reads (`docs/v0.9/modules-view.md`).

## What it is

The Memory explorer is a stock extension. Its id is `memory-explorer`, its title is Memory, and its manifest is `apps/desktop/extensions/memory-explorer/manifest.json`. The Modules view lists it as a module. Its page opens at `#app/extension/memory-explorer`. The page only reads.

The page has two columns, side by side. On a narrow window they stack.

- Your notes. For each approved folder, the four layers, the most used tags, and the missing notes that links point at.
- Harness context. The count of agents, skills, tools and sets of notes, and the pages in those sets. It is the same data as the Context tab.

## How a person links a folder

1. The person presses Approve a folder. The page sends the module id and nothing else.
2. Main opens its own folder chooser. The pick is the approval. A cancel records nothing.
3. Main records the folder for the module `memory-explorer`, under the rules of the read scope: below the home folder, no hidden part, not in `~/Library`.
4. The page lists the folder's markdown files and reads them. The numbers appear.

Remove stops the reads. It deletes no file.

## What it reads

The explorer uses two calls of the `bowerloomModules` bridge:

- `listModuleFiles(moduleId, placeId)`. Main lists the visible, non-hidden, non-link markdown files of the approved folder. It reads names only, one entry at a time, and counts each entry as it reads it. It never follows a link. It leaves out a hidden part and a name with a control or bidirectional character. It skips a folder on another device. It stops at 5,000 files, 50,000 names or 5 seconds, and then it says the list was cut. It leaves out a folder more than 6 deep, says the list was cut, and goes on. The answer also holds `skipped`: the count of folders it could not list and entries it could not look at. After the walk, main checks the place again. A place that moved gives `PLACE_CHANGED` and no list.
- `readModuleFile(moduleId, placeId, path)`. Lane 2's call. It reads one text file of an approved folder. Every refusal of lane 2 holds: `BAD_PATH`, `OUTSIDE_PLACE`, `NOT_A_FILE`, `TOO_LARGE` (over 256 KiB), `NOT_TEXT`, `PLACE_CHANGED`, `NOT_APPROVED`.

The list is the one new call. No existing call lists the files of a place, and the Context page keeps no file path for a page. The call has its own golden file, `packages/engine-api/golden/module-list-calls.json`. The golden file of lane 2 and the base golden file are unchanged. `moduleCallSpec` finds the call. The decision is in `packages/module-scope` (`listPlaceFiles`), behind the same gate as a read.

The explorer reads no folder that the person did not approve for it. A folder linked on the Context tab shows in the harness context column. To see its links and tags, the person approves the same folder here. The Context page has no path for a page, so the explorer cannot read a linked folder without that approval.

## The caps and partial counts

The caps of the Context page still hold (`docs/v0.9/context-items.md`).

- At most `pagesPerPlace` (2,000) notes are read for one folder. The rest are listed and not shown. The page says how many.
- The count of notes and the index of links use every listed note, also those past the cap. A link to a note that was listed and not read is not a missing link.
- A count is a lower bound when part of the folder is not in it. The screen draws it with a plus sign and `data-partial`. Notes is partial when the list was cut or a folder or entry was skipped. Links, tags and missing links are also partial when a note was not shown, could not be read, or a total cap on distinct tags (5,000) or distinct missing targets (5,000) was reached. Notes in all folders is partial when any folder failed or was cut.
- A note that cannot be read still counts as a note. The page says how many could not be read, with the code. A failure of the parser has its own code, `PARSE_FAILED`.
- A refusal about the whole folder (`NOT_APPROVED`, `PLACE_CHANGED`, `RECORD_DAMAGED`, `RECORD_BLOCKED`, `HOME_UNREADABLE`) stops the read. The folder shows as failed with that code.
- Reads run 16 at a time. Refresh reads the folders again.
- The harness context column says when the folders were not read yet, and does not show zeros. It marks counts partial when the reader stopped early. A set whose pages are not known shows `n/a`.

## The four layers

The spec does not define the analytics layers (evidence gap E2). **These four are a proposal for Hanna.** Each one is computed from the files. No layer uses a model, a guess or a clock. The code is `apps/desktop/shared/memory/analytics.ts`.

1. Notes. The count of markdown files in the folder.
2. Links. One link is one note and one target. A note that links the same target twice has one link to it. A wiki link `[[Note]]` and a markdown link `[x](Note.md)` to the same note are one link.
3. Tags. The count of different tags, and the most used ones. A tag comes from the front matter (`tags: [a, b]`, `tags: a, b`, or a list under `tags:`) or from `#tag` in the text. A tag is lower case.
4. Links to a missing note. The links whose target is no note of the folder, and the targets they name.

What does not count:

- A link inside a code block or an inline code span. A `#tag` there is no tag either.
- A web address, a mail address, a link to a heading of the same note, and a link to a file that is not a note, such as a picture or a PDF.
- A number such as `#123` is no tag.
- A markdown link to a file with any ending but `.md` or `.markdown`. A wiki link stays permissive: `[[v1.2]]` is a note.

How a link finds its note. It follows Obsidian. A wiki link names a note by its file name, or by a path that ends the path of the note, in any letter case. A markdown link is a path from the folder of the note. When two notes share a name, the link goes to the first path in order.

A wiki link target keeps its text up to the first `|` or `#`. A backslash before the bar, as in a table (`[[Note\\|alias]]`), is cut. A target with another ending than a note, for example `v1.2`, is a note target. A known file ending (a picture, a PDF) is not.

A missing target with a control or bidirectional character is counted and not listed. The listed ones are drawn in `<bdi>`.

Not built, because the spec names no other layer: orphans, backlinks, word counts, dates, a graph, a search, and any layer that needs a model.

## Counts on the screen

Each number on the screen is in a `data-value` attribute beside the words. The test `apps/desktop/tests/memory-read.test.ts` reads those numbers and compares them with a count of files made without the explorer's code. The numbers for the basic fixture vault are worked out by hand in `apps/desktop/tests/memory-fixtures.ts`.

## Tests

- `packages/module-scope/test/list.test.mjs`: the list, its gate, its limits, links, hidden names.
- `packages/engine-api/test/module-list-calls.test.mjs`: the call and its golden file.
- `apps/desktop/tests/memory-analytics.test.ts`: tags, links, resolution, the four layers, and hostile text.
- `apps/desktop/tests/memory-read.test.ts`: the read through the real main, the parity of counts (also for a duplicate name, a hidden name, an odd name, a link, a long path and a note past the cap), the caps, refusals, and that the read changes no file.
- `apps/desktop/tests/memory-screen.test.ts`: the markup of each state, the harness context, the registration, and the rules of the page.
- `apps/desktop/tests/modules-bridge.test.ts`: the table of five calls held equal to the two golden files.

## Choices made where the spec was silent

- The layers are the four above. The spec lists none.
- Memory is the folders approved for the module. The spec says "a person links a notes folder". The only path that lists files and reads text is the read scope of lane 2, so linking is an approval.
- Harness context is read from the parts the Library already holds, with no new call. A set's page count comes from its summary line.
- The list call is a fifth call of the modules bridge, with its own golden file and its own list in the contract package. The other option was a new bridge, which needs a change to the bridge guards of the page and the preload. This lane did not widen any guard.
- The explorer has its own route and no page inside the Modules view. The view lists it and opens its own page.

## Not done

- No end-to-end test. The folder chooser is a native window, as in lane 2.
- The explorer does not read a folder linked on the Context tab unless the person also approves it here.
- The sample launch has no approvals, so it shows the harness context and says so.
- No run on a Mac.
