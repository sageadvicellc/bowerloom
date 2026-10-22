# 10. Docs for the store, the lock, and item sources

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 9 and decision 20. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decision 20: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333018480. The settled variants and the token: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333364163.
- Lane: 2. Hanna calls this a release requirement, not a footnote. Beta.3 does not ship without it.
- Branch: `beta3/10-docs-item-sources`.
- Depends on: specs 01a, 02, 03, 04, 05, 06, 07, 08, and 09, merged. Write this spec's track last, against the merged code. Every example is checked against that code.
- Line numbers below are from commit c9730d3. If a line moved, find the place by its text.

## 2. Problem

Hanna called the idea "an embedded nuance". A person must understand four things before they share a project that uses the store. They must know where each item's bytes come from. They must know what the lock file records. They must know what a teammate needs. They must know the result for a store with no remote.

The code answers each question, but only a page can explain it. Without the page, a person finds the answer by hitting a refusal. The page also gives a reader one place to learn the whole model: the store, the config, the lock, the caches, and the commands that connect them.

Specs 01a, 02, and 03 to 09 each write the docs lines of their own track. This spec adds the page, then reads every other beta.3 docs change for consistency, and adds the checks that keep the docs true.

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
order: 7.75
---
```

The order 7.75 sits after `create-items.md` (7.7) and before `guides/agents.md` (7.8, spec 01a) and `guides/context-slices.md` (7.9, spec 05).

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

Rule 1 (20 words) and the simple-English check are manual review. No test enforces them (section 10).

The page has these headings, in this order. Each heading has an anchor line above it, in the form `<a id="<id>"></a>`, with the id in the last column. The builder writes the prose from the required facts. Every fact in a section must appear on the page, in the section where it is listed. The anchor ids differ from the ids that the headings generate, because `apps/docs/src/lib/html-ids.mjs` counts both and `check:links` fails a duplicate.

| Heading | Anchor id |
|---|---|
| `## What this page answers` | `page-questions` |
| `## The four kinds of item` | `four-kinds-of-item` |
| `## The two files` | `config-and-lock` |
| `## If you work alone` | `work-alone` |
| `## If you share a project` | `share-a-project` |
| `## What a teammate does` | `teammate-steps` |
| `## When the store has no remote` | `store-has-no-remote` |
| `## A store in a private repository` | `private-store` |
| `## GitHub request limits` | `rate-limit` |
| `## Frozen installs and plain apply` | `frozen-and-plain` |
| `## Change an item` | `item-changes` |
| `## Merge conflicts in the lock` | `lock-conflicts` |
| `## Move a project to the store` | `move-to-store` |
| `## Refusals` | `item-source-refusals` |
| `## Words used on this page` | `words` |

The sections below keep their old numbers. The section "GitHub request limits" is section 8a.

#### Section 1. What this page answers

Required facts:

1. The page answers four questions. Each question is a bullet that links to its section. The questions: where each item's bytes come from, what `bowerloom.lock.json` records, what a teammate needs, and the result for a store with no remote.
2. One sentence that says who needs this page: anyone who shares a project that uses the store, and anyone who wonders where an installed file came from.
3. One sentence says the page covers beta.3 and later. A second sentence says a project without `bowerloom.json` works as in beta.2. It links to the section "Move a project to the store".
4. What a teammate needs, as a bullet list: the project, network access to `api.github.com` and `registry.npmjs.org`, Bowerloom 0.7.0-beta.3 or later, and (for a private store) a token. Add the rate-limit bullet: GitHub allows about 60 requests an hour without a token, and the page "GitHub request limits" says what that means.
5. One sentence: "Run `bowerloom help store` for the store, use, lock, store migrate, receipt clean and cache commands."

#### Section 2. The four kinds of item

Required facts:

1. A skill, a prompt, and a team are the three things a project selects. Define each in one sentence. Skills and prompts put copies in `.claude` and `.agents`. A team's agents become copies in `.claude/agents` for Claude Code. That holds only for a team the project defines and `bowerloom.json` lists. A store team projects no agents in this beta. `bowerloom team adopt` copies the team, agents included, into the project. Codex agents are not projected in this beta. A context slice is a project item only. It never sits in the store or the lock. Link to `/docs/guides/agents/` and `/docs/guides/context-slices/`.
2. A table with four rows and these columns: kind of item, where it is defined, where its bytes come from, in the lock. Copy the rows and cells from the table in spec 06, section 3.1. Change only the wording, to match the rules above.
3. The sentence: "The lock never records project items. Git versions them."
4. The definition of "store": the folder `~/.bowerloom` on your machine. It holds definitions, and no cache and no installed copy. It also holds `.git` and `folders/`. Link to the `store status` paragraph of `cli.md`.
5. The definition of "pin": an exact npm version or a full GitHub commit with the hashes of the files.
6. The two caches: the skills cache and the store cache. One sentence each. Both live outside your projects and outside the store. Link to the cache paragraph of `cli.md`.

