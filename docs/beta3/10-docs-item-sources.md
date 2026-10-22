# 10. Docs for the store, the lock, and item sources

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 9 and decision 20. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decision 20: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333018480. The settled variants and the token: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333364163.
- Lane: 2. Hanna calls this a release requirement, not a footnote. Beta.3 does not ship without it.
- Branch: `beta3/10-docs-item-sources`.
- Depends on: specs 03, 04, 06, 07, 08, and 09, merged. Write this spec's track last, against the merged code. Every example is checked against that code.
- Line numbers below are from commit c9730d3. If a line moved, find the place by its text.

## 2. Problem

Hanna called the idea "an embedded nuance". A person must understand four things before they share a project that uses the store. They must know where each item's bytes come from. They must know what the lock file records. They must know what a teammate needs. They must know the result for a store with no remote.

The code answers each question, but only a page can explain it. Without the page, a person finds the answer by hitting a refusal. The page also gives a reader one place to learn the whole model: the store, the config, the lock, the caches, and the commands that connect them.

Specs 03 to 09 each write the docs lines of their own track. This spec adds the page, then reads every other beta.3 docs change for consistency, and adds the checks that keep the docs true.

## 3. Behavior

### 3.1 The new page

- File: `apps/docs/src/content/docs/guides/item-sources.md`.
- URL: `/docs/guides/item-sources/`.
- Front matter, exactly:

```text
---
title: "Where your items come from"
description: "See where each skill, prompt, and team comes from, what bowerloom.lock.json records, and what a teammate needs."
section: "Guides"
order: 7.8
---
```

The order 7.8 sits after `create-items.md` (7.7). No other page uses 7.8.

Writing rules for the whole page. They are the repository's simple-English rules.

1. Short sentences. At most 20 words each.
2. Active voice. Simple tenses. No perfect tenses.
3. Put each condition before its command. Example: "If the store has no remote, push it."
4. Use one word for one thing: "store", "project item", "pin", "lock", "frozen install", "remote", "cache".
5. Define each term at first use, in the sentence that introduces it.
6. Use no modal verbs. The test in section 10, case 9, holds the word list. Say what Bowerloom does and what the reader does.
7. No semicolons. No dashes as punctuation.
8. Do not name Fearless or Advanced Metrics (repository rule 9).
9. No private paths. `check:links` fails a page that holds `/Users/`.
10. Use `bowerloom` commands exactly as they print.

The page has these headings, in this order. Each heading has an anchor `<a id="...">` line above it with the id in the last column. The builder writes the prose from the required facts. Every fact in a section must appear on the page, in the section where it is listed.

| Heading | Anchor id |
|---|---|
| `## What this page answers` | `what-this-page-answers` |
| `## The four kinds of item` | `four-kinds-of-item` |
| `## The two files` | `the-two-files` |
| `## If you work alone` | `work-alone` |
| `## If you share a project` | `share-a-project` |
| `## What a teammate does` | `what-a-teammate-does` |
| `## When the store has no remote` | `store-has-no-remote` |
| `## A store in a private repository` | `private-store` |
| `## Frozen installs and plain apply` | `frozen-and-plain` |
| `## Change an item` | `change-an-item` |
| `## Merge conflicts in the lock` | `lock-conflicts` |
| `## Move a project to the store` | `move-to-store` |
| `## Refusals` | `refusals` |
| `## Words used on this page` | `words` |

#### Section 1. What this page answers

Required facts:

1. The page answers four questions. Each question is a bullet that links to its section. The questions: where each item's bytes come from, what `bowerloom.lock.json` records, what a teammate needs, and the result for a store with no remote.
2. One sentence that says who needs this page: anyone who shares a project that uses the store, and anyone who wonders where an installed file came from.
3. One sentence says the page covers beta.3 and later. A second sentence says a project without `bowerloom.json` works as in beta.2. It links to the section "Move a project to the store".

#### Section 2. The four kinds of item

Required facts:

1. A skill, a prompt, and a team are the three things Bowerloom installs or selects. Define each in one sentence. A team installs no file. Only skills and prompts put copies in `.claude` and `.agents`.
2. A table with four rows and these columns: kind of item, where it is defined, where its bytes come from, in the lock. Copy the rows and cells from the table in spec 06, section 3.1. Change only the wording, to match the rules above.
3. The sentence: "The lock never records project items. Git versions them."
4. The definition of "store": the folder `~/.bowerloom` on your machine. It holds definitions, and no cache and no installed copy. Link to the `store status` paragraph of `cli.md`.
5. The definition of "pin": an exact npm version or a full GitHub commit with the hashes of the files.
6. The two caches: the skills cache and the store cache. One sentence each. Both live outside your projects and outside the store. Link to the cache paragraph of `cli.md`.

#### Section 3. The two files

Required facts and snippets:

1. `bowerloom.json` says what the project wants. `bowerloom.lock.json` says what resolved. Commit both.
2. A real `bowerloom.json` example in a `json` fence. The example holds the `harnesses` list, two skills, one prompt, and two teams. One skill comes from the store and one from the project. The prompt comes from the store. One team comes from the store and one from the project. It uses one `via`. The example comes from the helper of 3.5. Do not type it by hand.
3. A line-by-line reading of that example in a bullet list: `format`, `harnesses`, `id`, `source`, and `via`.
4. A real `bowerloom.lock.json` example in a `json` fence with one pinned skill and one skill written in the store. It comes from the helper of 3.5.
5. A reading of one lock item of each kind in a bullet list. For the pinned item: the whole `skills.json` entry sits in the lock. For the written item: `remote`, `commit`, `path`, `tree`, `files`, and `hash`. Say what `hash` proves: the bytes a teammate fetches are the bytes you locked.
6. One sentence on how the lock relates to `skills.json`: a lock `pin` is a `skills.json` entry, and the cache key comes from it, so one pin downloads once on a machine.
7. The rule that the two files agree: the lock lists exactly the store items that the config lists. `bowerloom lock verify` checks it. If they differ, `apply --frozen` refuses.
8. The sentence that `.bowerloom/` stays in a project that only has `bowerloom.json` until the first install. Then it holds git-ignored records. The repository still holds only `bowerloom.json`, `bowerloom.lock.json`, and the files you write.

#### Section 4. If you work alone

Required facts:

1. A project that only you use needs no lock and no remote.
2. The commands in order, in a `text` fence: `bowerloom skill create house-style --global`, `bowerloom use skill house-style`, `bowerloom skills sync`, `bowerloom apply`.
3. What each command does, one sentence each.
4. A sentence that states the rule. A project is shared in two cases. Case one: `bowerloom.lock.json` exists. Case two: the project sits in a git repository that has a remote named `origin`. Link to the next section.
5. The sentence: "If your project is not shared, `use` writes no lock and makes no network call."

#### Section 5. If you share a project

Required facts:

1. The rule for "shared", repeated in full: a lock file exists, or the project folder is in a git work tree whose `.git/config` has a remote `origin`. Bowerloom reads files and starts no process.
2. What changes in a shared project: `use` checks that a teammate can fetch each store item. A pinned npm or GitHub skill is always fetchable.
3. The author steps in a `text` fence, in order:
   1. Give the store a remote. The five git commands that `bowerloom store status` prints (copy them from spec 06, section 3.21).
   2. `bowerloom use skill house-style`
   3. Commit `bowerloom.json` and `bowerloom.lock.json`, and push the project.
4. What `use` does in a shared project, in order. It reads the store. It finds the pushed commit of the store. It asks `api.github.com` for that commit. It compares the bytes with your store. It writes the config. It writes the lock.
5. The warning line for a store with unpushed commits.
6. The hosts: only `api.github.com`. Say that the plan names the host and that Bowerloom fetches nothing the plan did not name.
7. The sentence that the store must be on GitHub in this beta, in a repository whose origin is a `github.com` address. Other hosts refuse with `STORE_ITEM_NOT_SHAREABLE`.

#### Section 6. What a teammate does

Required facts:

