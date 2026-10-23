# 10. Docs for the store, the lock, and item sources

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 9 and decision 20. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decision 20: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333018480. The settled variants and the token: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333364163.
- Lane: 2. Hanna calls this a release requirement, not a footnote. Beta.3 does not ship without it.
- Branch: `beta3/10-docs-item-sources`.
- Depends on: specs 01a, 02, and 03 to 09, merged at cc8187e. It also depends on the code track `beta3/10a-sharing-fixes` (section 1.2). The build starts after that track merges into `release/0.7.0-beta.3`.
- Line numbers below are from commit cc8187e, the head of `release/0.7.0-beta.3` with every beta.3 spec merged. If a line moved, find the place by its text.
- Status: Frozen 2026-10-22 after two independent reviews.
- Revised on 2026-10-22 against cc8187e, after an independent review. The verdict was "revise, not rewrite". The outline, the anchors, the writing rules, and the examples-from-code approach stay.

### 1.1 Decisions already taken

1. `reference/errors.md` keeps its merged headings: `## Store and config refusals` (line 87), `## Lock refusals` (line 147, which also holds the `GITHUB_*` codes and `STORE_ITEM_GONE_AT_COMMIT`), `## Skills and sync refusals` (line 168), and `## Context slice refusals` (line 221). This spec adds rows. It moves no table.
2. The root `README.md` line 161 gets fixed too (section 3.2).
3. The literal beta.2 version strings belong to the release step, not to this spec. They are `cli.md:35` (`Bowerloom 0.7.0-beta.2`), `status.md:8`, and the tarball name in `start.md:42`. Do not edit them.
4. The release notes have no "Fixes" label. A docs-only correction gets no release line.
5. The lock-file sharing model is an embedded nuance. The docs must make it unmistakable (decision 20 on sageadvicellc/bowerloom#80). The owner standard is completeness over expedience: exact strings, every error code, edge cases, and testable checks.

### 1.2 Three fixes from `beta3/10a-sharing-fixes`

A parallel code track builds three fixes. The docs describe them. Each fact below is marked "from beta3/10a". Check each one against the merged code before you write it. If the merged code differs, the code wins. Record the difference in the pull request.

1. `bowerloom team adopt <name>` also accepts a store team that `bowerloom.json` does not list yet. One approved plan copies the team into the project and lists it as a project item. Store skills and prompts that name the team stay store entries. They still need a pushed store, and the plan names them. The `STORE_ITEM_NOT_SHAREABLE` refusal ends with the next step `Or adopt a team into this project with bowerloom team adopt.` That step then works for a team that `use team` refused. Check whether the merged `team adopt` reads `BOWERLOOM_GITHUB_TOKEN` or makes GitHub requests. At cc8187e it reads neither (`packages/project-sync/src/adopt.ts:39-52`). If it does after 10a, add it to page section 8, fact 5, page section 8a, fact 3, section 3.2.2, item 2, and test D9.
2. A new refusal code, `LOCK_COMMIT_GONE`. A locked commit can be gone from GitHub while the repository still reads. Then Bowerloom makes one more request to check the repository. That request counts in the request budget. The refusal message is `The locked commit is no longer on GitHub.` The next step asks the author of the store to run `bowerloom lock update` and push. A repository that does not read keeps `STORE_REMOTE_PRIVATE` without a token and `STORE_REMOTE_AUTH_FAILED` with one.
3. The store keeps a `.gitignore` that ignores `folders/`. That folder holds the records of registered folders and their grants, which belong to one machine. Bowerloom writes the file under the store lock on the first `--global` write that creates the store, on `folder add`, and on `folder allow`. If git tracks `folders/`, `bowerloom store status` warns.

## 2. Problem

Hanna called the idea "an embedded nuance". A person must understand four things before they share a project that uses the store. They must know where each item's bytes come from. They must know what the lock file records. They must know what a teammate needs. They must know the result for a store with no remote.

The code answers each question, but only a page can explain it. Without the page, a person finds the answer by hitting a refusal. The page also gives a reader one place to learn the whole model: the store, the config, the lock, the caches, and the commands that connect them.

The review found that no page states the sharing model as a whole. It is spread over `cli.md`, `errors.md`, `security.md`, and help text, and parts of it are missing. These facts appear nowhere today:

- what "shared" means in full
- who commits what
- the modes a clone needs
- every case of a store item that was never pushed
- the order of the frozen refusals

Specs 01a, 02, and 03 to 09 each wrote the docs lines of their own track. This spec adds the page. It then corrects every other page that the beta.3 code made untrue, and it adds the checks that keep the docs true.

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

The order 7.75 sits after `create-items.md` (7.7) and before `guides/agents.md` (7.8) and `guides/context-slices.md` (7.9).

Writing rules for the whole page. They are the repository's simple-English rules.

1. Short sentences. At most 20 words each.
2. Active voice. Simple tenses. No perfect tenses.
3. Put each condition before its command. Example: "If the store has no remote, push it."
4. Use one word for one thing: "store", "project item", "store item", "pin", "lock", "frozen install", "remote", "cache", "store cache", "shared project", "written item", "content key".
5. Define each term at first use, in the sentence that introduces it.
6. Use none of the words in the list of test D10. Say what Bowerloom does and what the reader does.
7. No semicolons. No dashes as punctuation.
8. Do not name Fearless or Advanced Metrics (repository rule 9).
9. No private paths. The build throws on `/Users/` or `file://` (`apps/docs/src/lib/content.mjs:84`). Use `~` or a placeholder.
10. Use `bowerloom` commands exactly as they print.
11. A string from the code that holds a modal verb or a semicolon goes in inline code or a fence. Examples: the shared-project note `could not read <x>; treating this project as shared`, and the plan tag `(not on this machine yet; Bowerloom shows what it can do after the fetch)`.

Rule 1 (20 words) and the simple-English check are manual review. No test enforces them.

The page has these `##` headings, in this order. Each heading has an anchor line above it, in the form `<a id="<id>"></a>`, followed by one blank line. The builder writes the prose from the required facts. Every fact in a section must appear on the page, in the section where it is listed. The anchor ids differ from the ids that the headings generate, because `apps/docs/src/lib/html-ids.mjs` counts both and `check:links` fails a duplicate.

| Heading | Anchor id |
|---|---|
| `## What this page answers` | `page-questions` |
| `## Four places an item comes from` | `four-kinds-of-item` |
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

The anchor `four-kinds-of-item` keeps its old id. Only the heading text changes.

The page also has these `###` headings, each with an anchor line in the same form:

| Heading | Under | Anchor id |
|---|---|---|
| `### The sharing model in five lines` | `## What this page answers` | `sharing-model` |
| `### What to commit` | `## If you share a project` | `commit-list` |
| `### Before you run` | `## What a teammate does` | `check-modes` |
| `### Every case of an unpushed store item` | `## When the store has no remote` | `unpushed-cases` |

The sections below keep their old numbers. The section "GitHub request limits" is section 8a.

#### Section 1. What this page answers

Required facts:

1. The page answers four questions. Each question is a bullet that links to its section. The questions: where each item's bytes come from, what `bowerloom.lock.json` records, what a teammate needs, and the result for a store with no remote.
2. One sentence that says who needs this page: anyone who shares a project that uses the store, and anyone who wonders where an installed file came from.
3. One sentence says the page covers beta.3 and later. A second sentence says that a project without `bowerloom.json` keeps working, and that beta.3 changes a few things for it. It links to the section "Move a project to the store", which lists them. Do not write "works as in beta.2". That claim is false (section 12, fact 6).
4. The subsection `### The sharing model in five lines`, a numbered list with exactly these five lines:
   1. `Your store, ~/.bowerloom, stays on your machine. No teammate reads it.` (Write `~/.bowerloom` in inline code.)
   2. `A shared project has bowerloom.lock.json, or sits in a git repository with a remote origin that has a URL.` (File names and `origin` in inline code. Amended by #101: a remote counts only when it is named origin and has a URL.)
   3. `In a shared project, the lock records each store item. A teammate fetches each item you wrote from the store repository, the copy of your store on GitHub.` (Amended by #101: one name, the store repository.)
   4. `So push the store to GitHub before you lock an item you wrote, and never rewrite or delete that branch afterward.`

   A lock pin comes from npm or from its own GitHub repository, never from your store. The proof reads the store repository only for written items (`packages/project-sync/src/change.ts:180-182`). So a store that holds only pins needs no remote.
   5. `Commit bowerloom.json, bowerloom.lock.json, and the project items in .bowerloom, as [What to commit](#commit-list) lists. A teammate runs bowerloom apply --frozen.` (File names, the folder and the command in inline code.) Amended by #101: the project items in `.bowerloom` are committed too.
5. What a teammate needs, as a bullet list with these six bullets:
   - the project
   - network access to `api.github.com` and `registry.npmjs.org`
   - Bowerloom 0.7.0-beta.3 or later
   - a project folder that only they can write, with a link to `#check-modes`
   - for a private store, a token, with a link to `#private-store`
   - the rate limit: GitHub allows about 60 requests an hour without a token, and the section "GitHub request limits" says what that means
6. These two sentences, exactly: "Run `bowerloom help store` for the store, store migrate, receipt clean, and cache commands. Run `bowerloom help use` and `bowerloom help lock` for the rest." The help text of `store` names `help use` and `help lock` but does not print their usage (`apps/cli/src/human.ts:50-86`).

#### Section 2. Four places an item comes from

Required facts:

1. A skill, a prompt, and a team are the three things a project selects. Define each in one sentence. Skills and prompts put copies in `.claude` and `.agents`. A team's agents become copies in `.claude/agents` for Claude Code. That holds only for a team the project defines and `bowerloom.json` lists. A store team projects no agents in this beta. `bowerloom team adopt` copies the team, agents included, into the project. Codex agents are not projected in this beta. Context slices are projected for Claude Code only. A context slice is a project item only. It never sits in the store or the lock. Link to `/docs/guides/agents/` and `/docs/guides/context-slices/`.
2. A table with four rows and these columns: kind of item, where it is defined, where its bytes come from, in the lock. Copy the rows and cells from the table in spec 06, section 3.1. Change only the wording, to match the rules above.
3. The sentence: "The lock never records project items. Git versions them."
4. The definition of "store": the folder `~/.bowerloom` on your machine. It holds definitions, and no cache and no installed copy. If you make it a git repository, it also holds `.git`. It also holds `folders/`, the records of registered folders. From beta3/10a: the store's own `.gitignore` keeps `folders/` out of git (section 1.2, fix 3). Link to the `store status` paragraph of `cli.md` (`/docs/cli/#project-commands`).
5. The definition of "pin": an exact npm version or a full GitHub commit with the hashes of the files.
6. The two caches: the skills cache and the store cache. One sentence each. Both live in the private state folder, outside your projects and outside the store. The store cache is the folder `store-cache` in that state folder (`packages/project-sync/src/store-git.ts:32`). Link to `/docs/cli/#cache`.

#### Section 3. The two files

Required facts and snippets:

1. `bowerloom.json` says what the project wants. `bowerloom.lock.json` says what resolved. Commit both.
2. A real `bowerloom.json` example in a `json` fence, below the marker `<!-- example: config -->`. The example holds `harnesses`, three skills, one prompt, and two teams. The skills are `house-style` from the store (written), `local-tool` from the project, and `tanstack-db` from the store (pinned, with `via: ["research"]`). The prompt is `weekly-update`, from the store. The teams are `first-team` (project) and `research` (store). The example comes from the helper of 3.5. Do not type it by hand.
3. A line-by-line reading of that example in a bullet list: `format`, `harnesses`, `id`, `source`, and `via`. Say that `via` appears only on a store entry, and names the store team that picked it (`packages/project-config/src/schema.ts:45`).
4. A real `bowerloom.lock.json` example in a `json` fence, below the marker `<!-- example: lock -->`. The lock holds exactly the four store entries: skills `house-style` (written) and `tanstack-db` (pin), prompt `weekly-update` (written), and team `research` (written). It comes from the helper of 3.5. Both examples satisfy `lockAgrees`.
5. A reading of one lock item of each kind in a bullet list. Every item carries `id` and `from: "store"` (`packages/project-config/src/lock.ts:34`). For the pinned item: the whole `skills.json` entry sits in the lock, `teams` included. In the example it carries `teams: ["research"]`, which is why the config lists it with `via: ["research"]`. For the written item: `remote`, `commit`, `path`, `tree`, `files`, and `hash`. If the store entry of a written skill or prompt names teams, its lock item carries `teams` too. A team never does (`lock.ts:50`, `lock.ts:67-74`). Say what `hash` proves: the bytes a teammate fetches are the bytes you locked.
6. One sentence on how the lock relates to `skills.json`: a lock `pin` is a `skills.json` entry, and the content key comes from it, so one pin downloads once on a machine.
7. The rule that the two files agree: the lock lists exactly the store items that the config lists. `bowerloom lock verify` checks it. If they differ, `apply --frozen` refuses.
8. Replace the old fact about ignored files with this. Bowerloom writes one `.gitignore` of its own in a project, inside `.bowerloom/managed`. It ignores nothing else. It does not ignore `.claude/skills`, `.claude/commands`, `.agents/skills`, or `.claude/agents` (`guides/add-skills.md:226-245`). The project items in `.bowerloom` are files you commit. Link to the subsection `#commit-list`, which lists who commits what. A project with only `bowerloom.json` has no `.bowerloom` until its first install or create.

#### Section 4. If you work alone

Required facts:

1. A project that only you use needs no lock and no remote.
2. The commands in order, in a `text` fence: `bowerloom skill create house-style --global`, `bowerloom use skill house-style`, `bowerloom skills sync`, `bowerloom apply`.
3. What each command does, one sentence each.
4. The rule, short. A project is shared in two cases. Either `bowerloom.lock.json` exists, or the project sits in a git repository with a remote named `origin`. Any remote on any host counts, a private repository that only you use included. Link to the full rule in the next section.
5. The sentence: "If your project is not shared, `use` writes no lock and makes no network call."
6. The folder must already be a project. In a new folder, run `bowerloom up --team <name> --goal <goal>` first.
7. Approval: in a terminal, each command asks `Apply plan <short revision>? [y/N]`. Without a terminal, or with `--json`, it prints the plan and exits 3. Then run it again with `--approve <revision>` (`cli.md:41-43`).
8. If you add a remote later and `bowerloom.json` lists a store item, the project becomes shared with no lock. `bowerloom status` then shows `Lock: absent` and the note `This project is shared but has no bowerloom.lock.json. Run bowerloom lock update.` (`packages/project-sync/src/resolve.ts:75`, `:226-228`). A config with no store item shows `Lock: not-used`. Run `bowerloom lock update` and commit the lock.

#### Section 5. If you share a project

Required facts:

1. The rule for "shared", in full (`packages/project-config/src/shared.ts`):
   - `bowerloom.lock.json` exists in the project folder, even an empty one. The lock test runs first.
   - Or the project folder is in a git work tree whose config has a `[remote "origin"]` section with a `url` line (`shared.ts:56-63`). A remote section with no `url` line does not count.
   - Any `origin` on any host counts. A private repository that only you use counts too.
   - Bowerloom walks up from the project folder to the first folder with a `.git` entry. It stops at your home folder and at `/`, and never looks inside them. So a git repository at `~` does not make a project shared (`shared.ts:118-121`).
   - It follows a worktree and a submodule to their git folder (`shared.ts:83-112`).
   - If it cannot read the lock, `.git`, or `.git/config`, it treats the project as shared. The plans and `status` then print `could not read <x>; treating this project as shared` (`shared.ts:14-19`, `:139`, `:147`, `resolve.ts:230`). A refusal that this caused starts `Bowerloom could not read <x> and treats this project as shared` (`packages/project-config/src/refusal.ts:72-75`).
   - Bowerloom reads files and starts no process.
   - A project with a lock stays shared until the file is deleted. `use` creates a lock only in a shared project whose config lists a store item. It keeps an existing lock up to date, even an empty one (`packages/project-sync/src/change.ts:291-292`).
2. What changes in a shared project: `use` checks that a teammate can fetch each store item. A pinned npm or GitHub skill is always fetchable.
3. The author steps in a `text` fence, in order:
   1. Give the store a remote. Use the commands that `bowerloom store status` prints for the case `none` (section 7, fact 6).
   2. `bowerloom use skill house-style`
   3. Commit `bowerloom.json` and `bowerloom.lock.json`, and push the project.
4. What `use` does in a shared project, in order. It reads the store. It finds the pushed commit of the store. It asks `api.github.com` for that commit. It compares the bytes with your store. It writes the config. It writes the lock.
5. If HEAD is ahead of the pushed commit, `use` prints a warning. Show it verbatim as a template in a `text` fence: `Your store has commits that are not pushed (HEAD differs from origin/<branch>). The lock records the pushed commit <commit8>.` (`change.ts:185`). Bowerloom reads the local refs of the store. It never runs `git fetch`, so `origin/<branch>` is what your last push or fetch left (`packages/project-config/src/git.ts:1-4`, `:144`).
6. The hosts: only `api.github.com`. Say that the plan names the host and that Bowerloom fetches nothing the plan did not name.
7. The store must be on GitHub in this beta, in a repository whose `origin` is a `github.com` address. Other hosts refuse with `STORE_ITEM_NOT_SHAREABLE`.
8. In a shared project, each plan names each store item the config asks for, in the form `<kind> <id> comes from your store; this project asks for it` (`resolve.ts:232`). Show it in a `text` fence. Amended by track 11: the note names where the run takes the item from. On a machine with no store, and in a frozen run, it reads `<kind> <id> comes from the lock and the store repository; this project asks for it`, or `the lock and npm` or `the lock and its GitHub repository` for a pin (`storeItemNote` in `resolve.ts`). The page shows each form.
9. The subsection `### What to commit`, a list of who commits what:
   - The author commits `bowerloom.json` and `bowerloom.lock.json`.
   - The author commits the project items in `.bowerloom`: `skills.json`, `skills/`, `prompts/`, `teams/` (with each team's `agents/`), `slices/`, and `.bowerloom/authoring/receipt.json`. The receipt matters. Apply skips a slice file that the receipt does not register (`packages/project-sync/src/apply-project.ts:127-128`).
   - The author pushes the store to its own GitHub repository. The store never goes into the project repository.
   - Nobody commits `.bowerloom/managed`, the copies in `.claude/skills`, `.claude/commands`, and `.agents/skills`, or the setup files that stay on one machine. Link to `/docs/guides/add-skills/#what-to-commit` for the exact `.gitignore` lines.
   - If an agent has the read guard, keep `.claude/agents` out of git. A guarded copy names your machine's project folder.
   - From beta3/10a: the store's own `.gitignore` keeps `folders/` out of the store repository.

#### Section 6. What a teammate does

Required facts:

1. A teammate needs the project and network access to `api.github.com` and `registry.npmjs.org`. A teammate does not need your store. A teammate needs Bowerloom 0.7.0-beta.3 or later.
2. The subsection `### Before you run`. A clone made under `umask 002` gets folders and files that the group can write. Bowerloom refuses these. `PROJECT_UNSAFE` applied in beta.2 too, and the other three are new in beta.3. Bowerloom checks `.bowerloom` first, then `bowerloom.json`, then the folder (`discovery.ts:226`, `:229`, `:234`). So a clone sees one code at a time:
   - `PROJECT_UNSAFE` for a `.bowerloom` folder that the group or others can write (`packages/project-context/src/discovery.ts:241`).
   - `CONFIG_UNSAFE` for a `bowerloom.json` that the group or others can write (`discovery.ts:166`).
   - `PROJECT_FOLDER_UNSAFE` for a project folder that is not yours, or that the group or others can write (`discovery.ts:234`, `:261`).
   - `LOCK_UNSAFE` for a `bowerloom.lock.json` that the group or others can write (`packages/project-config/src/lock.ts:145`).
   Amended by #101, from the terminal: `bowerloom apply --frozen` refuses in the order `PROJECT_UNSAFE`, `CONFIG_UNSAFE`, `PROJECT_FOLDER_UNSAFE`, `LOCK_UNSAFE`, then `MANIFEST_UNSAFE` when the project has `.bowerloom/skills.json`, then `AUTHORING_UNSAFE_PATH` for a folder inside `.bowerloom`. Other commands check the same things in another order. `chmod -R go-w .` clears every one (`tests/item-sources-cli.test.ts`).
   The fix, in a `text` fence: run `umask 022` before `git clone`. In a clone you already have, run `chmod -R go-w .` in the project folder. Git records no write bits, so the change shows no diff.
3. The steps in a `text` fence, in this order: `git clone <project>`, `cd <project>`, `bowerloom apply --frozen`, read the plan, then `bowerloom apply --frozen --approve <revision>`.
4. A written store skill that this machine has not fetched shows, in a `text` fence, `install skill: <places> (not on this machine yet; Bowerloom shows what it can do after the fetch)`. Some fetched skills and prompts set `allowed-tools`, register hooks, or run shell lines. If the approved plan did not show that, apply installs nothing of such an item. It holds the item with `ITEM_REVIEW_REQUIRED` (`packages/project-sync/src/notices.ts:43-56`). The `Next:` line names the command that shows the item. That is `bowerloom apply --frozen`, `bowerloom skills sync`, or `bowerloom skills sync --frozen`, in the form `Run <command> again to review it.` (`packages/project-sync/src/apply.ts:64`, `:428`, `apply-project.ts:368`, `:420`).
5. What the plan shows for a lock-resolved item: the `[store, from the lock: github.com/<owner>/<repo>]` tag, the line `Frozen: installing only what bowerloom.lock.json records.` (`packages/project-sync/src/plan.ts:520`), and the `Network:` line with the hosts. With a token, a `Credentials:` line comes before it (section 8).
6. Tell the teammate to read the `Credentials:` and `Network:` lines before approving.
7. What `--frozen` does, in order. It reads the config and the lock. When they disagree, it refuses. It ignores any store on the machine. It fetches what the machine does not hold, project pins included. It checks every byte against its pin or the lock. It installs.
8. What the teammate has afterward: the same files you installed, byte for byte.
9. If `bowerloom.json` lists the team, `bowerloom up --team <name>` also installs on a fresh clone, through its sync step. It is not strict. If the machine's store defines the same id, plain `apply`, `skills sync`, and `up` use the live store. A differing lock only produces a note (`resolve.ts:200-210`, `:227`). That holds for a teammate's own store too: their store wins over your lock. Use `bowerloom apply --frozen` to get exactly the locked bytes.
10. The refusal for a missing lock: `LOCK_MISSING`, with the next step. Link to the refusals section.
11. The fetched store items are kept in the store cache. A second run needs no network. After `bowerloom cache prune`, plain `apply` holds such an item with `SKILLS_OFFLINE`. Its next step is `Run bowerloom apply --frozen, or bowerloom skills sync.` (`plan.ts:521`, `plan.ts:573-576`, `apply-project.ts:230`).
12. A slice whose root is a registered folder needs two steps on each machine. First `bowerloom folder add <folder-name> <path>`, with the same name. Then `bowerloom folder allow <folder-name>`, run in the project, with `frontmatter:<key>` after the name when the slice uses that summary kind. Without the record, apply holds the slice with `SLICE_ROOT_MISSING`. Without the grant, or with a grant for another summary kind, it holds it with `FOLDER_NOT_ALLOWED` (`resolveRoot` and `resolveRegisteredRootWith` in `packages/project-context/src/registered-folders.ts`, and `holdWords` in `packages/project-sync/src/slices.ts`). The folder must be yours, below your home folder, outside iCloud folders, and closed to other users.
13. An agent copy with the read guard names your machine's project folder. If the project commits `.claude/agents`, apply on a teammate's machine holds that agent with `AGENT_TARGET_OCCUPIED`. Keep `.claude/agents` out of git. (This follows decision 2 of #86. Variant B is the default.)

#### Section 7. When the store has no remote

Required facts:

1. The seven causes of `STORE_ITEM_NOT_SHAREABLE`, in a bullet list, each with its sentence from `NOT_SHAREABLE` (`packages/project-config/src/refusal.ts:49-57`):
   - `none`: `The store is not a git repository.`
   - `no-origin`: `The store repository has no remote named origin.`
   - `unsupported-remote`: `The store remote is not a github.com repository.`
   - `unreadable`: `Bowerloom cannot read the git files of the store.`
   - `unpushed`: `The store has no pushed commit for this branch.`
   - `file`: `The item holds a file that a lock cannot record.`
   - `size`: `The item is larger than a lock can record.`
2. What a lock can record (`packages/skill-manifest/src/content.ts:26`, `:42-53`): files that end in `.md`, `.txt`, `.json`, `.yaml`, `.yml`, or `.csv`, and `LICENSE` and `NOTICE` files. Each file is not empty, is UTF-8 with no byte order mark, and has no execute bit. An item holds at most 126 files, 65536 bytes in a file, and 2 MiB in all. So a store item cannot carry a script.
3. What counts as `unreadable` or `unpushed` (`packages/project-config/src/git.ts`): a `reftable` folder (`:123`) or `objectFormat = sha256` (`:127`) is `unreadable`. A file in the store's `.git` that the group or others can write is `unreadable` (`:57`). A store made under `umask 002` has such files. A detached HEAD without `--commit` is `unpushed` (`:138`).
4. In a project that is not shared, nothing is wrong. The project works on your machine.
5. In a shared project, `use` refuses `STORE_ITEM_NOT_SHAREABLE`. Show the refusal for the cause `none` in a `text` fence, as `renderRefusal` prints it: the `Refused (STORE_ITEM_NOT_SHAREABLE): ...` line, the sentence line, and the `Next:` line. The test reads them from the code (test E8).
6. What `bowerloom store status` shows for each case:
   - Every git state prints the last line `A private repository needs BOWERLOOM_GITHUB_TOKEN on each machine that fetches.` (`apps/cli/src/store.ts:155`).
   - If the store has a GitHub remote, a `GitHub token:` line follows the `Git:` line. That holds for a ready store and for `unpushed` (`store.ts:148`).
   - `unreadable` prints no fix commands (`store.ts:143`).
   - The fix commands, each in its own `text` fence, under a sentence that names the case. The output indents them by four spaces. The page shows them without the indent (`store.ts:139-142`):
     - `none`: `cd ~/.bowerloom`, `git init`, `git add -A`, `git commit -m "Store"`, `git remote add origin https://github.com/<owner>/<repo>.git`, `git push -u origin <branch>`. If the store has no branch yet, the output prints `<branch>`. That is the case for `none`.
     - `no-origin`: `cd ~/.bowerloom`, `git remote add origin https://github.com/<owner>/<repo>.git`, `git push -u origin <branch>`.
     - `unsupported-remote`: `cd ~/.bowerloom`, `git remote set-url origin https://github.com/<owner>/<repo>.git`.
     - `unpushed`: `cd ~/.bowerloom`, `git push -u origin <branch>`.
   - From beta3/10a: the warning that git tracks `folders/`, with its exact text from the merged code.
7. Before `git add -A` in the store, finish or clear any interrupted `--global` create. Record the gap between spec 04 and spec 06 about the pending record warning in the pull request.
8. If your umask is 002, set `umask 022` in your shell profile, then run `chmod -R go-w ~/.bowerloom/.git`. Otherwise each new git file makes the store `unreadable` again.
9. The subsection `### Every case of an unpushed store item`. A table with the columns case and result. One row for each case, in this order:
   - The project is not shared. Result: it works on your machine. `use` writes no lock and makes no network call.
   - Shared, and the store has one of the five git problems of fact 1. Result: `STORE_ITEM_NOT_SHAREABLE` with that cause.
   - Shared, and the item holds a `.DS_Store` or another file a lock cannot record. Result: `STORE_ITEM_NOT_SHAREABLE` with the cause `file`, before any network call (`packages/project-sync/src/store-items.ts:27-35`).
   - Shared, and the item is too large. Result: the cause `size`, before any network call.
   - Shared, the store is pushed, but the item is new, or edited and not pushed. Uncommitted edits count. Result: `LOCK_STORE_NOT_PUSHED`.
   - Shared, the store is pushed, but a git-ignored `.md` file, `core.autocrlf`, or a git filter makes the pushed bytes differ. Result: `LOCK_STORE_NOT_PUSHED`.
   - Shared, HEAD is ahead of `origin/<branch>`, and the item is unchanged. Result: the warning of section 5, fact 5, and the lock records the pushed commit.
   - `store migrate` in a shared project with an unpushed store. Result: it copies the item to the store and does not switch it. The plan prints `Not switched: <kind> <id> cannot be locked yet.` (`apps/cli/src/store.ts:211`).
   - You edit a store item after you lock it. Result: your plain commands install your unpushed bytes, with the stale note. A teammate's frozen install gets the locked bytes.
   - Bowerloom fails to read a file, and only that makes the project shared. Result: the refusal starts `Bowerloom could not read <x> and treats this project as shared`.
10. The ways out, as a numbered list:
    1. Give the store a remote on github.com and push it.
    2. For a team, run `bowerloom team adopt <id>`. From beta3/10a: this works for a store team that `bowerloom.json` does not list yet. One approved plan copies the team into the project and lists it as a project item. Store skills and prompts that name the team stay store entries. They still need a pushed store, and the plan names them.
    3. For a skill or prompt, read the config first. If it lists the item, run `bowerloom unuse <kind> <id>`. Then run `bowerloom <kind> create <id>`, then copy the files from `~/.bowerloom` into the new project item yourself.
    4. For a skill, pin a published copy in the store under a new id: `bowerloom skills add <source> --id <new-id> --global`. Then run `bowerloom use skill <new-id>`. If the config lists the old id, run `bowerloom unuse skill <id>` first. The same id refuses: `skills add` without `--replace` refuses `SKILLS_ADD_EXISTS`, and `--replace` over a written skill refuses `SKILLS_ADD_SOURCE_CHANGED` (`packages/skill-manifest/src/add.ts:133`, `:166`).

#### Section 8. A store in a private repository

Required facts:

1. Without a token, Bowerloom sends no credentials. A private repository answers 404, and Bowerloom refuses `STORE_REMOTE_PRIVATE`.
2. To use a private store, set `BOWERLOOM_GITHUB_TOKEN` to a GitHub token with read access to the store repository. Advise a fine-grained token. A classic token needs the `repo` scope, which grants write access to every private repository. Name the read-only `Contents` permission only after the pull request of spec 07 records its hand check (spec 07, section 12, item 6) as passed. Until then, name no permission. Show the shell steps of `troubleshooting.md:92-93` (`read -rs`, then `export`) or link to them.
3. The exact promises, as a bullet list. Use the wording of `security.md:44` and `:48`:
   - Bowerloom sends the token to one host, `api.github.com`.
   - It sends it only for the repository of your store remote, or the repositories that the lock names for its store items. In a clone, the lock names them. A lock names at most 8 store remotes (`lock.ts:33`, `:115-116`, `plan.ts:600-601`).
   - Each plan that uses the token shows a `Credentials:` line that names those repositories.
   - It never stores the token. It never prints it. It never writes it to a plan, a lock, a receipt, a log, or any other file.
   - It refuses redirects.
   - In a project you did not write, read the `Credentials:` line before you approve. The token goes to each repository the lock names.
   - Do not script `--approve` in a loop. A script that approves every plan also approves a repository it never saw.
4. The `Credentials:` line and the token tail, as templates in a `text` fence, from `credentialsLines` and `TOKEN_TAIL` (`apps/cli/src/sync.ts:70-77`): `Credentials: BOWERLOOM_GITHUB_TOKEN is set. It is sent to api.github.com for github.com/<owner>/<repo> only.` and the tail `Store items use your GitHub token for the repositories above.`
5. Which commands read the variable, as a bullet list:
   - `apply --frozen` (`apps/cli/src/apply.ts:287`)
   - `skills sync` (`sync.ts:214`)
   - the sync step of `up` (`up.ts:161`)
   - `use` (`use.ts:135`)
   - `lock update` (`apps/cli/src/lock.ts:60`)
   - `store migrate` (`apps/cli/src/store.ts:261`)
   Each reads it only for a store item that needs the store repository. `store status` only reports whether it is set, not set, or set but not valid (`store.ts:167`). Plain `apply` never reads it (`apps/cli/src/apply.ts:287`).
6. What the other public fetches do: `skills add` and pinned skills stay anonymous.
7. The refusals `GITHUB_TOKEN_INVALID`, `STORE_REMOTE_AUTH_FAILED`, and `GITHUB_TOKEN_SSO_REQUIRED`, and the next step for each.
8. A teammate sets the same variable on their machine.
9. A plan made with the token set, then applied without it, or the reverse, refuses `STALE_APPROVAL`. The plan says why, with the note `Setting or removing BOWERLOOM_GITHUB_TOKEN between the plan and --approve also changes the plan.` (`store-git.ts:59`).
10. A malformed variable refuses `GITHUB_TOKEN_INVALID` in every command that reads it, for a public store too.
11. Link to `/docs/security/#the-github-token-for-a-private-store`.

#### Section 8a. GitHub request limits

Required facts:

1. GitHub allows about 60 requests an hour without a token, and about 5,000 with one.
2. These three sentences, exactly: "A skill or team takes 4 requests plus 1 for each file with different content. A prompt takes 5. One item takes at most 130." (`packages/skill-manifest/src/resolve-store-git.ts:128-129`, `change.ts:166`, `change.ts:169`, `store-git.ts:259`. Files with the same sha256 count once. A prompt has one file, so 4 plus 1. The file limit is 126, so 4 plus 126.)
3. Which commands spend requests. `use`, `lock update`, and `store migrate` prove a written item. `apply --frozen`, `skills sync`, and the sync step of `up` fetch a written item that this machine lacks. `lock update` skips an unchanged item. A cached item costs nothing.
4. The budget of one run. `apply` and `skills sync` take `--max-github-requests <n>`, a whole number from 1 to 5000. The default is 1000 (`store-git.ts:256-257`, `plan.ts:68`, `cli.md:170`, `cli.md:291`, `human.ts:205`, `human.ts:254`). `use`, `lock update`, and `store migrate` have a fixed budget of 1000 (`change.ts:308`, `change.ts:439`, `packages/project-sync/src/migrate-store.ts:270`). A run over its budget refuses `GITHUB_REQUEST_BUDGET`. From beta3/10a: the extra request that checks for `LOCK_COMMIT_GONE` counts in the budget.
5. The plan lines of a proof, in a `text` fence, verbatim as templates:
   - `Network: reads api.github.com, to check the pushed copy of <n> items, about <r> requests to api.github.com.`
   - `Without a token GitHub allows about 60 requests an hour. Set BOWERLOOM_GITHUB_TOKEN, or run the command again after an hour to finish.`
   Say when each prints. If the count is over 60 and no token is set, the second line prints. Otherwise it does not. With a token, the `Network:` line ends with the token tail, and a `Credentials:` line comes before it (`apps/cli/src/use.ts:73-76`).
6. The frozen and sync plans print other `Network:` forms. They name the hosts and the number of items to fetch (`apply.ts:190-194`, `sync.ts:145-147`). Show the public form as a template, in a `text` fence:
   - `Network: reads <hosts> for <n> items, public and without credentials. Bytes must match their pins or bowerloom.lock.json.`
   
   The request line, from `sync.ts:103-107`, is a second template:
   - `GitHub requests: at most <r>, of the <max> this run allows.`
   
   The sync and apply plans print it in two cases. The run makes requests, or the person set the limit. Over the limit, the line adds `Run it with --max-github-requests <r> or more.` to its end.
7. With `BOWERLOOM_GITHUB_TOKEN` set, store items count against the 5,000 limit, for a public store too. Pinned GitHub skills never send the token, so they stay at 60.
8. `GITHUB_RATE_LIMITED`, with its next step. Items fetched before the stop stay in the store cache.

#### Section 9. Frozen installs and plain apply

Required facts:

1. A table with these columns: command, reads the store, reads the lock, fetches, network. Rows:
   - `apply`: yes for store items, yes for items the store lacks, never, none.
   - `apply --frozen`: no, yes, what this machine lacks (project pins included), the hosts in the plan.
   - `skills sync`: yes, yes for items the store lacks, pins and lock items this machine lacks, `registry.npmjs.org` and `api.github.com` as the plan names.
   - `skills sync --frozen`: no, yes, what this machine lacks, as the plan names. With `--offline`, none.
   - `up --team <name>`: its sync step works as `skills sync`, and its apply step works as `apply`.
   `apply` has no `--offline` flag.
2. The sentence: "Plain `apply` never fetches." Then: plain `apply` holds a lock-resolved item that this machine lacks with `SKILLS_OFFLINE`, and its next step is `Run bowerloom apply --frozen, or bowerloom skills sync.`
3. The `npm ci` comparison in one sentence.
4. The refusals of a frozen run before the plan, in the order the code checks them (`resolve.ts:158-182`). Give each one with its `Next:` text from `human.ts`. Name the order "the order Bowerloom checks". `packages/project-sync/test/frozen.test.mjs:33-54` tests each code alone and pins no order.
   1. The project checks: `PROJECT_*` codes, among them `PROJECT_FOLDER_UNSAFE` and `PROJECT_UNSAFE`, and `CONFIG_UNSAFE` and `CONFIG_UNREADABLE` (project discovery).
   2. `bowerloom.json`: if it is missing, `LOCK_CONFIG_MISSING`, even with no lock. So a beta.2 project without `bowerloom.json` cannot use `--frozen`. If it does not parse, its own code: `CONFIG_INVALID`, `CONFIG_LIMIT`, or `CONFIG_DUPLICATE_ID`.
   3. `bowerloom.lock.json`: `LOCK_UNSAFE`, `LOCK_LIMIT`, or `LOCK_INVALID`.
   4. `LOCK_MISSING`. It applies only to a config that lists a store item.
   5. `LOCK_CONFIG_MISMATCH`.
5. The statement: files that disagree stop a frozen run before any network call or write.
6. The refusals after the plan, one line each, in no fixed order:
   - `STORE_ITEM_GONE_AT_COMMIT`
   - `LOCK_COMMIT_GONE` (from beta3/10a)
   - `STORE_REMOTE_PRIVATE` and `STORE_REMOTE_AUTH_FAILED`
   - `GITHUB_TOKEN_INVALID` and `GITHUB_TOKEN_SSO_REQUIRED`
   - `GITHUB_RATE_LIMITED`, `GITHUB_REQUEST_FAILED`, and `GITHUB_REQUEST_BUDGET`
   - `LOCK_HASH_MISMATCH` and `SKILLS_SYNC_CONTENT_MISMATCH`
   - `SKILLS_OFFLINE` and `SKILLS_SYNC_INTERRUPTED`
   - `STALE_APPROVAL`. A token set or removed between the plan and `--approve` also causes it.
   - the hold `ITEM_REVIEW_REQUIRED`
7. `skills sync --frozen --offline` is allowed. A needed fetch refuses `SKILLS_OFFLINE`.

#### Section 10. Change an item

Required facts, each as a short numbered procedure in a `text` fence with a sentence before it:

1. Edit a store item: edit the files in `~/.bowerloom`, commit, push, `bowerloom lock update` in each project, commit the lock. Teammates then run `bowerloom apply --frozen`. A project without a lock needs only `skills sync` and `apply`.
2. Replace a pinned store skill: `bowerloom skills add <source> --id <id> --replace --global`, then `bowerloom lock update`.
3. Stop using an item: `bowerloom unuse skill <id>`. The copies stay. Say how to delete them yourself.
4. Pick a team and its items: `bowerloom use team <id>`, and what `via` means.
5. Copy a store team into the project: `bowerloom team adopt <id>`. The project then owns the copy. From beta3/10a: the team need not be listed first.
6. The sync and apply plans print `The lock is out of date for <ids>. Run bowerloom lock update.` (`resolve.ts:74`). `bowerloom status --json` reports `config.lock.state` as `stale`. `bowerloom status` prints one of seven `Lock:` states: `not-used`, `valid`, `stale`, `mismatch`, `invalid`, `absent`, and `orphan`.
7. When a store item changes, the next plan shows an update tagged `[store]`, and nothing is written until you approve.
8. When an item leaves the store, a normal run installs it from the lock when the lock holds it. Without a lock item, the plan holds it with `STORE_ITEM_MISSING`.
9. Never rewrite or delete the store branch after you lock it. A teammate's frozen install then fails. From beta3/10a: the refusal is `LOCK_COMMIT_GONE`, with the message `The locked commit is no longer on GitHub.` The author runs `bowerloom lock update`, commits the lock, and pushes. A store repository made private, or deleted, refuses `STORE_REMOTE_PRIVATE` without a token.
10. `--commit <sha>` on `use`, `lock update`, and `store migrate` records that commit of the store remote instead of the pushed commit of the current branch. A commit that GitHub does not have refuses `LOCK_COMMIT_UNREACHABLE`.

#### Section 11. Merge conflicts in the lock

Required facts:

1. Why they are rare: one item per id, sorted, no times. Two branches that add items with adjacent ids still conflict, because their lines touch.
2. What a real conflict looks like: markers in the file, and `LOCK_INVALID` from `use`, `lock verify`, `skills sync`, and `apply`. `bowerloom status` shows `Lock: invalid` (`resolve.ts:176`, `plan.ts:511-512`). `lock update` without `--item` rebuilds the lock.
3. The steps in a `text` fence: for each conflicting item keep either side, delete the markers, run `bowerloom lock verify`. On a machine with the store, run `bowerloom lock update` without `--item` instead. It rebuilds a lock that reads `LOCK_INVALID` from `bowerloom.json`, and it drops the old pins. With `--item`, it refuses (`change.ts:396-408`). The plan prints, in a `text` fence: `bowerloom.lock.json could not be read (LOCK_INVALID); it is rebuilt from your store. The old pins are dropped.`
4. Settle `bowerloom.json` first. Until it parses, Bowerloom reads it as `CONFIG_INVALID`.
5. If the settled pair lists different items, `lock verify` refuses `LOCK_CONFIG_MISMATCH`. Run `bowerloom lock update`.
6. What `lock verify` checks, in its order (`apps/cli/src/lock.ts:24-35`): the lock file and its hashes, then that `bowerloom.json` is there and parses, then that the two agree. A missing lock refuses `LOCK_MISSING`. It uses no network.

#### Section 12. Move a project to the store

Required facts:

1. Who needs this section: a project from beta.2.
2. The steps of spec 08, section 8, in a numbered list, for a project that is not shared.
3. The extra steps for a shared project: push the store, then run the command again. Until then `store migrate` copies and does not switch.
4. What `store migrate` never does: delete a file.
5. What `receipt clean` does, and the step to run before it.
6. A project without `bowerloom.json` keeps working. State what beta.3 changes for it, as a bullet list:
   - A project folder that is not yours, or that others can write, refuses `PROJECT_FOLDER_UNSAFE`.
   - `apply` copies the agents of every team, `first-team` included, to `.claude/agents` for Claude Code.
   - A file named `bowerloom.json` also marks a project, and `~/.bowerloom` no longer stops project discovery.
   - New JSON formats: `ls --json` is `bowerloom/ls/v1beta2`. `status --json` is `bowerloom/project-status/v1beta2`. `skills check --json` is `bowerloom/skills-manifest-check/v1beta2`. The `skills add` plan is `bowerloom/skills-manifest-change/v1beta2`. The `apply` plan and result are `bowerloom/project-apply-plan/v1beta2` and `bowerloom/project-apply-result/v1beta2`. The create plans are `bowerloom/authoring-plan/v1beta2`. The sync plan and result are `bowerloom/skills-sync-plan/v1beta2` and `bowerloom/skills-sync-result/v1beta2`.
7. Say what `store migrate` does for a missing team (`MIGRATE_TEAM_MISSING`, variant A of spec 08). Say that moving a team with agents stops the projection of its agents, because a store team projects no agents (`apps/cli/src/store.ts:210`). Say how `cache prune` behaves outside a project (variant A of spec 09). Put the last one in the cache paragraph.

#### Section 13. Refusals

A table with the columns code, what it means, and what to do. One row for each code in the list of 5.1. Group the rows under bold labels. Each label is the name of a group in 5.1, such as **Store items**. The labels follow the order of 5.1, and each code sits under the label of its group. Link to `/docs/reference/errors/` for the whole list.

Copy the last two cells of each row from the first row for that code in the merged `reference/errors.md`. The reviews rewrote many of those sentences, so do not copy the cells of the frozen specs. `STALE_APPROVAL` has two rows in `errors.md`. Use the first. Test D6 checks each cell. Amended by #101: use the row of the project tables, which holds the words the terminal prints. Test D6 reads the rows by the table they sit in.

#### Section 14. Words used on this page

A definition list. One entry for each of: store, project item, store item, pin, lock, content key, remote, frozen install, shared project, cache, store cache, config, registered folder, written item. Each definition is one sentence. The page defines a term at first use as well.

### 3.2 Edits to other pages

Specs 01a, 02, and 03 to 09 own the new command text. This section owns the consistency pass and the statements that are no longer true.

#### 3.2.1 Already done: check only

The merged code and docs already hold these. Do not rewrite them. Read each one against the code, and fix only a statement the code proves wrong.

| File and lines | What is already there |
|---|---|
| `cli.md:59` | The project marker sentence names `.bowerloom` or `bowerloom.json`, the store rules, and `PROJECT_FOLDER_UNSAFE`. |
| `cli.md:61-102` (`## Project commands`) | The usage of the nine store, lock, receipt, and cache commands, and a paragraph for each. |
| `cli.md:106-125` (`## Cache`) | The cache commands. |
| `cli.md:137-141`, `cli.md:145-165` | `team adopt`, `--global`, slices, context, and registered folders. |
| `cli.md:170-175` | `--frozen`, `--max-github-requests`, and the token paragraph of `## Apply`. |
| `cli.md:288-291` | `--global` and `--frozen` in the skills usage. |
| `security.md:40-50` | `## The GitHub token for a private store` (spec 07). |
| `troubleshooting.md:88-107` | `## My store is private` and `## My disk is filling up`. |
| `guides/existing-project.md:72-85` | `## Move your items to the store` (spec 08). |
| `guides/create-items.md:117-135` | `## Create an item in your store` and `## Pick an item from your store`. |
| `guides/add-skills.md:403-420` | `## Share a project`, `## Pin a skill in your store`, and `## See and clear the cache`. |
| `guides/agents.md`, `guides/context-slices.md` | The pages of specs 01a and 05, except `guides/context-slices.md:87` and `:155` (section 3.2.2, items 32 and 33). |
| `reference/errors.md` | The beta.3 rows of specs 03 to 09. |

#### 3.2.2 Still to do

Each item names the file, the place, and the exact change. A quoted sentence is the exact text to write.

1. `cli.md:31`, the help list. Replace the second sentence with these three sentences:
   - "`bowerloom help <command>` shows the full help of one command."
   - "These commands have it: `up`, `ls`, `status`, `store`, `use`, `unuse`, `lock`, and `receipt`."
   - "So do `cache`, `skills`, `apply`, `context`, `team`, `skill`, `prompt`, and `init`."
   - Then add: "`bowerloom help slice` and `bowerloom help folder` show the help of `context`."
   - The list is the keys of `TOPICS` (`apps/cli/src/human.ts:50-317`) plus `init`. `main.ts:119` maps `slice` and `folder` to `context`.
2. `cli.md:175`, the token paragraph. Replace its second sentence with two sentences:
   - "Six commands read it: `apply --frozen`, `skills sync`, the sync step of `up`, `use`, `lock update`, and `store migrate`."
   - "Each reads it only for a store item that needs the store repository."
3. `cli.md:177`. Replace "Codex agents and context slices are not projected in this beta." with two sentences:
   - "Codex agents are not projected in this beta."
   - "Context slices are projected for Claude Code only."
4. `cli.md:304`, the `skills sync` paragraph. Replace it with these sentences, in this order:
   - "`skills sync` installs the skills that the project selects into `.bowerloom/managed`, `.claude/skills`, and `.agents/skills`."
   - "It installs them for Claude Code and Codex."
   - "In a project without `bowerloom.json`, that is every skill in `.bowerloom/skills.json`."
   - "In a project with it, that is the skills it lists."
   - "It fetches only what this machine lacks."
   - "That is a pin that the skills cache does not hold."
   - "It is also a lock item that the store cache does not hold."
   - "It checks every byte against its pin or the lock first."
   - "`--frozen` installs only what `bowerloom.lock.json` records and ignores your store, as `apply --frozen` does."
   - "`--max-github-requests <n>` lets one run make up to n GitHub requests, at most 5000. The default is 1000."
   - "If a pin still needs fetching, `--offline` refuses before any change."
   - "`--team` syncs only that team's skills."
   - "A skill whose copy you changed is held and shown with its next step, and the others apply."
   - "Sync removes nothing. Ctrl-C stops it between two skills, never inside one."
5. `cli.md`, a new section `## Store and lock` before `## Cache` (line 106). It holds three bullets and one sentence:
   - "`~/.bowerloom/store.json` marks your store."
   - "`bowerloom.json` lists what a project installs and where each item comes from."
   - "`bowerloom.lock.json` records where each store item comes from and a hash of its bytes."
   - "[Where your items come from](/docs/guides/item-sources/) explains how they fit together."
6. The public-sources sentence, in twelve pages. The pages and lines:
   - `cli.md:16`, `reference/errors.md:10`, `start.md:12`, `setup.md:9`
   - `revision.md:16`, `harnesses.md:10`, `troubleshooting.md:10`, `status.md:32`
   - `learn/first-team.md:10`, `guides/new-workspace.md:10`, `guides/existing-project.md:10`, `guides/recover-revision.md:10`

   In each, replace "This beta reads skills only from public sources." with these two sentences. Keep the sentence that follows.
   - "This beta reads pinned skills only from public sources."
   - "A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`, as [Where your items come from](/docs/guides/item-sources/#private-store) explains."
7. `README.md:161`, in the repository root. Replace the bullet "Skills come from public sources only. Only MIT and Apache-2.0 skills install." with this bullet:
   - "Pinned skills come from public sources only. A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`. Only MIT and Apache-2.0 skills install."
   - Add no version string. `check:release` refuses any version but the release version in `README.md`.
8. `status.md:34-40`, the command bullets.
   - Line 38 becomes: "`bowerloom team create`, `skill create`, and `prompt create` make files inside `.bowerloom`, or in your store with `--global`."
   - Add a bullet after line 40: "`bowerloom use`, `unuse`, and `team adopt` pick items for a project."
   - Add a bullet: "`bowerloom lock verify` and `lock update` keep `bowerloom.lock.json`."
   - Add a bullet: "`bowerloom store status`, `store migrate`, and `receipt clean` manage your store."
   - Add a bullet: "`bowerloom cache list` and `cache prune` manage this machine's caches."
   - Add a bullet: "`bowerloom apply --frozen` and `skills sync --frozen` install only what the lock records."
9. `status.md:48`. Replace "Codex agents and context slices are not projected in this beta." with the two sentences of item 3.
10. `status.md:51`. Replace the bullet with these three sentences:
    - "Pinned third-party skills come from public npm and GitHub sources, and only MIT and Apache-2.0 skills install."
    - "Store items come from your store, or from its GitHub remote on a teammate's machine."
    - "A store in a private repository needs `BOWERLOOM_GITHUB_TOKEN`."
11. `configuration.md:79-91`, the What to commit table. Add four rows:
    - `bowerloom.json`: "What the project installs, and where each item comes from". Commit it: Yes.
    - `bowerloom.lock.json`: "Where each store item comes from, with a hash of its bytes". Commit it: Yes.
    - `.bowerloom/slices/`: "Context slice files". Commit it: Yes.
    - `.claude/agents/`: "Agent copies for Claude Code. A guarded copy names this machine's project folder". Commit it: No.
    - In the `.bowerloom/teams/<team id>/` row, add "Its `agents/` folder holds the team's agents."
12. `configuration.md:93`. Replace the `PROJECT_BRIEF_INVALID` sentence with these three sentences (`apps/cli/src/up.ts:122-133`):
    - "On a clone, `team create` refuses with `PROJECT_BRIEF_INVALID`, because it reads `.bowerloom/brief.json`, which stays on the first machine."
    - "In a project without `bowerloom.json`, `bowerloom up --team <name>` refuses the same way."
    - "In a project with `bowerloom.json`, `up` works on a clone for each team that the file lists."
    - In the sentence before it, add `bowerloom apply --frozen` to the commands that rebuild the copies.
13. `configuration.md:95`. Add: "The store cache, the folder `store-cache` in the same private state folder, keeps the store items fetched from a store remote."
14. `guides/add-skills.md:18`. "Run these commands in a project folder that holds `.bowerloom`." becomes "Run these commands in a project folder that holds `.bowerloom` or `bowerloom.json`."
15. `guides/add-skills.md:20`. Keep the text before the last sentence, "without credentials" included. Replace "Private registries and private repositories are not supported in this beta." with these three sentences:
    - "Private registries and private repositories are not supported for pinned skills."
    - "A store in a private GitHub repository is a separate case."
    - "See [Where your items come from](/docs/guides/item-sources/#private-store)."
16. `guides/add-skills.md:174` and `:260`. Replace the `PROJECT_BRIEF_INVALID` sentence with the three sentences of item 12.
17. `guides/add-skills.md:228-245` and `:247`.
    - Add the line `.claude/agents/` to the `.gitignore` block, after `.claude/commands/`.
    - Replace the whole line 247 with these four sentences:
      - "Git then shows `bowerloom.json`, `bowerloom.lock.json`, and `skills.json` as files to commit."
      - "It also shows the team, skill, prompt, and slice definitions."
      - "In a project without `bowerloom.json`, a teammate's `skills sync` needs only `.bowerloom/skills.json`."
      - "In the trial run for this release, the teammate's clone held only that file, and sync and apply worked."
18. `guides/add-skills.md:405`. "The page about where items come from explains" becomes "[Where your items come from](/docs/guides/item-sources/) explains".
19. `guides/add-skills.md:424`. In the bullet, replace "Private registries and private repositories are not supported." with the three sentences of item 15.
20. `guides/add-skills.md:438`. The bullet becomes "Private npm registries and private Git repositories for pinned skills."
21. `guides/create-items.md:8`. "They write inside `.bowerloom` only." becomes "They write inside `.bowerloom` only, or inside your store with `--global`."
22. `guides/create-items.md:12`. "so the project holds `.bowerloom`" becomes "so the project holds `.bowerloom` or `bowerloom.json`".
23. `guides/index.md:18`. Add a table row after it. Its first cell is "Share a project that uses your store". Its second cell is "[Where your items come from](/docs/guides/item-sources/)".
24. `concepts/teams-and-files.md:34-36`, the section `## Portable and private`. Add these sentences after line 36:
    - "Your store, `~/.bowerloom`, holds definitions only and stays on your machine."
    - "`bowerloom.json` and `bowerloom.lock.json` are portable, so commit them."
    - "The skills cache and the store cache stay private to each machine."
    - "[Where your items come from](/docs/guides/item-sources/) explains how they fit together."
25. `start.md:42`. Append two sentences after the line. Spec 02 defined no `start.md` sentence, so this spec writes it. Keep the beta.2 tarball name in the line (decision 3).
    - "Installing from a downloaded .tgz file gives the same dependency versions as the tested build."
    - "The file carries its dependencies, so it installs with no network and no npm cache."
    - The second sentence equals the second sentence of the spec 02 release line (`releases.md:46`).
26. `reference/errors.md:165`. The `GITHUB_REQUEST_BUDGET` Meaning cell becomes these three sentences. Keep the next action.
    - "A lock this large needs several runs or a smaller selection."
    - "One run makes at most 1,000 GitHub requests by default."
    - "`apply` and `skills sync` take `--max-github-requests <n>`, up to 5000."
27. `reference/errors.md:156`. The `LOCK_LIMIT` Meaning cell becomes these three sentences (`lock.ts:31-33`, `:116`):
    - "This beta keeps the lock small: 128 skills, 128 prompts, 32 teams, and 4 MiB at most."
    - "An item holds at most 126 files, 65536 bytes in a file, and 2 MiB in all."
    - "A lock names at most 8 store remotes."
28. `reference/errors.md`, the table of `## Project and approval refusals`, which ends before line 85. The prose at line 85 names two codes that no table row holds. Add a row for each:
    - `AUTHORING_DISK_FULL`. Meaning: "The disk has no room, so Bowerloom stopped before it wrote more." Next action: "Run `df -h .`."
    - `AUTHORING_ACCESS_DENIED`. Meaning: "The system refused the write, so Bowerloom stopped before it wrote more." Next action: "Run `ls -ld .bowerloom ~/.bowerloom`."
28a. `reference/errors.md:82`. The `PROJECT_BRIEF_INVALID` Meaning cell becomes these three sentences. Keep the next action.
    - "A new team is built from the project brief that setup saved, and it cannot be read."
    - "On a clone, `team create` refuses this way, because `.bowerloom/brief.json` stays on the first machine."
    - "In a project without `bowerloom.json`, `bowerloom up --team` refuses the same way."
29. `troubleshooting.md`, two new entries after `## My disk is filling up`, before line 109.
    - The entry `## My teammate cannot install my store items`. It lists each code the teammate sees, with what to do:
      - `LOCK_MISSING` and `LOCK_CONFIG_MISMATCH`: the author runs `bowerloom lock update` and commits the lock.
      - `STORE_REMOTE_PRIVATE`: link to `#my-store-is-private`.
      - `LOCK_COMMIT_GONE`, from beta3/10a: the author runs `bowerloom lock update`, commits, and pushes.
      - `STORE_ITEM_GONE_AT_COMMIT` and `LOCK_HASH_MISMATCH`: run `bowerloom lock verify`, then ask the author to run `bowerloom lock update`.
      - `GITHUB_RATE_LIMITED`: wait, or set a token.
      - A plain `apply` holds an item with `SKILLS_OFFLINE`: run `bowerloom apply --frozen`.
      - The entry links to `/docs/guides/item-sources/#teammate-steps`.
    - The entry `## A clone refuses PROJECT_UNSAFE or PROJECT_FOLDER_UNSAFE`. It names the four codes of page section 6, fact 2, in the order Bowerloom checks them. It gives the fix: `umask 022` before `git clone`, or `chmod -R go-w .` in the project. It links to `/docs/guides/item-sources/#check-modes`.
30. `apps/docs/tools/check-brand.mjs:14`. Add `'guides/item-sources'` to `userPages`.
31. `apps/docs/package.json:13`. The `test` script becomes `node ../../tools/run-node-tests.mjs tools/content.test.mjs tools/docs-codes.test.mjs`.
32. `guides/context-slices.md:155`. The line becomes `bowerloom folder add knowledge-base ~/notes/knowledge-base`. The old line names a private folder.
33. `guides/context-slices.md:87`. Replace "Older versions ignore `onFailure`" with "Claude Code before 2.1.295 ignores `onFailure`", so the page uses one form, as line 77 does.

Do not edit the release status block in `releases.md` or the support block in `status.md`. `tools/sync-release.mjs` owns those blocks, and `npm run check:release` must pass. Do not edit `cli.md:35`, `status.md:8`, or the tarball name in `start.md:42` (decision 3).

### 3.3 The release notes

The `## 0.7.0-beta.3` section of `apps/docs/src/content/docs/releases.md` is a flat list today (`releases.md:18-48`). Regroup it under these seven bold labels, in this order. Each label is a line by itself, in the form `**New commands**`, with a blank line after it and the list below it: **New commands**, **Projects and the store**, **Sharing**, **Agents and context slices**, **Install**, **Changed formats**, **Known limits**. There is no **Fixes** label (decision 4).

Move each existing line under its label. Keep each line's text unless a row below changes it.

- New commands: `use` and `unuse`, `lock verify` and `lock update`, `team adopt`, `store migrate` and `receipt clean`, `cache list` and `cache prune`.
- Projects and the store: the `bowerloom.json` line, the config-only project line, the marker and store line, the `--global` line.
- Sharing: the lock line, the `--frozen` line, the private store line.
- Agents and context slices: the lines of specs 01a and 05, except the lines that the list below moves.
- Install: the tarball line of spec 02.
- Changed formats: the format line, and the two lines that say a 0.7.0-beta.2 CLI cannot read a project with slices or agent catalogs.
- Known limits: the guard version line (`releases.md:28`), the Codex agents line, the `revise` line (`releases.md:39`). The guard line becomes: "The read guard needs Claude Code 2.1.295 or later. Before 2.1.295, a guard that cannot start, crashes, or runs longer than 10 seconds lets the call through. It runs only in a folder that you trusted." The hook sets `timeout` 10 and `onFailure` `block` (`packages/managed-skills/src/agent-copy.ts:49`). The trust condition is in `guides/context-slices.md:88`. In the `revise` line, drop the words "Known limit:", because the label says it.
- The folder add line (`releases.md:31`) holds a semicolon. Split it into two sentences: "... runs in it." and "`folder deny` takes the grant back."

Add these lines. Write each in the repository's simple English.

Projects and the store:

- The project folder, `bowerloom.json`, and `bowerloom.lock.json` must be yours and closed to group and other writes. Otherwise Bowerloom refuses with `PROJECT_FOLDER_UNSAFE`, `CONFIG_UNSAFE`, or `LOCK_UNSAFE`. A clone made under `umask 002` refuses until you run `chmod -R go-w .`.
- `bowerloom store status` shows the `Git:` line of the store, the commands that fix a store with no remote, and the `GitHub token:` line. Its JSON format is `bowerloom/store-status/v1beta1`.
- `bowerloom status` prints a `Config:` line, one of seven `Lock:` states, and the notes for a stale lock and for a shared project with no lock.
- `bowerloom up` reads `bowerloom.json`. A team that the file does not list refuses `TEAM_NOT_SELECTED`. On a clone, `up` works for a listed team.
- From beta3/10a: the store keeps a `.gitignore` that ignores `folders/`. If git tracks that folder, `store status` warns.

Sharing:

- A project is shared in two cases. It has `bowerloom.lock.json`, or its git repository has a remote named `origin`. If Bowerloom cannot read one of those files, it treats the project as shared and says so.
- `apply` and `skills sync` take `--max-github-requests <n>`, up to 5000. One run makes at most 1000 GitHub requests by default. A larger run refuses `GITHUB_REQUEST_BUDGET`.
- `use`, `lock update`, and `store migrate` take `--commit <sha>` to record a chosen pushed commit of the store remote.
- Bowerloom holds some store skills and prompts fetched from the lock with `ITEM_REVIEW_REQUIRED`, until a plan shows them. Those are the items that set `allowed-tools`, register hooks, or run shell lines.
- Plain `apply` never fetches. It holds a lock item that this machine lacks with `SKILLS_OFFLINE`. `skills sync` and `up` fetch lock items into the store cache.
- From beta3/10a: `team adopt` also takes a store team that `bowerloom.json` does not list yet.
- From beta3/10a: a locked commit that is gone from GitHub refuses `LOCK_COMMIT_GONE`.
- "The new page [Where your items come from](/docs/guides/item-sources/) explains where each item's bytes come from, what the lock records, and what a teammate needs."

Agents and context slices:

- The package has a second command, `bowerloom-guard`. Claude Code runs it as the read guard.

Changed formats. Replace the existing format line with lines that name every format new since beta.2. This set is the format strings in `packages/*/src` and `apps/cli/src` at cc8187e that are not in c9730d3. Test D8 checks it against the code. Write one bullet for each group below, in this order:

- Files: `bowerloom/project/v1beta1`, `bowerloom/lock/v1beta1`, `bowerloom/store/v1beta1`, `bowerloom/context-slice/v1beta1`, `bowerloom/store-folder/v1beta1`, and `bowerloom/store-folder-grant/v1beta1`.
- Reports: `bowerloom/store-status/v1beta1`, `bowerloom/ls/v1beta2`, `bowerloom/project-status/v1beta2`, `bowerloom/skills-manifest-check/v1beta2`, and `bowerloom/lock-verify/v1beta1`.
- More reports: `bowerloom/cache-list/v1beta1`, `bowerloom/folder-list/v1beta1`, `bowerloom/context-slice-show/v1beta1`, and `bowerloom/context-measure/v1beta1`.
- Plans and results of skills and apply: `bowerloom/skills-manifest-change/v1beta2`, `bowerloom/skills-sync-plan/v1beta2`, `bowerloom/skills-sync-result/v1beta2`, `bowerloom/project-apply-plan/v1beta2`, and `bowerloom/project-apply-result/v1beta2`.
- Plans and results of create, use, and the lock: `bowerloom/authoring-plan/v1beta2`, `bowerloom/config-change-plan/v1beta1`, `bowerloom/config-change-result/v1beta1`, `bowerloom/lock-update-plan/v1beta1`, and `bowerloom/lock-update-result/v1beta1`.
- Plans and results of adopt and migrate: `bowerloom/team-adopt-plan/v1beta1`, `bowerloom/team-adopt-result/v1beta1`, `bowerloom/store-migrate-plan/v1beta1`, and `bowerloom/store-migrate-result/v1beta1`.
- Plans and results of clean and prune: `bowerloom/receipt-clean-plan/v1beta1`, `bowerloom/receipt-clean-result/v1beta1`, `bowerloom/cache-prune-plan/v1beta1`, and `bowerloom/cache-prune-result/v1beta1`.
- Plans of registered folders: `bowerloom/folder-add-plan/v1beta1`, `bowerloom/folder-allow-plan/v1beta1`, `bowerloom/folder-deny-plan/v1beta1`, and `bowerloom/folder-remove-plan/v1beta1`.
- Then the line: "Scripts that read `format` must accept the new names."

Known limits:

- The store must be on github.com in this beta.
- A store team projects no agents. Moving a team with agents to the store stops the projection of its agents.
- Codex gets neither agents nor context slices in this beta. (Replace the existing Codex agents line with this one.)
- Store items hold only text files within the size limits, so a store item cannot share a script.
- A lock names at most 8 store remotes.
- A store whose git uses reftable or SHA-256, or whose `.git` files the group can write, counts as unreadable.
- Bowerloom reads the store's local git refs and never runs `git fetch`.
- A rewritten or deleted store branch, or a store repository made private, breaks your teammates' frozen installs. `LOCK_COMMIT_GONE` names the first case.
- `cache prune --unreferenced` checks only this project and your store.
- This beta was tested on macOS with Node 24.11.0 only, the delete steps of `cache prune` included.

### 3.4 The errors reference

`apps/docs/src/content/docs/reference/errors.md` keeps its merged headings (decision 1). It holds one table row for every refusal code in `codes` (4.2). The rows of specs 03 to 09 are there. Section 3.2.2 adds the two `AUTHORING_*` rows and changes the `GITHUB_REQUEST_BUDGET` and `LOCK_LIMIT` cells. From beta3/10a: the `LOCK_COMMIT_GONE` row sits in `## Lock refusals`. Check it against the merged code.

### 3.5 Examples come from code

The examples on the page must be valid. Do not type them by hand.

1. Write `tests/support/docs-examples.ts`. It exports `configExample(): string` and `lockExample(): string`. It builds each value with the real serializers: `serializeConfig` and `serializeLock` from `packages/project-config`. The lock fixture uses the real `revisionOf` to compute `hash`, and fixed 40-hex ids for `commit` and `tree`. The remote is `https://github.com/example-org/example-store`. The pin is a complete entry that `validateEntry` accepts, with `teams: ["research"]`. Build it from an existing `packages/skill-manifest/test` fixture and add the teams. No existing fixture pins `tanstack-db` with that team.
2. `tests/docs-examples.test.ts` reads the page and extracts each fenced `json` block that follows a line `<!-- example: config -->` or `<!-- example: lock -->`. It requires the block to equal the helper's output byte for byte. These two markers are the only comments in the page.
3. The page shows the `store status` fix commands as literal lines (page section 7, fact 6). Test E7 checks the case `none` by running the CLI, and the other cases against `apps/cli/src/store.ts:139-142`.
4. The same test checks that each `bowerloom ...` command in the page's `text` fences starts with a command word from the `COMMANDS` set in `apps/cli/src/main.ts:131`. `COMMANDS` is not exported. Read it from the source with the regex `const COMMANDS = new Set\(\[([^\]]*)\]\)`.

### 3.6 Checks that gate the docs

Run these in `apps/docs` before the pull request. All must pass.

1. `npm run build`. It throws on `/Users/` or `file://` in a page (`src/lib/content.mjs:84`).
2. `npm run check:links` (fragments, assets, no private paths, home links, duplicate ids)
3. `npm run check:exports` (Markdown and HTML parity, `llms.txt`, `llms-full.txt`)
4. `npm run check:release`
5. `npm test` (includes the new `docs-codes.test.mjs`)
6. `node tools/check-brand.mjs`
7. In the repository root: `node tools/run-node-tests.mjs apps/landing/test/*.test.mjs`, then `npm run typecheck` and `npm test`. The root `npm test` runs `dist/tests/*.test.js`, so `tests/docs-examples.test.ts` runs with no change to the glob.

### 3.7 Coverage of specs 01a to 09 and 10a

- Spec 01a: `guides/agents.md` (order 7.8), `cli.md` `## Apply`, `status.md`, `harnesses.md`, `errors.md`, and `releases.md`. Check only.
- Spec 02: `releases.md`, plus the `start.md:42` sentence of 3.2.2.
- Spec 05: `guides/context-slices.md` (order 7.9), `cli.md` `## Context` and `## Registered folders`, `security.md`, `status.md`, `harnesses.md`, `guides/index.md`, and `errors.md` `## Context slice refusals`. Check only, except the `status.md:48`, `cli.md:177`, and `guides/context-slices.md:87` and `:155` corrections.
- Specs 03 to 09: this page, the check-only list of 3.2.1, and the edits of 3.2.2.
- Track 10a: page sections 2, 5, 7, 8a, 9, 10, and 13, `troubleshooting.md`, and `releases.md`.

### 3.8 Decision-dependent text

- #80 comment 6334887017 (`ITEM_REVIEW_REQUIRED`, variant A built, no default): page sections 6, 9, and 13. Under variant B, replace the hold text with: "Bowerloom trusts a store item fetched from the lock as your team's own store content."
- #80 comment 6334068412 (first screen, default B): the page names `bowerloom help store` as the entry point. Test E6 does not depend on `SECTIONS`.
- #86 decisions 1 (A), 2 (default B), and 3 (A, no default): the guard sentence of page section 6, and the guide of spec 05.
- #84 comment 6333898175 (license gate, A): a release line only.
- #84 comment 6334655034 (agent grants, A built, no default): `guides/agents.md` and the `--allow-agent` flag.
- Spec 08 `MIGRATE_TEAM_MISSING` (A) and spec 09 prune outside a project (A): page section 12 and the cache paragraph.

## 4. Schemas

### 4.1 Page front matter

The keys are `title`, `description`, `section`, and `order`. Values are in 3.1. No other key.

### 4.2 The docs-codes lists

Add `apps/docs/tools/beta2-refusal-codes.json`. It holds the sorted keys matched by the line regex `^  ([A-Z][A-Z0-9_]+): \{` in `git show c9730d3:apps/cli/src/human.ts`. That baseline holds the `GATE_REFUSALS` keys (`APPROVAL_REQUIRED`, `WORKERS_HELD`), so they never count as new.

`apps/docs/tools/docs-codes.test.mjs` builds `codes` from the source, not by hand. Take the text of `apps/cli/src/human.ts` from the line that starts `const REFUSALS` to the line that starts `const GATE_REFUSALS`. Match each line with the regex above. `codes` is those keys minus the baseline. At cc8187e that is 93 codes.

`tests/docs-examples.test.ts` adds a second source: every code in `CONFIG_REFUSAL_CODES`, `SYNC_REFUSAL_CODES`, `AUTHORING_REFUSAL_CODES`, and `MANIFEST_REFUSAL_CODES` that is not in the baseline. Import them as `tests/human-refusal.test.ts:7-11` does. These lists alone miss codes that other packages raise, such as `PROJECT_FOLDER_UNSAFE`, `STORE_*`, and `GITHUB_TOKEN_INVALID`. So the `REFUSALS` block stays the main source.

Add `apps/docs/tools/beta2-formats.json`. It holds the sorted format strings that match `'bowerloom/[a-z-]+/v1(alpha|beta)[0-9]+'` in `packages/*/src` and `apps/cli/src` at c9730d3.

Call `pageCodes` the fixed list in 5.1.

## 5. Refusal codes

### 5.1 Codes the page explains (the page list)

- Store: `STORE_NOT_FOUND`, `STORE_INVALID`, `STORE_UNSAFE`, `STORE_IN_CLOUD_FOLDER`, `STORE_UNREADABLE`, `STORE_LOCKED`, `STORE_STATE_NESTED`, `STORE_NOT_A_PROJECT`, `STORE_WRITE_FAILED`.
- Store items: `STORE_ITEM_NOT_FOUND`, `STORE_ITEM_MISSING`, `STORE_ITEM_NOT_SHAREABLE`, `STORE_ITEM_GONE_AT_COMMIT`, `SKILLS_ADD_EXISTS`, `SKILLS_ADD_SOURCE_CHANGED`.
- GitHub and the store remote: `STORE_REMOTE_PRIVATE`, `STORE_REMOTE_AUTH_FAILED`, `GITHUB_TOKEN_INVALID`, `GITHUB_TOKEN_SSO_REQUIRED`, `GITHUB_RATE_LIMITED`, `GITHUB_REQUEST_FAILED`, `GITHUB_REQUEST_BUDGET`.
- Project and config: `PROJECT_FOLDER_UNSAFE`, `PROJECT_UNSAFE`, `CONFIG_INVALID`, `CONFIG_UNSAFE`, `CONFIG_UNREADABLE`, `CONFIG_LIMIT`, `CONFIG_DUPLICATE_ID`.
- Config items: `CONFIG_ITEM_SELECTED`, `CONFIG_ITEM_NOT_SELECTED`, `CONFIG_ITEM_MISSING`, `CONFIG_WRITE_UNCONFIRMED`, `TEAM_NOT_SELECTED`.
- Lock: `LOCK_MISSING`, `LOCK_INVALID`, `LOCK_UNSAFE`, `LOCK_LIMIT`, `LOCK_CONFIG_MISSING`, `LOCK_CONFIG_MISMATCH`, `LOCK_WRITE_UNCONFIRMED`, `LOCK_HASH_MISMATCH`, `LOCK_STORE_NOT_PUSHED`, `LOCK_COMMIT_UNREACHABLE`, `LOCK_COMMIT_GONE` (from beta3/10a).
- Install and sync: `SKILLS_OFFLINE`, `SKILLS_SYNC_CONTENT_MISMATCH`, `SKILLS_SYNC_INTERRUPTED`, `STALE_APPROVAL`, `ITEM_REVIEW_REQUIRED`, `SLICE_ROOT_MISSING`, `FOLDER_NOT_ALLOWED`, `AGENT_TARGET_OCCUPIED`.
- Migrate and cache: `MIGRATE_ID_EXISTS`, `MIGRATE_ITEM_NOT_FOUND`, `MIGRATE_ITEM_UNSUPPORTED`, `MIGRATE_RESERVED`, `MIGRATE_TEAM_MISSING`, `MIGRATE_LIMIT`, `CACHE_ENTRY_NOT_FOUND`, `CACHE_ENTRY_BUSY`, `CACHE_PRUNE_FAILED`.

### 5.2 Codes the errors reference holds

Every code in `codes` (4.2). This spec adds no new code. `LOCK_COMMIT_GONE` comes from track 10a, which adds its sentence, next step, and errors row (README rule 4).

## 6. Where to change

Create:

- `apps/docs/src/content/docs/guides/item-sources.md` (3.1).
- `apps/docs/tools/docs-codes.test.mjs`, `apps/docs/tools/beta2-refusal-codes.json`, and `apps/docs/tools/beta2-formats.json` (section 10, 4.2).
- `tests/support/docs-examples.ts` and `tests/docs-examples.test.ts` (3.5).

Change: every file in the table of 3.2.2, plus `apps/docs/src/content/docs/releases.md` (3.3) and `apps/docs/src/content/docs/reference/errors.md` (3.4).

Do not change any file under `packages/` or `apps/cli/`. If the page cannot say something true because the code differs from the spec, stop and write the difference in the pull request. Do not change the code in this track.

## 7. Edge cases

| Case | Expected result |
|---|---|
| The page links to `#private-store` and the anchor is missing | `check:links` fails with `missing fragment`. Add the anchor line. |
| An anchor id equals a generated heading id | `check:links` fails with `duplicate ID`, because `html-ids.mjs` counts both. The ids in 3.1 differ from the generated ids. |
| A snippet holds `/Users/...` or `file://` | The build throws (`content.mjs:84`). Use `~` or a placeholder. |
| A code example is not valid JSON | `docs-examples.test.ts` fails. |
| A refusal code in `codes` is missing from `errors.md` | `docs-codes.test.mjs` fails and names the code. |
| A page code is missing from the page | `docs-codes.test.mjs` fails and names the code. |
| A cell of the page's refusal table differs from `errors.md` | Test D6 fails and names the code. Copy the `errors.md` cell. |
| The page mentions a command that does not exist | `docs-examples.test.ts` fails. |
| `releases.md` release block is edited | `check:release` fails. Undo the edit. |
| `README.md` names 0.7.0-beta.3 | `check:release` fails with `RELEASE_VERSION_DRIFT`. Remove the version. |
| Order 7.75 is already used | Use 7.76 and record it in the pull request. |
| The built page differs between HTML and Markdown | `check:exports` fails. Fix the Markdown source. |
| A reader opens the page from search | The page title and description show. Both are in the front matter. |
| A sentence uses a banned word | Test D10 fails, or the simple-English check flags it. Rewrite it, or move a code string into inline code. |
| Track 10a has not merged | Tests D4, E13, and the `LOCK_COMMIT_GONE` row fail. Wait for the merge. Do not document a fix that the code lacks. |
| Track 10a merged with other strings | The tests read the merged strings. Copy them, and record the difference in the pull request. |
| A clone made under `umask 002` | The page and `troubleshooting.md` give the fix. The builder runs the check of 12, item 9. |
| A new format string lands after cc8187e | Test D8 fails and names it. Add it to the Changed formats line. |

## 8. Migration from beta.2 projects

The page serves beta.2 readers. Section 12 of the page tells them what changes and what stays. `releases.md` lists the changed formats. The `status.md`, `cli.md`, `configuration.md`, and `add-skills.md` edits remove the statements that stop being true: the project marker, public-only skills, the single skills cache, the clone and the project brief, and slices for Codex.

## 9. Docs changes for this track

This spec is the docs track. Sections 3.1 to 3.8 list every change.

## 10. Acceptance tests

`apps/docs/tools/docs-codes.test.mjs` (run by `npm test` in `apps/docs`). It reads files only.

- D1. The page file exists, with the exact front matter of 3.1.
- D2. The page's `##` headings, in order, equal the table of 3.1. Each heading line is preceded by its anchor line and exactly one blank line, in the form `<a id="<id>"></a>`.
- D3. Each `###` heading of 3.1 sits under its `##` parent, with its anchor line and one blank line above it.
- D4. Every code in 5.1 appears in the page text inside backticks.
- D5. Every code in `codes` (4.2) appears in `errors.md` in a table row that matches `^\| \`<CODE>\` \|`. The test names each missing code.
- D6. The page's refusal table holds exactly the codes of 5.1, under the eight bold labels of section 13, in their order. For each row, the second and third cells equal the second and third cells of the first `errors.md` row for that code.
- D7. `releases.md` holds a `## 0.7.0-beta.3` section with the seven bold labels of 3.3, in that order, each on a line by itself. The section holds no `**Fixes**` line.
- D8. Every format string in `packages/*/src` and `apps/cli/src` that is not in `beta2-formats.json` appears in the `## 0.7.0-beta.3` section of `releases.md`.
- D9. The `private-store` section of the page holds these phrases: `api.github.com`, `never stores`, `never prints`, `refuses redirects`, `Credentials:`, `--approve`. It names each of `apply --frozen`, `skills sync`, `use`, `lock update`, and `store migrate`, and holds the phrase "sync step of `up`".
- D10. Outside fenced blocks, inline code spans, and the lines between the `item-source-refusals` anchor and the next anchor, the page has no semicolon. It uses none of the words `can`, `could`, `may`, `might`, `should`, `would` (whole words, any case).
- D11. The page does not contain `Fearless` or `Advanced Metrics`.
- D12. The line of `cli.md` that starts "These commands work in a project folder." holds `bowerloom.json`.
- D13. `add-skills.md` holds "without credentials" and "/docs/guides/item-sources/#private-store", and links `/docs/guides/item-sources/` in its `## Share a project` section. It no longer holds "Private registries and private repositories are not supported in this beta." or "Private registries and private repositories are not supported."
- D14. `guides/index.md` links to `/docs/guides/item-sources/`.
- D15. `check-brand.mjs` lists `guides/item-sources`.
- D16. `guides/agents.md` and `guides/context-slices.md` exist with the front matter of spec 01a section 9 and spec 05 section 9.
- D17. `status.md` and `cli.md` each hold "Codex agents are not projected in this beta. Context slices are projected for Claude Code only." Neither holds "Codex agents and context slices are not projected".
- D18. `guides/context-slices.md` holds these five strings:
  - the heading "What the guard does not stop"
  - the phrase "not a security boundary"
  - "cannot prove answer quality" (line 148)
  - "cannot prove what an agent actually reads"
  - "cannot prove that Claude's tokenizer agrees"
- D19. `guides/agents.md` holds "`bowerloom revise` refuses while `.bowerloom/teams/first-team/agents` exists. Move the folder out, revise, then move it back." (line 137).
- D20. `start.md` and `releases.md` each hold "The file carries its dependencies, so it installs with no network and no npm cache."
- D21. The public-sources sentence:
  - No page under `apps/docs/src/content/docs` holds "reads skills only from public sources". Neither does `README.md`.
  - Each of the 12 pages of 3.2.2, item 6, holds "This beta reads pinned skills only from public sources."
  - `README.md` holds "Pinned skills come from public sources only."
- D22. The What to commit table of `configuration.md` holds rows for `bowerloom.json`, `bowerloom.lock.json`, `.bowerloom/slices/`, and `.claude/agents/`. Neither `configuration.md` nor `add-skills.md` holds "`bowerloom up --team <name>` and `team create` refuse with `PROJECT_BRIEF_INVALID`". `errors.md` no longer holds "`bowerloom up --team` and `team create` refuse this way".
- D23. `troubleshooting.md` holds the headings `## My teammate cannot install my store items` and `## A clone refuses PROJECT_UNSAFE or PROJECT_FOLDER_UNSAFE`. Each section links to `/docs/guides/item-sources/`.
- D24. In `errors.md`, the `GITHUB_REQUEST_BUDGET` row holds `--max-github-requests`, and the `LOCK_LIMIT` row holds "126 files".
- D25. `cli.md` names each key of `TOPICS` (the lines of `human.ts` that match `^  ([a-z]+): \[`) and `init` in its help sentence. It holds a `## Store and lock` heading whose section links to `/docs/guides/item-sources/`. Its `skills sync` paragraph holds `--frozen` and `--max-github-requests`. Its token paragraph names `store migrate`.
- D26. The page's `### What to commit` section names `bowerloom.json`, `bowerloom.lock.json`, `.bowerloom/authoring/receipt.json`, and `.claude/agents`. Its `### Before you run` section names `PROJECT_FOLDER_UNSAFE`, `PROJECT_UNSAFE`, `CONFIG_UNSAFE`, `LOCK_UNSAFE`, `umask 022`, and `chmod -R go-w .`.
- D27. `concepts/teams-and-files.md` and `guides/create-items.md` link to or name the store as 3.2.2 says: the first links `/docs/guides/item-sources/`, and the second holds "or inside your store with `--global`".
- D28. The page holds the five lines of `### The sharing model in five lines` exactly, inline code aside. Line 3 is two sentences, and line 4 says "before you lock an item you wrote".
- D29. No page under `apps/docs/src/content/docs`, and not `README.md`, holds the private path forms `Sage\ Advice`, `~/Sage Advice`, or `/Sage Advice/`. (`README.md:342` names the maker, "Made by Sage Advice.", which is not a path.)

`tests/docs-examples.test.ts` (run by the root `npm test`). It imports the code.

- E1. The config example on the page equals `configExample()`.
- E2. The lock example on the page equals `lockExample()`.
- E3. `parseConfig` and `parseLock` accept the two examples, and `lockAgrees` is true for the pair.
- E4. The helper fixture's lock `hash` equals `revisionOf(files)`.
- E5. Every `bowerloom <word>` command in a `text` fence of the page starts with a word of `COMMANDS` (3.5, item 4).
- E6. The commands of `cli.md`:
  - Take `COMMANDS` without `help`, `--help`, `-h`, `--version`, and `-V`.
  - In the code fences of `cli.md`, a first word of the form `a|b|c` counts as each of its parts. An example is `bowerloom status|review|cancel` at `cli.md:399`.
  - Every remaining word then appears as `bowerloom <word>`.
  - Read the `Usage:` lines of seven topics: `TOPICS.store`, `use`, `unuse`, `lock`, `cache`, `receipt`, and `context`.
  - Each of those lines, trimmed of its leading spaces, appears verbatim as a line in `cli.md`.
- E7. The `store status` output:
  - Under an isolated `HOME` (`tests/support/isolate-home.ts`), create the store with the built CLI. Run `skill create probe --global`, then approve its revision. The store then has no `.git`.
  - Spawn `store status`. The output has no `GitHub token:` line.
  - Take each line after `  To fix this, run these commands yourself:`, up to the last line. Trim its four-space indent. It appears as a line in a `text` fence of the page.
  - The last line is `  A private repository needs BOWERLOOM_GITHUB_TOKEN on each machine that fetches.` The page holds it, trimmed.
  - The page shows the fix lines of three more cases: `no-origin`, `unsupported-remote`, and `unpushed` (page section 7, fact 6).
  - Each of those lines appears in `apps/cli/src/store.ts` as a string in single quotes or backticks, with `${b}` for `<branch>`.
- E8. `STORE_ITEM_NOT_SHAREABLE`: for each of the seven causes, `notShareable(cause).message` minus its fixed first sentence appears in the page. Each line of `renderRefusal('STORE_ITEM_NOT_SHAREABLE', notShareable('none').message)` appears in the page. The prefix `Bowerloom could not read .git and treats this project as shared`, from `honestShared(notShareable('none'), '.git').message`, appears in the page with `<x>` for `.git`.
- E9. Plan strings, by import. Each appears in the page:
  - `NETWORK_LINE(7777, 8888)` with `<n>` for 7777 and `<r>` for 8888, and `NO_TOKEN_LINE` (`change.ts:170-171`).
  - `STALE_NOTE(['<ids>'])` and `SHARED_NO_LOCK_NOTE` (`resolve.ts:74-75`).
  - `offlineHold('skill', 'x').next` (`plan.ts:521`).
  - The `Next:` text of `renderRefusal('ITEM_REVIEW_REQUIRED', '')` (`human.ts:474`).
  - `TOKEN_TAIL`, and the first line of `credentialsLines` for a `Credentials` value whose `repositories` is `['<owner>/<repo>']` (`sync.ts:70-77`, `store-git.ts:46`).
  - `TOKEN_STALE_NOTE` (`store-git.ts:59`).
  - `unknownSharedNote('<x>')` (`shared.ts:147`).
  - `requestLine({ requests: 7777, maxRequests: 8888 })[0]` with `<r>` and `<max>`.
  - `FROZEN_LINE` and the unpushed-HEAD warning are not exported. Read `FROZEN_LINE` from `plan.ts` with the regex `const FROZEN_LINE = '([^']+)';`. Read the warning from `change.ts:185` by its prefix `Your store has commits that are not pushed (HEAD differs from origin/`. Both appear in the page, the warning with `<branch>` and `<commit8>`.
- E10. The flags on the page:
  - Read each flag that the page gives for `use`, `lock`, `apply`, `store`, `cache`, `receipt`, and `skills sync`.
  - Each flag appears in the `TOPICS` text of that command.
- E11. Request counts: `requestCount([{ local: { distinct: 1 } }])` is 5. `4 + STORE_FILE_LIMITS.files` is 130. `GITHUB_REQUEST_LIMIT` is 1000 and `GITHUB_REQUEST_MAX` is 5000. The page holds "A prompt takes 5.", "One item takes at most 130.", "1000", and "5000".
- E12. Every code of the four exported code lists (4.2) that is not in the baseline has an `errors.md` row.
- E13. From beta3/10a: `LOCK_COMMIT_GONE` has a `REFUSALS` entry. Its message, read from the code, is `The locked commit is no longer on GitHub.`, and the page holds it. The `LOCK_COMMIT_GONE` row of `errors.md` and the page row match (D6).
- E14. From beta3/10a: read the `folders/` warning string from the merged `apps/cli/src/store.ts`. It appears on the page.

The build checks of 3.6 pass. Rule 1 (20 words) and the simple-English check are manual review. The reviewer reads the page for them.

## 11. Build order

1. Wait for track 10a to merge into `release/0.7.0-beta.3`. Read the `TOPICS` and `REFUSALS` text from the merged code, and the strings of the three fixes.
2. Write `tests/support/docs-examples.ts` and `tests/docs-examples.test.ts`. They fail until the page exists.
3. Write `docs-codes.test.mjs`, `beta2-refusal-codes.json`, and `beta2-formats.json`. They fail until the pages exist.
4. Write the page, section by section, following 3.1.
5. Make the edits of 3.2.2, 3.3, and 3.4. Read each row of 3.2.1 against the code.
6. Run the checks of 3.6 and fix each failure.
7. Run the manual check of section 12, item 9.
8. Ask for the independent review. The reviewer reads the page against the code, not against the spec.

## 12. Unverified items

1. The simple-English hook. The lint hook can flag a rule that this spec does not list. Fix every flag it reports. If it flags a sentence that holds a required fact, shorten the sentence and keep the fact.
2. Settled: `check:exports` and the page's `text` fences. The copy prompt fires only on the headings "Ask your agent" and "Agent procedure" (`content.mjs:30-40`). Text fences are safe.
3. The `order` value 7.75 and the sidebar. Pages sort by `order` within `section`. If the page sorts into the wrong place, check `src/lib/content.mjs` for the sort and use the value it needs.
4. Settled: the `<a id>` anchor style. Other pages use `<a id="installed-security-acceptance"></a>` before a heading (`security.md:52`). Copy that exact style.
5. Settled: the root `README.md` gets one line changed (decision 2), and must name no version but the release version (`tools/sync-release.mjs:17-20`).
6. The strings of track 10a. This spec quotes them from the decision. The merged code wins.
7. Settled: the order of the frozen refusals. `frozen.test.mjs:33-54` pins no order. Page section 9 takes the order of `resolve.ts:158-182`.
8. `FROZEN_LINE` (`plan.ts:520`), the `FIX` table (`apps/cli/src/store.ts:138-144`), and the unpushed-HEAD warning (`change.ts:185`) are not exported. The tests read them from the source text. If a later change exports them, import them instead.
9. The `umask 002` fix. The code reading says that a clone under `umask 002` refuses with the four codes of page section 6, fact 2, and that `chmod -R go-w .` clears them. Nobody ran it. Before the pull request, run it in a temporary folder: `umask 002`, clone a project that holds `.bowerloom`, `bowerloom.json`, and `bowerloom.lock.json`, run `bowerloom status`, then `chmod -R go-w .`, and run it again. Record both outputs in the pull request, and the first code that appears. The code reading says that is `PROJECT_UNSAFE`. If another code appears, add it to the page and to `troubleshooting.md`. Do the same for a store `.git` under `umask 002` and `chmod -R go-w ~/.bowerloom/.git` (page section 7, fact 8).