#### Section 3. The two files

Required facts and snippets:

1. `bowerloom.json` says what the project wants. `bowerloom.lock.json` says what resolved. Commit both.
2. A real `bowerloom.json` example in a `json` fence. The config example holds `harnesses`, three skills, one prompt, and two teams. The skills are `house-style` from the store (written), `local-tool` from the project, and `tanstack-db` from the store (pinned, with `via: ["research"]`). The prompt is `weekly-update`, from the store. The teams are `first-team` (project) and `research` (store). The example comes from the helper of 3.5. Do not type it by hand.
3. A line-by-line reading of that example in a bullet list: `format`, `harnesses`, `id`, `source`, and `via`.
4. A real `bowerloom.lock.json` example in a `json` fence. The lock example holds exactly the four store entries: skills `house-style` (authored) and `tanstack-db` (pin), prompt `weekly-update` (authored), and team `research` (authored). It comes from the helper of 3.5. Both examples satisfy `lockAgrees`.
5. A reading of one lock item of each kind in a bullet list. For the pinned item: the whole `skills.json` entry sits in the lock. For the written item: `remote`, `commit`, `path`, `tree`, `files`, and `hash`. Say what `hash` proves: the bytes a teammate fetches are the bytes you locked.
6. One sentence on how the lock relates to `skills.json`: a lock `pin` is a `skills.json` entry, and the cache key comes from it, so one pin downloads once on a machine.
7. The rule that the two files agree: the lock lists exactly the store items that the config lists. `bowerloom lock verify` checks it. If they differ, `apply --frozen` refuses.
8. A project with only `bowerloom.json` has no `.bowerloom` until the first install or create. Bowerloom keeps its install records in `.bowerloom/managed`, which git ignores. The repository still holds only `bowerloom.json`, `bowerloom.lock.json`, and the files you write.

#### Section 4. If you work alone

Required facts:

1. A project that only you use needs no lock and no remote.
2. The commands in order, in a `text` fence: `bowerloom skill create house-style --global`, `bowerloom use skill house-style`, `bowerloom skills sync`, `bowerloom apply`.
3. What each command does, one sentence each.
4. A sentence that states the rule. A project is shared in two cases. Case one: `bowerloom.lock.json` exists. Case two: the project sits in a git repository that has a remote named `origin`. A project on GitHub is usually shared. Link to the next section.
5. The sentence: "If your project is not shared, `use` writes no lock and makes no network call."
6. The folder must already be a project. In a new folder, run `bowerloom up --team <name> --goal <goal>` first.
7. Each command shows a plan and exits 3. Approve it with `--approve <revision>`.

#### Section 5. If you share a project

Required facts:

1. The rule for "shared", repeated in full: a lock file exists, or the project folder is in a git work tree whose `.git/config` has a remote `origin`. Bowerloom reads files and starts no process.
2. What changes in a shared project: `use` checks that a teammate can fetch each store item. A pinned npm or GitHub skill is always fetchable.
3. The author steps in a `text` fence, in order:
   1. Give the store a remote. Use the commands that `bowerloom store status` prints for the case `none` (copy them from spec 06, section 3.21).
   2. `bowerloom use skill house-style`
   3. Commit `bowerloom.json` and `bowerloom.lock.json`, and push the project.
4. What `use` does in a shared project, in order. It reads the store. It finds the pushed commit of the store. It asks `api.github.com` for that commit. It compares the bytes with your store. It writes the config. It writes the lock.
5. The warning line for a store with unpushed commits.
6. The hosts: only `api.github.com`. Say that the plan names the host and that Bowerloom fetches nothing the plan did not name.
7. The sentence that the store must be on GitHub in this beta, in a repository whose origin is a `github.com` address. Other hosts refuse with `STORE_ITEM_NOT_SHAREABLE`.
8. A git-ignored file or a `.DS_Store` in a store item fails the proof. So do `core.autocrlf` and git filters. Before `git add -A` in the store, finish or clear any interrupted `--global` create. (Record the gap between spec 04 and spec 06 about the pending record warning in the pull request.)

#### Section 6. What a teammate does

Required facts:

