---
title: "Notes and the Notes keeper"
description: "Point agents at a folder of notes, and add the ready-made Notes keeper that looks after it."
section: "Guides"
order: 6.7
---

Notes are a folder of Markdown pages that you keep on your computer. In Bowerloom 0.8.0-beta.1 you can tell a harness where your notes are, and you can say which agents read them. The Notes keeper is a ready-made agent and a set of skills that look after a folder of notes. You build and save both in the [desktop app](/docs/app/).

## What a notes source is

A notes source is a pointer to a folder. It is not a part of the harness. It has a kind, a name, and a path. Beta.1 has one kind, `wiki-folder`, which is a folder of Markdown pages. The harness records its sources in `.bowerloom/knowledge.json`:

```json
{ "sources": [ { "kind": "wiki-folder", "name": "notes", "path": "<folder>" } ] }
```

An agent reads a source when its file in `.bowerloom/agents/` lists the source name under `notes` in its front matter. A name that is not in `knowledge.json` makes the harness fail to load with `NOTES_SOURCE_UNKNOWN`.

When you install, Bowerloom adds a short section called `## Notes` at the end of the instructions of each agent that lists a source. The section names each folder, and it says to read the `AGENTS.md` file at the root of that folder first. Bowerloom does not open the folder. Nothing limits which pages the agent reads, and the install plan says so on that line, as `translated`. [Harness, engines, and fidelity](/docs/concepts/harness-and-fidelity/) explains the word.

When you take a notes folder off a harness, the folder itself does not change.

## In the desktop app

1. The notes step asks "Where do you keep your notes?" You choose **Use my notes** and pick the folder, or **Start fresh** and pick or make an empty folder.
2. **Start fresh** lists the starter files first. **Create** writes them.
3. The app checks whether the folder keeps its history with git. If it does not, it offers to start one, so that changes can be undone. You can choose **No history for now**. Then the Notes keeper only reports and changes no page. If git is not on the computer, the keeper also only reports.
4. The Notes panel in the Builder shows each notes folder with its page count, the date of its last change, the agents that read it, and the latest tidy-up report. **Stop using these notes** takes the folder off the harness when you save. The folder itself stays.
5. A notes folder must be inside your home folder or inside the harness folder. The app refuses any other folder, the home folder itself, and a hidden folder or a folder inside one.

## The Notes keeper kit

The kit is one agent and six skills, and a starter set of notes files. The agent is `notes-keeper`. It looks after one folder of notes. It keeps the notes in git, so every change can be compared and undone.

| Skill | What it does | Changes pages |
| --- | --- | --- |
| `add-source` | Saves a new source untouched in `sources/` and turns it into notes. | Yes, one commit |
| `file-page` | Writes a new page, or updates one, from the notes or from what you say. | Yes, one commit |
| `answer-from-notes` | Answers a question from the pages and cites each page that it used. | No |
| `check-notes` | Reports problems such as broken links and pages missing from the index. | No |
| `log-change` | Brings `log.md` up to date with changes that you made by hand. | Yes, one commit |
| `refine-report` | Writes one tidy-up report that suggests merges, splits, stale pages, and missing links. | Writes only the report, one commit |

The starter files are `AGENTS.md`, `index.md`, `log.md`, and `README.md` files in `sources/`, `pages/`, and `reports/`. `AGENTS.md` states the folders, the page fields, and the log format. The agent reads it first, and it wins if a skill disagrees.

The rules of the keeper:

- A skill that changes pages starts from a clean working tree and ends with one commit that names the change. If the tree is not clean, the keeper stops and tells you.
- It never pushes, pulls, merges, rebases, resets, or amends. It only reads the history and adds one commit at a time.
- It changes no file outside the notes folder. In a larger repository, other files are your own work.
- It answers from the pages. If the pages hold no answer, it says so.
- It never deletes or rewrites a source.

The tidy-up report is the file `reports/YYYY-MM-DD-refine.md`. The agent suggests changes in it and makes none of them. In the app, the report opens in its own app from a private copy.

### Build the keeper

In the app, **Build my Notes keeper** opens the edit of a folder's harness with a guided tour of seven steps. The tour adds the keeper from the kit as a draft. Then you drag the first skill onto **Skills**, or press its **Add** button, and press **Add the other skills**. Then you put your notes on the **Notes** shelf. Changes stay a draft until you press **Save**, review the files, and tick the approval. The keeper then appears in the harness as `.bowerloom/agents/notes-keeper.md` with its skills under `.bowerloom/skills/`. **Help: replay the tour** shows the tour again.

The keeper reaches your engines only when you install the harness. A save changes `.bowerloom`, and installed files change only when you install. [Adopt and install a harness](/docs/guides/adopt-and-install/) shows how.

## Where the kit lives

The source of the kit is in the repository at `kits/wiki-keeper`. The command line has no form that adds the kit in this release.
