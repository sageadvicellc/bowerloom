---
name: refine-report
description: Studies the whole wiki and writes one tidy-up report that suggests topics to merge, pages to split or shorten, stale pages, and missing links. Use when the person asks for a tidy-up or refinement report. It writes only the report, commits only the report, and changes no other page.
---

# Write a refinement report

This skill studies the wiki and writes one report page. The report suggests how to make the notes better. It does not make those changes. The person acts on a suggestion by asking you, or by hand.

This skill writes one file: `reports/YYYY-MM-DD-refine.md`, with today's date. It makes one commit.

## Before you start

The wiki is a git repository of its own, or a folder inside a larger repository. Either way, run this command in the wiki folder. The `-- .` limits it to the wiki folder, so a change elsewhere in a larger repository does not count.

```bash
git status --porcelain -- .
```

- If `git status --porcelain -- .` fails, the folder is not inside a git work tree. Change nothing. You may still study the notes and show the person the report in the chat. Do not save a file.
- If the command prints anything, the working tree of the wiki is not empty. Stop. Tell the person which files are waiting, and ask them to commit those changes or set them aside.

Then read `AGENTS.md` at the root of the wiki. It states the page fields and the link style. If it disagrees with this skill, `AGENTS.md` wins.

Find today's date.

```bash
date +%Y-%m-%d
```

If `reports/` already holds a file for today's date that ends in `-refine.md`, the report already exists. Stop. Tell the person. Never overwrite a report.

## Study the wiki

Read `index.md`. Then read the pages in `pages/`. Read the frontmatter and the headings of every page. Read a whole page when the headings do not tell you enough. If the wiki is very large, begin with the pages that have the oldest `updated` date, and say in the report how many pages you read out of how many exist.

Look for four things.

1. **Topics to merge.** Two or more pages that cover one subject. Say which page should stay, and what should move into it.
2. **Pages to split or shorten.** A page that holds several subjects should be split. A page that repeats itself, or runs very long, should be shortened. Name the subjects or the passages.
3. **Stale pages.** A page whose `updated` date is older than a newer source on the same subject. Or a page that has not changed in over six months while the pages it links to have. Say what makes it look old.
4. **Missing links.** Two pages about the same subject that do not link to each other. A name or a subject that appears on three or more pages and has no page of its own.

## Write the report

Write `reports/YYYY-MM-DD-refine.md` with today's date. Start with these fields, as `AGENTS.md` asks for pages: `title`, `created`, and `updated`, both set to today, and an empty `sources` list.

Then write:

- A short summary: how many pages you read, and how many suggestions you have.
- One section for each of the four kinds of suggestion. If a kind has no suggestion, say so.
- For each suggestion: the page paths it involves, why you suggest it, what to do, and whether the job is small or large.
- A last section called "What to ask next". List the first three jobs worth doing, each as a sentence the person can say to you.

Cite pages by path. Do not state a fact about a page that you did not read. If you are unsure, say so.

## What you must not do

This is the only file you write. Change no other file or page. Do not edit `index.md` or `log.md`. Do not fix a problem you found. The person decides. Do not delete or move a page.

## Finish with one commit

Stage only the report. Then make one commit of only the report. The message holds only letters, digits, spaces, and hyphens after the colon, on one line. It reaches git through a quoted heredoc, so nothing in it runs.

```bash
git add -- reports/YYYY-MM-DD-refine.md
git commit -F - -- reports/YYYY-MM-DD-refine.md <<'MSG'
refine report: YYYY-MM-DD
MSG
```

Use today's date in all three lines. Run both lines in the wiki folder. The commit names the exact paths it takes, so nothing else that is staged in a larger repository goes into it. Never skip a check or amend. If the commit fails, leave the file as it is and tell the person what went wrong.

## Tell the person

Say where the report is, how many suggestions it holds, and the first job you suggest.