1. A teammate needs the project and network access to `api.github.com` and `registry.npmjs.org`. A teammate does not need your store.
2. The steps in a `text` fence: clone the project, `bowerloom apply --frozen`, and review the plan.
3. What the plan shows for a lock-resolved item: the `[store, from the lock]` tag and the `Network:` line with the hosts.
4. What `--frozen` does, in order. It reads the config and the lock. When they disagree, it refuses. It ignores any store on the machine. It fetches what the machine does not hold. It checks every byte against the lock. It installs.
5. What the teammate has afterward: the same files you installed, byte for byte.
6. `bowerloom up --team <name>` also works on a fresh clone. It fetches through its sync step.
7. The refusal for a missing lock: `LOCK_MISSING`, with the next step. Link to the refusals section.
8. The fetched store items are kept in the store cache. A second run needs no network.

#### Section 7. When the store has no remote

Required facts:

1. The three cases in a bullet list: the store is not a git repository, it has no remote named `origin`, or the remote is not a `github.com` address. A fourth case: no commit of the branch is pushed.
2. In a project that is not shared, nothing is wrong. The project works on your machine.
3. In a shared project, `use` refuses `STORE_ITEM_NOT_SHAREABLE`. Print the exact message and the exact next step as they appear in spec 06, section 5, in a `text` fence.
4. The three ways out, as a numbered list. One: give the store a remote and push it. Two: copy the item into the project with `bowerloom skill create`, `bowerloom prompt create`, or `bowerloom team adopt`. Three: use a pinned skill.
5. The five git commands again (they are the same as in section 5, so link to them instead of repeating).
6. What `bowerloom store status` shows for each case.

#### Section 8. A store in a private repository

Required facts:

1. Without a token, Bowerloom sends no credentials. A private repository answers 404, and Bowerloom refuses `STORE_REMOTE_PRIVATE`.
2. To use a private store, set `BOWERLOOM_GITHUB_TOKEN` to a GitHub token that can read the store repository. Give the advice: use a fine-grained token with read access to `Contents` for that one repository.
3. The exact promises, as a bullet list, copied from spec 07, sections 3.3 and 3.5. Bowerloom sends the token only to `api.github.com`. It sends the token only for the repository the plan names. It never stores the token. It never prints it. It never logs it. It refuses redirects. The plan shows a `Credentials:` line.
4. Which commands read the variable (spec 07, 3.2).
5. What the other public fetches do: `skills add` and pinned skills stay anonymous.
6. The refusals `GITHUB_TOKEN_INVALID` and `STORE_REMOTE_AUTH_FAILED` and the next step for each.
7. A teammate sets the same variable on their machine.
8. Link to `security.md`.

#### Section 9. Frozen installs and plain apply

Required facts:

1. A table with two rows (`apply`, `apply --frozen`) and columns: reads the store, reads the lock, fetches, needs the network. Cells: `apply`: store yes, lock only to note, fetches no, network none. `apply --frozen`: store no, lock yes, fetches yes, network the hosts in the plan. Add `skills sync` and `skills sync --frozen` as rows with the same cells as `apply` and `apply --frozen` except that plain `skills sync` fetches pins.
2. The sentence: "Plain `apply` never fetches." Then the sentence that plain `apply` holds a lock-resolved item that this machine lacks, with `SKILLS_OFFLINE`, and what to run.
3. The `npm ci` comparison in one sentence.
4. The refusals of a frozen run, each with one line, in the order that the code checks them: `LOCK_MISSING`, `LOCK_INVALID`, `LOCK_UNSAFE`, `LOCK_LIMIT`, `LOCK_CONFIG_MISSING`, `LOCK_CONFIG_MISMATCH`. Then the two that come after the plan: `LOCK_HASH_MISMATCH` and `SKILLS_OFFLINE`.
5. The statement: files that disagree stop a frozen run before any network call or write.
6. `--offline` with `--frozen` is allowed. A fetch that it needs gives the refusal `SKILLS_OFFLINE`.

#### Section 10. Change an item

Required facts, each as a short numbered procedure in a `text` fence with a sentence before it:

