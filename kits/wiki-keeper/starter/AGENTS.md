# How this wiki works

This folder is a wiki: a set of short notes written in Markdown. It is also a git repository. Git keeps every version of every file, so you can compare changes and undo them.

An agent reads this file first. A person can read it too. If you change a rule here, the agent follows the new rule.

## The folders

- `sources/` holds originals, saved as they came. A source is a file, a note, a transcript, or pasted text. Nobody edits a source after it is saved.
- `pages/` holds the notes. One page covers one subject. Pages are built from sources.
- `reports/` holds reports that the Notes keeper writes, such as a tidy-up report.
- `index.md` lists every page, one line for each.
- `log.md` records every change, one line for each.

## File names

- Use lowercase letters, digits, and hyphens. Example: `garden-plan.md`.
- A source starts with the date it was made: `2026-01-31-garden-notes.md`.
- A report starts with the date it was written and ends with its kind: `2026-01-31-refine.md`.

## Frontmatter

Frontmatter is a small block of fields at the very top of a page. It sits between two lines of three dashes.

```
---
title: Garden plan
created: 2026-01-31
updated: 2026-02-14
sources:
  - sources/2026-01-31-garden-notes.md
---
```

Every page in `pages/` needs these four fields.

- `title`: the name of the page.
- `created`: the day the page was made, as year-month-day.
- `updated`: the day the page last changed, as year-month-day.
- `sources`: the files in `sources/` that the page is built from. Use `sources: []` if there are none.

## Links

- Link to another page with its file name, without `.md`, inside double square brackets. Example: `[[garden-plan]]`.
- When page A links to page B, add a link from B back to A.
- A page that no other page links to is hard to find. Link every new page from at least one other page.

## How to write a page

- Put a one-sentence summary first.
- Cover one subject on each page.
- Use short sentences and plain words.
- Name the source file next to each claim that came from a source.
- If a new source disagrees with a page, do not erase the page. Add a dated note that says what it used to say, what replaced it, and why.

## The index

`index.md` has one line for each page. The line holds the link and a short summary:

```
- [[garden-plan]]: What to plant, and when.
```

## The log

`log.md` has one line for each change. Add new lines at the bottom. Never edit an old line. Use this format:

```
YYYY-MM-DD | what happened | what it touched | result
```

Example:

```
2026-01-31 | add source | sources/2026-01-31-garden-notes.md | created 1 page, changed 0
```

## Changes

Every change to this wiki is one commit. The commit message says what changed. An agent stops if the folder has changes that are not committed yet.
