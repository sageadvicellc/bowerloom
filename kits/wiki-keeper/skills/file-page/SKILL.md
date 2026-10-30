---
name: file-page
description: Writes a new page, or updates an existing one, from what the wiki already holds or from what the person says. Use when the person wants a subject written down in the notes. It avoids duplicates, cites its sources, links the page both ways, and makes one commit.
---

# File a page

A page is a short note on one subject, kept in `pages/`. One subject, one page. This skill writes a new page or updates an existing one.

This skill changes pages. It makes one commit.

## Before you start

Run these two commands in the wiki folder.

```bash
git rev-parse --show-toplevel
git status --porcelain
```

- If the first command fails, or it does not print the wiki folder, the folder is not a git repository. Change nothing. Tell the person what you found, and say that the folder needs to become a git repository first.
- If the second command prints anything, the working tree is not empty. Stop. Tell the person which files are waiting, and ask them to commit those changes or set them aside. Do not tidy them yourself.

Then read `AGENTS.md` at the root of the wiki. It states the folders, the page fields, the link style, and the log format. If it disagrees with this skill, `AGENTS.md` wins.

## Steps

1. **Find out if the page exists.** Read `index.md`. Search `pages/` for the subject under other names too. If a page covers it, update that page. Do not make a second one.
2. **Gather the facts.** Use the sources in `sources/` and the pages that already exist. If the person tells you something new in the conversation, first save their words as a short Markdown note in `sources/`, named `YYYY-MM-DD-short-name.md`, so the page can cite it. Never write a fact that has no source.
3. **Write the page.** Name the file `pages/short-name.md`. Use lowercase letters and hyphens. Start with the page fields that `AGENTS.md` asks for. Put a one-sentence summary first. Keep to one subject. Use short sentences. Cite the source file next to each claim that came from it.
4. **Update, do not replace.** When you change an existing page, keep what is still true. Set `updated` to today. If you correct a claim, add a dated note that says what it used to say and what replaced it.
5. **Link both ways.** Link to related pages from the new page. Add a link back from each related page.
6. **Update `index.md`** when the page is new. One line: the link, then a short summary.
7. **Update `log.md`.** Add one line at the bottom, in the format that `AGENTS.md` gives.

## Finish with one commit

Stage only the files you wrote. Then make one commit.

```bash
git add -- pages/<page>.md index.md log.md
git commit -m "file page: <title>"
```

Add every other file you changed to the `git add` line, by its exact path. Never stage everything at once. Never skip a check or amend. If the commit fails, leave the files as they are and tell the person what went wrong.

## Stop and ask

- Two pages already cover the subject and you cannot tell which one should keep it.
- The page would hold a figure, a date, or a name that you cannot check.
- The facts disagree and you cannot tell which is right.

## Tell the person

Say which page you wrote or changed, which pages you linked, and the commit message. Keep it short.