1. Edit a store item: edit the files in `~/.bowerloom`, commit, push, `bowerloom lock update` in each project, commit the lock.
2. Replace a pinned store skill: `bowerloom skills add ... --id <id> --replace --global`, then `bowerloom lock update`.
3. Stop using an item: `bowerloom unuse skill <id>`. The copies stay. Say how to delete them yourself.
4. Pick a team and its items: `bowerloom use team <id>`, and what `via` means.
5. Copy a store team into the project: `bowerloom team adopt <id>`. The project then owns the copy.
6. What `ls` and `status` show for a stale lock (`stale`) and what to run.
7. When a store item changes, the next plan shows an update tagged `[store]`, and nothing is written until you approve.
8. When a store item is removed, the plan holds the item with `STORE_ITEM_MISSING`.

#### Section 11. Merge conflicts in the lock

Required facts:

1. Why they are rare: one item per id, sorted, no times.
2. What a real conflict looks like: markers in the file, and `LOCK_INVALID` from every command.
3. The steps in a `text` fence: for each conflicting item keep either side, delete the markers, run `bowerloom lock verify`. On a machine with the store, run `bowerloom lock update` instead.
4. What `lock verify` checks.

#### Section 12. Move a project to the store

Required facts:

1. Who needs this section: a project from beta.2.
2. The steps of spec 08, section 8, in a numbered list, for a project that is not shared.
3. The extra steps for a shared project (push the store, run the command again).
4. What `store migrate` never does: delete a file.
5. What `receipt clean` does, and the step to run before it.
6. A project without `bowerloom.json` keeps working. State what beta.3 changes for it: the new formats of `ls --json` and `status --json`.

#### Section 13. Refusals

A table with the columns code, what it means, and what to do. One row for each code in the list of 5.1. The text of the last two columns is the text of the Cause and Next step cells in the specs. Group the rows under three bold labels: store, lock, and config. Link to `reference/errors.md` for the whole list.

#### Section 14. Words used on this page

A definition list. One entry for each of: store, project item, store item, pin, lock, content key, remote, frozen install, shared project, cache, store cache, config. Each definition is one sentence. The page defines a term at first use as well.

### 3.2 Edits to other pages

Each edit below names the file and the text to change. Specs 03 to 09 own the new command text. This table owns the consistency pass and the statements that are no longer true.

| File | Edit |
|---|---|
| `apps/docs/src/content/docs/cli.md` line 59 | Change the words "nearest parent folder that holds `.bowerloom`" to "nearest parent folder that holds `.bowerloom` or `bowerloom.json`". |
| `cli.md` `## Project commands` | Add these commands to the code block: `store status`, `use`, `unuse`, `lock verify`, `lock update`, `cache list`, `cache prune`, `store migrate`, and `receipt clean`. Give the flags that the specs give. Add one paragraph for each. |
| `cli.md` `## Apply` | `--frozen` and its paragraph. |
| `cli.md` `## Third-party skills` | `--global`, `--frozen`. Line 210 and line 216 get the machine-cache wording unchanged. |
| `cli.md` | A new section `## Store and lock` that links to the new page and lists the files `store.json`, `bowerloom.json`, `bowerloom.lock.json` with one sentence each. |
| `guides/index.md` table `## Setup and changes` | A row: "Share a project that uses your store" linking to `/docs/guides/item-sources/`. |
| `guides/create-items.md` line 12 | "so the project holds `.bowerloom`" becomes "so the project holds `.bowerloom` or `bowerloom.json`". The new sections from specs 04, 06, and 08. |
| `guides/add-skills.md` line 18 | The same marker wording. |
| `guides/add-skills.md` line 20 and line 403 | Keep "Private registries ... are not supported" for npm. Change the GitHub sentence: "The Git route reads only the public GitHub API, `api.github.com`, without credentials. A store in a private repository is the one exception: see [Where your items come from](/docs/guides/item-sources/#private-store)." |
| `guides/add-skills.md` line 114 | No change. The sample output stays correct for a pinned skill. |
| `guides/existing-project.md` | The section from spec 08. |
| `status.md` list at line 32 | Add bullets for `use`, `unuse`, `lock`, `store`, `cache`, `receipt`, and `apply --frozen`. Change "Skills come from public sources only" to "Skills come from public sources. A store in a private repository needs `BOWERLOOM_GITHUB_TOKEN`." |
| `security.md` `## Credentials and private bindings` | The paragraph from spec 07. |
| `troubleshooting.md` | Entries from specs 07 and 09, and an entry "My teammate cannot install my store items" that points to the new page. |
| `concepts/teams-and-files.md` `## Portable and private` | Add: the store holds definitions, the config and the lock are portable, the caches are private. Link to the new page. |
| `README.md` (repository root) | Add one sentence and a link to the docs list. A file with no docs list needs no change. |
| `apps/docs/tools/check-brand.mjs` line with `userPages` | Add `'guides/item-sources'` to the list of normal user pages. |
| `apps/docs/package.json` `test` script | Add `tools/docs-codes.test.mjs`: `node ../../tools/run-node-tests.mjs tools/content.test.mjs tools/docs-codes.test.mjs`. |