1. A teammate needs the project and network access to `api.github.com` and `registry.npmjs.org`. A teammate does not need your store. A teammate needs Bowerloom 0.7.0-beta.3 or later.
2. The steps in a `text` fence, in this order: `git clone <project>`, `bowerloom apply --frozen`, read the plan, then `bowerloom apply --frozen --approve <revision>`.
2a. A written store skill that this machine has not fetched shows `install skill: ... (not on this machine yet; Bowerloom shows what it can do after the fetch)`. If the fetched skill declares `allowed-tools`, or a fetched prompt gives a notice, apply installs nothing of it and holds it with `ITEM_REVIEW_REQUIRED`. The next step is `Run bowerloom apply --frozen again to review it.`
3. What the plan shows for a lock-resolved item: the `[store, from the lock: github.com/<o>/<r>]` tag and the `Network:` line with the hosts.
4. What `--frozen` does, in order. It reads the config and the lock. When they disagree, it refuses. It ignores any store on the machine. It fetches what the machine does not hold. It checks every byte against the lock. It installs.
5. What the teammate has afterward: the same files you installed, byte for byte.
6. `bowerloom up --team <name>` also installs on a fresh clone, through its sync step. It is not strict. On a machine that has a store, it installs the live store items. A differing lock only produces a printed note. Use `bowerloom apply --frozen` to get exactly the locked bytes.
7. The refusal for a missing lock: `LOCK_MISSING`, with the next step. Link to the refusals section.
8. The fetched store items are kept in the store cache. A second run needs no network. After `bowerloom cache prune`, the next run fetches again.
9. A slice whose root is a registered folder needs that folder registered under the same name on each machine with `bowerloom folder add`. Otherwise apply holds the slice with `SLICE_ROOT_MISSING`.
10. An agent copy with the read guard names your machine's project folder. If the project commits `.claude/agents`, apply on a teammate's machine holds that agent with `AGENT_TARGET_OCCUPIED`. Keep `.claude/agents` out of git. (This follows decision 2 of #86. Variant B is the default.)

#### Section 7. When the store has no remote

Required facts:

1. The five problems in a bullet list, each with its sentence from spec 06, section 3.10. The problems are:
   - the store is not a git repository (`none`)
   - it has no remote named `origin` (`no-origin`)
   - the remote is not a `github.com` address (`unsupported-remote`)
   - Bowerloom cannot read the git files of the store (`unreadable`)
   - no commit of the branch is pushed (`unpushed`)
2. In a project that is not shared, nothing is wrong. The project works on your machine.
3. In a shared project, `use` refuses `STORE_ITEM_NOT_SHAREABLE`. Print the exact message and the exact next step as they appear in spec 06, section 5, in a `text` fence.
4. The ways out, as a numbered list. One: give the store a remote on github.com and push it. Two: for a team, run `bowerloom team adopt <id>`. Three: for a skill or prompt, run `bowerloom unuse <kind> <id>`, then `bowerloom <kind> create <id>`, then copy the files from `~/.bowerloom` into the new project item yourself. Four: for a skill, pin a published copy with `bowerloom skills add ... --global`, then run `bowerloom use skill <id>`.
5. The git commands again (they are the same as in section 5, so link to them instead of repeating).
6. What `bowerloom store status` shows for each case, including the `GitHub token:` line of spec 07, section 3.6.

#### Section 8. A store in a private repository

Required facts:

1. Without a token, Bowerloom sends no credentials. A private repository answers 404, and Bowerloom refuses `STORE_REMOTE_PRIVATE`.
2. To use a private store, set `BOWERLOOM_GITHUB_TOKEN` to a GitHub token with read access to the store repository. Advise a fine-grained token. A classic token needs the `repo` scope, which grants write access to every private repository. Name the read-only `Contents` permission only after the pull request of spec 07 records its hand check (spec 07, section 12, item 6) as passed. Until then, name no permission.
3. The exact promises, as a bullet list, copied from spec 07, sections 3.3 and 3.5. Bowerloom sends the token only to `api.github.com`. It sends the token only for the repository the plan names. It never stores the token. It never prints it. It never logs it. It refuses redirects. The plan shows a `Credentials:` line.
4. Which commands read the variable (spec 07, 3.2).
5. What the other public fetches do: `skills add` and pinned skills stay anonymous.
6. The refusals `GITHUB_TOKEN_INVALID` and `STORE_REMOTE_AUTH_FAILED` and the next step for each.
7. A teammate sets the same variable on their machine.
8. A plan made with the token set, then applied without it, or the reverse, refuses `STALE_APPROVAL`.
9. A malformed variable refuses `GITHUB_TOKEN_INVALID` in every command that reads it, for a public store too.
10. Link to `security.md`.

#### Section 8a. GitHub request limits

Required facts:

1. GitHub allows about 60 requests an hour without a token, and about 5,000 with one.
2. A store skill or team takes 4 requests plus 1 for each distinct file. A prompt takes 4. One item takes at most 130.
3. Which commands spend requests. `use`, `lock update`, and `store migrate` prove a written item. `apply --frozen`, `skills sync`, and the sync step of `up` fetch a written item that this machine lacks. `lock update` skips an unchanged item. A cached item costs nothing.
4. The plan lines, verbatim: `Network: reads api.github.com, to check the pushed copy of <n> items, about <r> requests to api.github.com.` and `Without a token GitHub allows about 60 requests an hour. Set BOWERLOOM_GITHUB_TOKEN, or run the command again after an hour to finish.`
5. With `BOWERLOOM_GITHUB_TOKEN` set, store items count against the 5,000 limit, for a public store too. Pinned GitHub skills never send the token, so they stay at 60.
6. `GITHUB_RATE_LIMITED`, with its next step. Items fetched before the stop stay in the store cache.

#### Section 9. Frozen installs and plain apply

Required facts:

1. A table with these columns: command, reads the store, reads the lock, fetches, network. Rows:
   - `apply`: yes for store items, yes for items the store lacks, never, none.
   - `apply --frozen`: no, yes, what this machine lacks, the hosts in the plan.
   - `skills sync`: yes, yes for items the store lacks, pins and lock items this machine lacks, `registry.npmjs.org` and `api.github.com` as the plan names.
   - `skills sync --frozen`: no, yes, what this machine lacks, as the plan names. With `--offline`, none.
   `apply` has no `--offline` flag.
2. The sentence: "Plain `apply` never fetches." Then the sentence that plain `apply` holds a lock-resolved item that this machine lacks, with `SKILLS_OFFLINE`, and what to run.
3. The `npm ci` comparison in one sentence.
4. The refusals of a frozen run. The order the code checks them: `LOCK_CONFIG_MISSING`, `LOCK_MISSING`, `LOCK_UNSAFE`, `LOCK_LIMIT`, `LOCK_INVALID`, `LOCK_CONFIG_MISMATCH`. If the merged `frozen.test.mjs` pins another order, copy it and record the difference in the pull request. After the plan: `LOCK_HASH_MISMATCH`, `SKILLS_SYNC_CONTENT_MISMATCH`, `STORE_REMOTE_PRIVATE`, `STORE_REMOTE_AUTH_FAILED`, `GITHUB_RATE_LIMITED`, `SKILLS_OFFLINE`, and the hold `ITEM_REVIEW_REQUIRED`. One line for each.
5. The statement: files that disagree stop a frozen run before any network call or write.
6. `skills sync --frozen --offline` is allowed. A needed fetch refuses `SKILLS_OFFLINE`.

#### Section 10. Change an item

Required facts, each as a short numbered procedure in a `text` fence with a sentence before it:

1. Edit a store item: edit the files in `~/.bowerloom`, commit, push, `bowerloom lock update` in each project, commit the lock. Teammates then run `bowerloom apply --frozen`. A project without a lock needs only `skills sync` and `apply`.
2. Replace a pinned store skill: `bowerloom skills add ... --id <id> --replace --global`, then `bowerloom lock update`.
3. Stop using an item: `bowerloom unuse skill <id>`. The copies stay. Say how to delete them yourself.
4. Pick a team and its items: `bowerloom use team <id>`, and what `via` means.
5. Copy a store team into the project: `bowerloom team adopt <id>`. The project then owns the copy.
6. The sync and apply plans print `The lock is out of date for <ids>. Run bowerloom lock update.` `bowerloom status --json` reports `config.lock.state` as `stale`.
7. When a store item changes, the next plan shows an update tagged `[store]`, and nothing is written until you approve.
8. When an item leaves the store, a normal run installs it from the lock when the lock holds it. Without a lock item, the plan holds it with `STORE_ITEM_MISSING`.

#### Section 11. Merge conflicts in the lock

Required facts:

1. Why they are rare: one item per id, sorted, no times.
2. What a real conflict looks like: markers in the file, and `LOCK_INVALID` from every command.
3. The steps in a `text` fence: for each conflicting item keep either side, delete the markers, run `bowerloom lock verify`. On a machine with the store, run `bowerloom lock update` instead. It rebuilds a lock that reads `LOCK_INVALID` from `bowerloom.json`.
4. Settle `bowerloom.json` first. Until it parses, Bowerloom reads it as `CONFIG_INVALID`.
5. If the settled pair lists different items, `lock verify` refuses `LOCK_CONFIG_MISMATCH`. Run `bowerloom lock update`.
6. What `lock verify` checks.

#### Section 12. Move a project to the store

Required facts:

1. Who needs this section: a project from beta.2.
2. The steps of spec 08, section 8, in a numbered list, for a project that is not shared.
3. The extra steps for a shared project (push the store, run the command again).
4. What `store migrate` never does: delete a file.
5. What `receipt clean` does, and the step to run before it.
6. A project without `bowerloom.json` keeps working. State what beta.3 changes for it: the new formats of `ls --json` and `status --json`.
7. Say what `store migrate` does for a missing team (`MIGRATE_TEAM_MISSING`, variant A of spec 08). Say how `cache prune` behaves outside a project (variant A of spec 09). Put the second in the cache paragraph.

#### Section 13. Refusals

A table with the columns code, what it means, and what to do. One row for each code in the list of 5.1. Group the rows under three bold labels: store, lock, and config. Link to `reference/errors.md` for the whole list. The text of the last two columns comes from the specs. For spec 03 codes, use the Message cell. For `SKILLS_OFFLINE`, use the call-site text of spec 06, section 3.10. For `STORE_REMOTE_PRIVATE`, use the next step of spec 07. For every other code, use the Cause and Next step cells.

#### Section 14. Words used on this page

A definition list. One entry for each of: store, project item, store item, pin, lock, content key, remote, frozen install, shared project, cache, store cache, config. Each definition is one sentence. The page defines a term at first use as well.

### 3.2 Edits to other pages

Each edit below names the file and the text to change. Specs 01a, 02, and 03 to 09 own the new command text. This table owns the consistency pass and the statements that are no longer true.

| File | Edit |
|---|---|
| `apps/docs/src/content/docs/cli.md` line 59 | Change the words "nearest parent folder that holds `.bowerloom`" to "nearest parent folder that holds `.bowerloom` or `bowerloom.json`". Fix the `PROJECT_ROOT_REFUSED` statement: it is no longer true for a home folder that holds a store. |
| `cli.md` line 31 | Add `use`, `unuse`, `lock`, `receipt`, and `cache` to the help list. |
| `cli.md` line 216 | Replace the `skills sync` paragraph: "`skills sync` installs the skills that the project selects: every skill in `.bowerloom/skills.json` in a project without `bowerloom.json`, or the skills that `bowerloom.json` lists. It fetches only what this machine's caches lack: pins from their registry, and store items from the store remote that the lock names. It checks every byte against its pin or the lock first." |
| `cli.md` `## Project commands` | Add these commands to the code block: `store status`, `use`, `unuse`, `lock verify`, `lock update`, `cache list`, `cache prune`, `store migrate`, and `receipt clean`. Give the flags that the specs give. Add one paragraph for each. |
| `cli.md` `## Apply` | `--frozen` and its paragraph. |
| `cli.md` `## Third-party skills` | `--global`, `--frozen`. |
| `cli.md` | A new section `## Store and lock` that links to the new page and lists the files `store.json`, `bowerloom.json`, `bowerloom.lock.json` with one sentence each. |
| `guides/index.md` table `## Setup and changes` | A row: "Share a project that uses your store" linking to `/docs/guides/item-sources/`. |
| `guides/create-items.md` line 12 | "so the project holds `.bowerloom`" becomes "so the project holds `.bowerloom` or `bowerloom.json`". The new sections from specs 04, 06, and 08. |
| `guides/add-skills.md` line 18 | The same marker wording. |
| `guides/add-skills.md` line 20 | "... without credentials. Private registries and private repositories are not supported for pinned skills. A store in a private GitHub repository is a separate case. See [Where your items come from](/docs/guides/item-sources/#private-store)." Line 403 gets the same change. |
| `guides/add-skills.md` line 114 | No change. The sample output stays correct for a pinned skill. |
| `guides/existing-project.md` | The section from spec 08. |
| `status.md` line 32 | "This beta reads pinned skills only from public sources. A private store needs a token. See [Where your items come from](/docs/guides/item-sources/#private-store)." Add bullets for `use`, `unuse`, `lock`, `store`, `cache`, `receipt`, and `apply --frozen`. |
| `status.md` line 48 | "Pinned third-party skills come from public npm and GitHub sources, and only MIT and Apache-2.0 skills install. Store items come from your store, or from its GitHub remote on a teammate's machine. A store in a private repository needs BOWERLOOM_GITHUB_TOKEN." |
| `security.md` `## Credentials and private bindings` | The paragraph from spec 07. |
| `troubleshooting.md` | Entries from specs 07 and 09, and an entry "My teammate cannot install my store items" that points to the new page. |
| `concepts/teams-and-files.md` `## Portable and private` | Add: the store holds definitions, the config and the lock are portable, the caches are private. Link to the new page. |
| `README.md` (repository root) | No change. It must not name 0.7.0-beta.3, because `check:release` forbids it. |
| `apps/docs/tools/check-brand.mjs` line with `userPages` | Add `'guides/item-sources'` to the list of normal user pages. |
| `apps/docs/package.json` `test` script | Add `tools/docs-codes.test.mjs`: `node ../../tools/run-node-tests.mjs tools/content.test.mjs tools/docs-codes.test.mjs`. |

Do not edit the release status block in `releases.md` or the support block in `status.md`. `tools/sync-release.mjs` owns those blocks, and `npm run check:release` must pass.

### 3.3 The release notes

Under `## 0.7.0-beta.3` in `apps/docs/src/content/docs/releases.md`, the lines from specs 01a to 09 appear in this order, grouped under these bold labels: **New commands**, **Projects and the store**, **Sharing**, **Agents and context slices**, **Install**, **Changed formats**, **Known limits**, **Fixes**.

Line-to-label map:

- New commands: `use`, `unuse`, `lock verify`, `lock update`, `team adopt`, `store status`, `store migrate`, `receipt clean`, `cache list`, `cache prune`.
- Projects and the store: the store, `bowerloom.json`, `--global` on the create commands, and the config-only project.
- Sharing: `bowerloom.lock.json`, `apply --frozen`, `skills sync --frozen`, the shared-project rule, and `BOWERLOOM_GITHUB_TOKEN`.
- Agents and context slices: the lines of specs 01a and 05.
- Install: the tarball install line of spec 02.
- Changed formats: the new plan and result formats.
- Known limits: the store must be on GitHub, Codex agents are not projected, and a store team projects no agents.
- Fixes: the statements that this spec corrects.

Add two lines of this spec:

- "The new page [Where your items come from](/docs/guides/item-sources/) explains where each item's bytes come from, what the lock records, and what a teammate needs."
- A compatibility note: "`ls --json` is now `bowerloom/ls/v1beta2`. `status --json` is now `bowerloom/project-status/v1beta2`. `skills check --json` is `bowerloom/skills-manifest-check/v1beta2`. The sync and apply plans and results are `v1beta2`. Scripts that read `format` must accept the new names. A 0.7.0-beta.2 CLI refuses a project that holds agent catalogs or slices."

### 3.4 The errors reference

`apps/docs/src/content/docs/reference/errors.md` holds one table row for every refusal code that specs 01a to 09 add. The tables are `## Store and config refusals`, `## Lock refusals`, `## Migrate and cache refusals`, `## Token refusals`, and (from spec 05) `## Context slice refusals`. Name the table for each code in the pull request. Each table has the columns Code, Meaning, and Next action. The meaning is the Cause cell. The next action is the Next step cell.

### 3.5 Examples come from code

The examples on the page must be valid. Do not type them by hand.

1. Write `tests/support/docs-examples.ts`. It exports `configExample(): string`, `lockExample(): string`, and `storeStatusExample(): string`. It builds each value with the real serializers: `serializeConfig` and `serializeLock` from `packages/project-config`. The lock fixture uses the real `revisionOf` to compute `hash`, and fixed 40-hex ids for `commit` and `tree`. The remote is `https://github.com/example-org/example-store`. The pin is a complete entry that `validateEntry` accepts. Copy it from an existing `packages/skill-manifest/test` fixture. `storeStatusExample()` prints the `store status` text with `~/.bowerloom` substituted. If the page does not use it, delete the function.
2. `tests/docs-examples.test.ts` reads the page and extracts each fenced `json` block that follows a line `<!-- example: config -->` or `<!-- example: lock -->`. It requires the block to equal the helper's output byte for byte. It parses the config block with `parseConfig` and the lock block with `parseLock`, and requires `lockAgrees(lock, config)` to hold for the pair shown. The builder puts those two marker comments above the two fences. If the page uses the `store status` example, a third marker, `<!-- example: store-status -->`, goes above its fence. These markers are the only comments in the page.
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

### 3.7 Coverage of specs 01a to 09

- Spec 01a: `guides/agents.md` (order 7.8), `cli.md` `## Apply`, `status.md`, `harnesses.md`, `errors.md`, and `releases.md`.
- Spec 02: `releases.md`, plus `start.md` line 42 (the tarball install). Append the release sentence of spec 02. If the offline proof failed, append its fallback form from section 12, item 2.
- Spec 05: `guides/context-slices.md` (order 7.9), `cli.md` `## Context` and `## Registered folders`, `security.md`, `status.md`, `harnesses.md`, `guides/index.md`, and `errors.md` `## Context slice refusals`.
- Specs 03 to 09: this page plus the lists in their own section 9.

### 3.8 Decision-dependent text

- #80 comment 6334887017 (`ITEM_REVIEW_REQUIRED`, variant A built, no default): page sections 6, 9, and 13. Under variant B, replace the hold text with: "Bowerloom trusts a store item fetched from the lock as your team's own store content."
- #80 comment 6334068412 (first screen, default B): the page names `bowerloom help store` as the entry point. Test 5 does not depend on `SECTIONS`.
- #86 decisions 1 (A), 2 (default B), and 3 (A, no default): the guard sentence of page section 6, and the guide of spec 05.
- #84 comment 6333898175 (license gate, A): a release line only.
- #84 comment 6334655034 (agent grants, A built, no default): `guides/agents.md` and the `--allow-agent` flag.
- Spec 08 `MIGRATE_TEAM_MISSING` (A) and spec 09 prune outside a project (A): page section 12 and the cache paragraph.

## 4. Schemas

### 4.1 Page front matter

The keys are `title`, `description`, `section`, and `order`. Values are in 3.1. No other key.

### 4.2 The docs-codes list

Add `apps/docs/tools/beta2-refusal-codes.json`. It holds the sorted keys of `REFUSALS` in `git show c9730d3:apps/cli/src/human.ts`.

`apps/docs/tools/docs-codes.test.mjs` builds `codes` from the source, not by hand. The list `codes` is every key of `REFUSALS` in the current `apps/cli/src/human.ts`, matched by the line regex `^  ([A-Z][A-Z0-9_]+): \{`, minus that baseline.

Call `pageCodes` the fixed list in 5.1.

## 5. Refusal codes

### 5.1 Codes the page explains (the page list)

- Store: `STORE_NOT_FOUND`, `STORE_INVALID`, `STORE_UNSAFE`, `STORE_IN_CLOUD_FOLDER`, `STORE_UNREADABLE`, `STORE_LOCKED`, `STORE_STATE_NESTED`, `STORE_NOT_A_PROJECT`.
- Store items: `STORE_ITEM_NOT_FOUND`, `STORE_ITEM_MISSING`, `STORE_ITEM_NOT_SHAREABLE`.
- Store remote: `STORE_REMOTE_PRIVATE`, `STORE_REMOTE_AUTH_FAILED`, `GITHUB_TOKEN_INVALID`, `GITHUB_RATE_LIMITED`.
- Config: `CONFIG_INVALID`, `CONFIG_UNSAFE`, `CONFIG_LIMIT`, `CONFIG_DUPLICATE_ID`, `CONFIG_ITEM_SELECTED`, `CONFIG_ITEM_NOT_SELECTED`, `CONFIG_ITEM_MISSING`, `CONFIG_WRITE_UNCONFIRMED`, `TEAM_NOT_SELECTED`.
- Lock: `LOCK_MISSING`, `LOCK_INVALID`, `LOCK_UNSAFE`, `LOCK_LIMIT`, `LOCK_CONFIG_MISSING`, `LOCK_CONFIG_MISMATCH`, `LOCK_WRITE_UNCONFIRMED`.
- Lock checks: `LOCK_HASH_MISMATCH`, `LOCK_STORE_NOT_PUSHED`, `LOCK_COMMIT_UNREACHABLE`, `SKILLS_SYNC_CONTENT_MISMATCH`.
- Review hold: `ITEM_REVIEW_REQUIRED`.
- Migrate: `MIGRATE_ID_EXISTS`, `MIGRATE_ITEM_NOT_FOUND`, `MIGRATE_RESERVED`, `MIGRATE_TEAM_MISSING`.
- Network: `SKILLS_OFFLINE`.

### 5.2 Codes the errors reference holds

Every code in `codes` (4.2). This spec adds no new code.

## 6. Where to change

Create:

- `apps/docs/src/content/docs/guides/item-sources.md` (3.1).
- `apps/docs/tools/docs-codes.test.mjs` and `apps/docs/tools/beta2-refusal-codes.json` (section 10, 4.2).
- `tests/support/docs-examples.ts` and `tests/docs-examples.test.ts` (3.5).

Change: every file in the table of 3.2, plus `apps/docs/src/content/docs/releases.md` (3.3) and `apps/docs/src/content/docs/reference/errors.md` (3.4).

Do not change any file under `packages/` or `apps/cli/`. If the page cannot say something true because the code differs from the spec, stop and write the difference in the pull request. Do not change the code in this track.

## 7. Edge cases

| Case | Expected result |
|---|---|
| The page links to `#private-store` and the anchor is missing | `check:links` fails with `missing fragment`. Add the anchor line. |
| An anchor id equals a generated heading id | `check:links` fails with `duplicate ID`, because `html-ids.mjs` counts both. The ids in 3.1 differ from the generated ids. |
| A snippet holds `/Users/...` | `check:links` fails. Use `~` or a placeholder. |
| A code example is not valid JSON | `docs-examples.test.ts` fails. |
| A refusal code in `codes` is missing from `errors.md` | `docs-codes.test.mjs` fails and names the code. |
| A page code is missing from the page | `docs-codes.test.mjs` fails and names the code. |
| The page mentions a command that does not exist | `docs-examples.test.ts` fails. |
| `releases.md` release block is edited | `check:release` fails. Undo the edit. |
| Order 7.75 is already used | Use 7.76 and record it in the pull request. |
| The built page differs between HTML and Markdown | `check:exports` fails. Fix the Markdown source. |
| A reader opens the page from search | The page title and description show. Both are in the front matter. |
| A sentence uses a banned word | The simple-English check on write flags it. Rewrite it. |

## 8. Migration from beta.2 projects

The page serves beta.2 readers. Section 12 of the page tells them what changes and what stays. `releases.md` lists the changed formats. The `status.md` and `cli.md` edits remove the statements that stop being true: the project marker, public-only skills, and the single skills cache.

## 9. Docs changes for this track

This spec is the docs track. Sections 3.1 to 3.8 list every change.

## 10. Acceptance tests

`apps/docs/tools/docs-codes.test.mjs` (run by `npm test` in `apps/docs`):

1. The page file exists, with the exact front matter of 3.1.
2. The page headings, in order, equal the table of 3.1. Each heading line is preceded by its anchor line and exactly one blank line, in the form `<a id="<id>"></a>`.
3. Every code in 5.1 appears in the page text inside backticks.
4. Every code in `codes` (4.2) appears in `errors.md` in a table row that matches `^\| \`<CODE>\` \|`.
5. Take `COMMANDS` (`apps/cli/src/main.ts`) without `help`, `--help`, `-h`, `--version`, and `-V`. Every remaining word appears in a `text` fence of `cli.md` as `bowerloom <word>`. Every `Usage:` line of `TOPICS.use`, `unuse`, `lock`, `store`, `cache`, `receipt`, and `context` appears verbatim in `cli.md`.
6. The page holds the key phrases of `STORE_ITEM_NOT_SHAREABLE` and its next step, and the release lines. The exact strings are checked in `tests/docs-examples.test.ts` (case 7 below).
7. `releases.md` holds a `## 0.7.0-beta.3` section with the eight bold labels of 3.3, in that order.
8. The page holds every promise of spec 07, 3.3 and 3.5, checked by these phrases: `api.github.com`, `never stores`, `never prints`, `never logs`, `refuses redirects`, `Credentials:`.
9. Outside fenced blocks, inline code spans, and the lines between the `item-source-refusals` anchor and the next anchor, the page has no semicolon. It uses none of the words `can`, `could`, `may`, `might`, `should`, `would` (whole words).
10. The page does not contain `Fearless` or `Advanced Metrics`.
11. `releases.md` labels follow the map of 3.3.
12. The line of `cli.md` that starts "These commands work in a project folder." holds `bowerloom.json`.
13. `add-skills.md` holds "without credentials" and "/docs/guides/item-sources/#private-store".
14. `guides/index.md` links to `/docs/guides/item-sources/`.
15. `check-brand.mjs` lists `guides/item-sources`.
16. `guides/agents.md` and `guides/context-slices.md` exist with the front matter of spec 01a section 9 and spec 05 section 9.
17. `status.md` holds "Codex agents are not projected in this beta."
18. `guides/context-slices.md` holds three things. The first is the heading "What the guard does not stop". The second is the phrase "not a security boundary". The third is the "what the measure cannot prove" list of spec 05, section 3.11.
19. `guides/agents.md` holds the revise limit sentence of spec 01a, section 9, verbatim.
20. The `start.md` tarball sentence matches the `releases.md` line of spec 02.

`tests/docs-examples.test.ts`:

1. The config example on the page equals `configExample()`.
2. The lock example on the page equals `lockExample()`.
3. `parseConfig` and `parseLock` accept the two examples, and `lockAgrees` is true for the pair.
4. The helper fixture's lock `hash` equals `revisionOf(files)`.
5. Every `bowerloom <word>` command in a `text` fence of the page starts with a word of the `COMMANDS` set.
6. Spawn the built CLI `store status` with `HOME` set to a temporary folder whose store has no `.git`. Each line after `To fix this, run these commands yourself:` appears in the page.
7. Read the `STORE_ITEM_NOT_SHAREABLE` message and next step through the same accessor that `tests/human-refusal.test.ts` uses. Both appear in the page.
8. Each flag on the page for `use`, `lock`, `apply`, `store`, `cache`, and `receipt` appears in that command's `TOPICS` text.

The build checks of 3.6 pass. Rule 1 (20 words) and the simple-English check are manual review. The reviewer reads the page for them.

## 11. Build order

1. Wait for specs 01a, 02, and 03 to 09 to merge. Read their `TOPICS` and `REFUSALS` text from the merged code.
2. Write `tests/support/docs-examples.ts` and `tests/docs-examples.test.ts`. They fail until the page exists.
3. Write `docs-codes.test.mjs` and `beta2-refusal-codes.json`. They fail until the pages exist.
4. Write the page, section by section, following 3.1.
5. Make the edits of 3.2, 3.3, and 3.4.
6. Run the checks of 3.6 and fix each failure.
7. Ask for the independent review. The reviewer reads the page against the code, not against the spec.

## 12. Unverified items

1. The simple-English hook. The lint hook can flag a rule that this spec does not list. Fix every flag it reports. If it flags a sentence that holds a required fact, shorten the sentence and keep the fact.
2. `check:exports` and the page's `text` fences. Settled: the copy prompt fires only on the headings "Ask your agent" and "Agent procedure" (`content.mjs:30-40`). Text fences are safe.
3. The `order` value 7.75 and the sidebar. Pages sort by `order` within `section`. If the page sorts into the wrong place, check `src/lib/content.mjs` for the sort and use the value it needs.
4. The `<a id>` anchor style. Other pages use `<a id="installed-security-acceptance"></a>` before a heading (`status.md`, `security.md`). Copy that exact style. If `check:links` reports a duplicate id, rename the anchor id and keep the links in step.
5. Settled: the root `README.md` needs no change and must not name 0.7.0-beta.3 (`check:release`).
6. The wording of `STORE_ITEM_NOT_SHAREABLE` and the git commands comes from specs 06 and 03. If the merged code changed them, the docs tests read the merged strings, and the page must copy the merged strings.
7. The order of the frozen refusals in page section 9. The order in this spec comes from the code reading of spec 06. If the merged `frozen.test.mjs` pins another order, copy it and record the difference in the pull request.
