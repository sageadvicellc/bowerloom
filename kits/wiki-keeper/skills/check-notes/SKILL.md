---
name: check-notes
description: Checks the wiki for problems and reports them without fixing anything. Use when the person asks if their notes are in good shape. It finds broken links, pages with no links, missing page fields, sources that do not exist, and pages missing from the index.
---

# Check the notes

This skill looks for problems in the wiki and reports them. It changes nothing. It writes no file and makes no commit. It works the same in a folder that is not inside a git work tree.

Read `AGENTS.md` at the root of the wiki first. It states the page fields and the link style. If it disagrees with this skill, `AGENTS.md` wins.

## The checks

Check the pages in `pages/`, and `index.md`. Skip `reports/` and `sources/`.

1. **Broken links.** Each link from a page to another page must point to exactly one page that exists. Report a link that points to no page. Report a link that could mean two pages, because that means two pages cover one subject.
2. **Pages with no links.** Report each page that no other page links to. Report each page that links to no other page. A page with no links is hard to find.
3. **Missing frontmatter.** Frontmatter is the block of fields at the top of a page. Each page needs the fields that `AGENTS.md` names. By default these are `title`, `created`, `updated`, and `sources`. Report each page that lacks one, and which field.
4. **Sources that do not exist.** Each file in a page's `sources` list must exist in `sources/`. This is the most serious finding. It means a page was written from something that was never saved.
5. **Index parity.** Each page must have a line in `index.md`. Each line in `index.md` must point to a page that exists. A page missing from the index is invisible.
6. **Pages on the same subject.** Read the page titles and first lines. Report two pages that seem to cover the same subject. Report two pages that state the same fact in different ways. This check needs reading, so say how sure you are.

## Report

Start with the count of problems for each check. Then list each problem as the page path and a short note on what is wrong. If a check finds nothing, say so. A clean report is useful: it shows that the check ran.

If there are many problems, more than about twenty, say that the cause is probably the rules and not the pages. Suggest that the person look at `AGENTS.md`.

## Fixing

Do not fix anything here. Offer to fix the problems with the file-page skill, one page at a time, or to record the check in the log with the log-change skill. Let the person choose.