Do not edit the release status block in `releases.md` or the support block in `status.md`. `tools/sync-release.mjs` owns those blocks, and `npm run check:release` must pass.

### 3.3 The release notes

Under `## 0.7.0-beta.3` in `apps/docs/src/content/docs/releases.md`, the lines from specs 01 to 09 appear in this order, grouped under these bold labels: **New commands**, **Projects and the store**, **Sharing**, **Changed formats**, **Fixes**. Add two lines of this spec:

- "The new page [Where your items come from](/docs/guides/item-sources/) explains where each item's bytes come from, what the lock records, and what a teammate needs."
- A compatibility note: "`ls --json` is now `bowerloom/ls/v1beta2`. `status --json` is now `bowerloom/project-status/v1beta2`. The sync and apply plans are `v1beta2`. Scripts that read `format` must accept the new names."

### 3.4 The errors reference

`apps/docs/src/content/docs/reference/errors.md` holds one table row for every refusal code that specs 03 to 09 add. The tables are `## Store and config refusals`, `## Lock refusals`, `## Migrate and cache refusals`, and `## Token refusals`. Each row has the columns of the existing tables: code, trigger and meaning, preserve and next action. The trigger is the Cause cell. The next action is the Next step cell.

### 3.5 Examples come from code

The examples on the page must be valid. Do not type them by hand.

1. Write `tests/support/docs-examples.ts`. It exports `configExample(): string`, `lockExample(): string`, and `storeStatusExample(): string`. It builds each value with the real serializers: `serializeConfig` and `serializeLock` from `packages/project-config`, and a fixed fixture for the lock. The lock fixture uses the real `revisionOf` to compute `hash`, and fixed 40-hex ids for `commit` and `tree`. The remote is `https://github.com/example-org/example-store`.
2. `tests/docs-examples.test.ts` reads the page and extracts each fenced `json` block that follows a line `<!-- example: config -->` or `<!-- example: lock -->`. It requires the block to equal the helper's output byte for byte. It parses the config block with `parseConfig` and the lock block with `parseLock`, and requires `lockAgrees(lock, config)` to hold for the pair shown. The builder puts those two marker comments above the two fences. The comments are the only comments in the page.
3. The same test checks that each `bowerloom ...` command in the page's `text` fences starts with a command word from the `COMMANDS` set in `apps/cli/src/main.ts:132`.

### 3.6 Checks that gate the docs

Run these in `apps/docs` before the pull request. All must pass.

1. `npm run build`
2. `npm run check:links` (fragments, assets, no private paths, home links)
3. `npm run check:exports` (Markdown and HTML parity, `llms.txt`, `llms-full.txt`)
4. `npm run check:release`
5. `npm test` (includes the new `docs-codes.test.mjs`)
6. `node tools/check-brand.mjs`
7. In the repository root: `node tools/run-node-tests.mjs apps/landing/test/*.test.mjs`, then `npm run typecheck` and `npm test`.

## 4. Schemas

### 4.1 Page front matter

The keys are `title`, `description`, `section`, and `order`. Values are in 3.1. No other key.

### 4.2 The docs-codes list

