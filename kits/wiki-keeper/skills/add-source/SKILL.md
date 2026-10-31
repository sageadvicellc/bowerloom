---
name: add-source
description: Saves a new source into the wiki and turns it into notes. Use when the person hands over a file, a note, a transcript, or pasted text to keep. It keeps the original untouched, writes a summary page, updates related pages, and makes one commit.
---

# Add a source

A source is an original item, saved as it came: a file, a note, a transcript, pasted text. The wiki keeps every source untouched in `sources/`. Pages in `pages/` hold what you learn from it.

This skill changes pages. It makes one commit.

## Before you start

Check that the wiki folder holds a `.git` folder at its root. Then run this command in the wiki folder.

```bash
git status --porcelain
```

- If there is no `.git` folder at the root, or `git status --porcelain` fails, the folder is not a git repository. Change nothing. Tell the person what you found, and say that the folder needs to become a git repository first.
- If the command prints anything, the working tree is not empty. Stop. Tell the person which files are waiting, and ask them to commit those changes or set them aside. Do not tidy them yourself.

Then read `AGENTS.md` at the root of the wiki. It states the folders, the page fields, the link style, and the log format. If it disagrees with this skill, `AGENTS.md` wins.

## Steps

1. **Save the source.** Copy it into `sources/`. Name it `YYYY-MM-DD-short-name.ext`. Use the date the source was made. If you do not know it, use today's date, and say so on the summary page. If the person gives you a link and you cannot open it, ask for the text. Never save a guess in its place. If the person gives pasted text, save it as a Markdown file.
2. **Never edit a source.** Not a typo, not a format. A source stays as it came.
3. **Read all of it.** Do not summarize from the first screen. If the source is too long to read at once, add it in parts, one commit for each part.
4. **Write one summary page** in `pages/`. Give it the page fields that `AGENTS.md` asks for. List the source in `sources`. Say what the source claims. Mark your own conclusions as yours, or put them under an "Open questions" heading.
5. **Update related pages.** Find pages on the same subjects. Add the new facts, cite the source, and set `updated` to today. Change at most five existing pages. If more pages are touched, list the rest for the person and ask.
6. **Link both ways.** The summary page links to each page it touches. Each of those pages links back. A page that nothing links to is a page nobody finds.
7. **Handle a conflict.** If the source disagrees with a page, do not overwrite the page. Add a dated note on the page: what it said, what the new source says, and which source. If both are credible, state the disagreement. Do not pick a winner in silence.
8. **Update `index.md`.** Add one line for each new page.
9. **Update `log.md`.** Add one line at the bottom, in the format that `AGENTS.md` gives. Name the source file and say how many pages you created and changed.

## Finish with one commit

Stage only the files you wrote. Then make one commit. Write `<short name>` from the source's name, reduced to letters, digits, spaces, and hyphens. Drop every other character, and keep it on one line. The message reaches git through a quoted heredoc, so nothing in it runs.

```bash
git add -- sources/<source-file> pages/<summary-page>.md index.md log.md
git commit -F - <<'MSG'
add source: <short name>
MSG
```

Add every other page you changed to the staging line above, by its exact path. Never stage everything at once. Never skip a check or amend. If the commit fails, leave the files as they are and tell the person what went wrong.

## Stop and ask

- The source holds a figure, a date, or a name that you cannot check, and a page would repeat it.
- The source disagrees with a page and you cannot tell which is right.
- The source is very large or looks private, and saving it would copy it to a new place.
- You cannot tell what the source is about.

## Tell the person

Say what you saved, which pages you made and changed, and the commit message. Keep it short.
