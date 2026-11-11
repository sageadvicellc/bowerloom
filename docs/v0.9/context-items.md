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

- The home folder is still never scanned for notes on its own. A notes folder is read only after the person links it.
- A linked folder is read whole. The stop at a subfolder with a tool folder does not apply to it. The automatic walk of a work folder keeps that stop.
- The same caps hold for a place and its linked folders together: `filesPerPlace` files read, `pagesPerPlace` pages shown.
- The empty Context tab shows "Link a notes folder". It opens the folder chooser. A folder with a harness takes the link after one approval. A folder with no harness starts the New harness sheet first, with its own approval. Nothing is written before an approval.
- The plus of every Library tab shows the word "Add".