`apps/docs/tools/docs-codes.test.mjs` builds the list of codes from the source, not by hand:

1. Read `apps/cli/src/human.ts` and take every key of the `REFUSALS` object that matches `^(STORE|CONFIG|LOCK|MIGRATE|CACHE)_[A-Z_]+$`, plus `GITHUB_TOKEN_INVALID`, `TEAM_NOT_SELECTED`, and `STALE_APPROVAL` is not included. The match is a line regex: `^  ([A-Z][A-Z0-9_]+): \{`.
2. Call the result `codes`.
3. Call `pageCodes` the fixed list in 5.1.

## 5. Refusal codes

### 5.1 Codes the page explains (the page list)

- Store: `STORE_NOT_FOUND`, `STORE_INVALID`, `STORE_UNSAFE`, `STORE_IN_CLOUD_FOLDER`.
- Store items: `STORE_ITEM_NOT_FOUND`, `STORE_ITEM_MISSING`, `STORE_ITEM_NOT_SHAREABLE`.
- Store remote: `STORE_REMOTE_PRIVATE`, `STORE_REMOTE_AUTH_FAILED`, `GITHUB_TOKEN_INVALID`.
- Config: `CONFIG_INVALID`, `CONFIG_DUPLICATE_ID`, `CONFIG_ITEM_SELECTED`, `CONFIG_ITEM_NOT_SELECTED`, `TEAM_NOT_SELECTED`.
- Lock: `LOCK_MISSING`, `LOCK_INVALID`, `LOCK_UNSAFE`, `LOCK_LIMIT`, `LOCK_CONFIG_MISSING`, `LOCK_CONFIG_MISMATCH`.
- Lock checks: `LOCK_HASH_MISMATCH`, `LOCK_STORE_NOT_PUSHED`, `LOCK_COMMIT_UNREACHABLE`.
- Network: `SKILLS_OFFLINE`.

### 5.2 Codes the errors reference holds

Every code in `codes` (4.2). This spec adds no new code.

## 6. Where to change

Create:

- `apps/docs/src/content/docs/guides/item-sources.md` (3.1).
- `apps/docs/tools/docs-codes.test.mjs` (section 10).
- `tests/support/docs-examples.ts` and `tests/docs-examples.test.ts` (3.5).

Change: every file in the table of 3.2, plus `apps/docs/src/content/docs/releases.md` (3.3) and `apps/docs/src/content/docs/reference/errors.md` (3.4).

Do not change any file under `packages/` or `apps/cli/`. If the page cannot say something true because the code differs from the spec, stop and write the difference in the pull request. Do not change the code in this track.

## 7. Edge cases

| Case | Expected result |
|---|---|
| The page links to `#private-store` and the anchor is missing | `check:links` fails with `missing fragment`. Add the anchor line. |
| Two headings make the same generated id | `check:links` fails with `duplicate ID`. The explicit `<a id>` lines keep ids unique. |
| A snippet holds `/Users/...` | `check:links` fails. Use `~` or a placeholder. |
| A code example is not valid JSON | `docs-examples.test.ts` fails. |
| A refusal code in `REFUSALS` is missing from `errors.md` | `docs-codes.test.mjs` fails and names the code. |
| A page code is missing from the page | `docs-codes.test.mjs` fails and names the code. |
| The page mentions a command that does not exist | `docs-examples.test.ts` fails. |
| `releases.md` release block is edited | `check:release` fails. Undo the edit. |
| Order 7.8 is already used | Use 7.9 and change this spec's value in the pull request note. |
| The built page differs between HTML and Markdown | `check:exports` fails. Fix the Markdown source. |
| A reader opens the page from search | The page title and description show. Both are in the front matter. |
| A sentence uses a banned word | The simple-English check on write flags it. Rewrite it. |

## 8. Migration from beta.2 projects

The page serves beta.2 readers. Section 12 of the page tells them what changes and what stays. `releases.md` lists the changed formats. The `status.md` and `cli.md` edits remove the statements that stop being true: the project marker, public-only skills, and the single skills cache.

## 9. Docs changes for this track

This spec is the docs track. Sections 3.1 to 3.4 list every change.

## 10. Acceptance tests

`apps/docs/tools/docs-codes.test.mjs` (run by `npm test` in `apps/docs`):

1. The page file exists, with the exact front matter of 3.1.
2. The page headings, in order, equal the table of 3.1, and each has its anchor line directly above it.
3. Every code in 5.1 appears in the page text inside backticks.
4. Every code in `codes` (4.2) appears in `errors.md` in a table row that starts with the code in backticks.
5. Every command word in the `SECTIONS` lines of `apps/cli/src/human.ts` appears in `cli.md` inside a `text` fence.
6. The page holds the exact message and next step of `STORE_ITEM_NOT_SHAREABLE` (the strings are read from `human.ts` and `packages/project-config/src/refusal.ts`).
7. The page holds the five git commands that `store status` prints (read from `apps/cli/src/store.ts`).
8. The page holds every promise of spec 07, 3.3 and 3.5, checked by key phrases: `api.github.com`, `never stored`, `never printed`, `redirects`, `Credentials:`.
9. The page has no semicolons outside code fences. It uses none of these words outside code fences and quoted program output: `can`, `could`, `may`, `might`, `should`, `would`.
10. The page does not contain `Fearless` or `Advanced Metrics`.
11. `releases.md` holds a `## 0.7.0-beta.3` section with the five bold labels of 3.3, in that order.
12. `cli.md` line for the project marker names `bowerloom.json`.
13. `add-skills.md` still says that `skills add` sends no credentials, and links to the new page.
14. `guides/index.md` links to `/docs/guides/item-sources/`.
15. `check-brand.mjs` lists `guides/item-sources`.

`tests/docs-examples.test.ts`:

1. The config example on the page equals `configExample()`.
2. The lock example on the page equals `lockExample()`.
3. `parseConfig` and `parseLock` accept the two examples, and `lockAgrees` is true for the pair.
4. The helper fixture's lock `hash` equals `revisionOf(files)`.
5. Every `bowerloom <word>` command in a `text` fence of the page starts with a word of the `COMMANDS` set.
6. Each flag on the page for `use`, `lock`, `apply`, `store`, `cache`, and `receipt` appears in that command's `TOPICS` text.

The build checks of 3.6 pass.

## 11. Build order

1. Wait for specs 03 to 09 to merge. Read their `TOPICS` and `REFUSALS` text from the merged code.
2. Write `tests/support/docs-examples.ts` and `tests/docs-examples.test.ts`. They fail until the page exists.
3. Write `docs-codes.test.mjs`. It fails until the pages exist.
4. Write the page, section by section, following 3.1.
5. Make the edits of 3.2, 3.3, and 3.4.
6. Run the checks of 3.6 and fix each failure.
7. Ask for the independent review. The reviewer reads the page against the code, not against the spec.

## 12. Unverified items

1. The simple-English hook. The lint hook can flag a rule that this spec does not list. Fix every flag it reports. If it flags a sentence that holds a required fact, shorten the sentence and keep the fact.
2. `check:exports` and the page's `text` fences. The tool reads `doc.copy.prompt`, which comes from a paired "Copy prompt" feature (`apps/docs/tools/check-exports.mjs:~12`). I read the tool, not `src/lib/content.mjs`. If a `text` fence triggers the copy feature, rename the fence to `console` and check that the page still builds.
3. The `order` value 7.8 and the sidebar. Pages sort by `order` within `section`. If the page sorts into the wrong place, check `src/lib/content.mjs` for the sort and use the value it needs.
4. The `<a id>` anchor style. Other pages use `<a id="installed-security-acceptance"></a>` before a heading (`status.md`, `security.md`). Copy that exact style. If `check:links` reports a duplicate id, drop the anchor and use the generated heading id in the links.
5. Whether `README.md` in the repository root lists docs pages. Read it. If it has no list, make no change, as 3.2 says.
6. The wording of `STORE_ITEM_NOT_SHAREABLE` and the git commands comes from specs 06 and 03. If the merged code changed them, the docs tests read the merged strings, and the page must copy the merged strings.
