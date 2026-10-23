---
title: "Where your items come from"
description: "See where each skill, prompt, and team comes from, what bowerloom.lock.json records, and what a teammate needs."
section: "Guides"
order: 7.75
---

<a id="page-questions"></a>

## What this page answers

This page answers four questions:

- [Where do the bytes of each item come from?](#four-kinds-of-item)
- [What does `bowerloom.lock.json` record?](#config-and-lock)
- [What does a teammate need?](#teammate-steps)
- [What is the result for a store with no remote?](#store-has-no-remote)

If you share a project that uses the store, read this page. If you wonder where an installed file came from, read it too.

The page covers Bowerloom 0.7.0-beta.3 and later. A project without `bowerloom.json` keeps working, and beta.3 changes a few things for it. [Move a project to the store](#move-to-store) lists them.

<a id="sharing-model"></a>

### The sharing model in five lines

1. Your store, `~/.bowerloom`, stays on your machine. No teammate reads it.
2. A shared project has `bowerloom.lock.json`, or sits in a git repository with a remote named `origin`.
3. In a shared project, the lock records each store item. A teammate fetches each item you wrote from the GitHub copy of your store.
4. So push the store to GitHub before you lock an item you wrote, and never rewrite or delete that branch afterward.

   A pin in the lock comes from npm or from its own GitHub repository, never from your store. Bowerloom reads the store repository only for the items you wrote. So a store that holds only pins needs no remote.
5. Commit `bowerloom.json` and `bowerloom.lock.json`. A teammate runs `bowerloom apply --frozen`.

A teammate needs these things:

- the project
- network access to `api.github.com` and `registry.npmjs.org`
- Bowerloom 0.7.0-beta.3 or later
- a project folder that only they write in, as [Before you run](#check-modes) explains
- for a store in a private repository, a token, as [A store in a private repository](#private-store) explains
- enough GitHub requests: GitHub allows about 60 requests an hour without a token, and [GitHub request limits](#rate-limit) says what that means

Run `bowerloom help store` for the store, store migrate, receipt clean, and cache commands. Run `bowerloom help use` and `bowerloom help lock` for the rest.

<a id="four-kinds-of-item"></a>

## Four places an item comes from

A project selects three kinds of item:

- A skill is a folder of instructions. An agent loads it for a task that needs it.
- A prompt is one Markdown file that a person or an agent runs as a command.
- A team is a set of roles that work toward one goal. A folder with `team.yaml` defines it, and its `agents/` folder holds its agents.

Bowerloom puts copies of skills and prompts in `.claude` and `.agents`. The agents of a team become copies in `.claude/agents` for Claude Code. That happens only for a team that the project defines and `bowerloom.json` lists. A store team projects no agents in this beta. `bowerloom team adopt` copies a team, its agents included, into the project. Codex agents are not projected in this beta. Context slices are projected for Claude Code only. A context slice is a project item only. It never sits in the store or in the lock. See [Project agents for Claude Code](/docs/guides/agents/) and [Context slices for agents](/docs/guides/context-slices/).

| Kind of item | Where it is defined | Where its bytes come from | In the lock |
| --- | --- | --- | --- |
| A pinned skill, from npm or GitHub, in a project | `.bowerloom/skills.json` | The skills cache of this machine, filled from the registry or GitHub at the exact pin | No |
| A skill, prompt, or team that you wrote in a project | `.bowerloom/` in the repository | The repository | No |
| A pinned skill, from npm or GitHub, in the store | `~/.bowerloom/skills.json` | The skills cache of this machine, filled the same way | Yes. The lock holds the whole pin. |
| A skill, prompt, or team that you wrote in the store | `~/.bowerloom/` on your machine | On your machine, the store itself. On another machine, the GitHub copy of your store, public or reached with a token, fetched into the store cache | Yes. The lock holds the remote, the commit, the path, and a hash. |

The lock never records project items. Git versions them.

The store is the folder `~/.bowerloom` on your machine. It holds definitions, and no cache and no installed copy. If you make it a git repository, it also holds `.git`. It also holds `folders/`, the records of registered folders. The store keeps its own `.gitignore`, which keeps `folders/` and other files of this machine out of git. `bowerloom store status` shows the store, as the [CLI reference](/docs/cli/#project-commands) explains.

A pin is an exact npm version or a full GitHub commit, with the hashes of the files.

Bowerloom keeps two caches:

- The skills cache keeps the bytes of each pinned skill, once for every project on the machine.
- The store cache keeps the store items that Bowerloom fetched from the GitHub copy of a store.

Both caches live in the private state folder, outside your projects and outside the store. The store cache is the folder `store-cache` in that state folder. `bowerloom cache prune` deletes cache entries after you approve a plan. Outside a project, `cache prune --unreferenced` checks your store only. Other projects on this machine are not checked. See [Cache](/docs/cli/#cache).

<a id="config-and-lock"></a>

## The two files

`bowerloom.json` says what the project wants. `bowerloom.lock.json` says what resolved. Commit both.

This `bowerloom.json` lists three skills, one prompt, and two teams:

<!-- example: config -->

```json
{
  "format": "bowerloom/project/v1beta1",
  "harnesses": [
    "claude",
    "codex"
  ],
  "skills": [
    {
      "id": "house-style",
      "source": "store"
    },
    {
      "id": "local-tool",
      "source": "project"
    },
    {
      "id": "tanstack-db",
      "source": "store",
      "via": [
        "research"
      ]
    }
  ],
  "prompts": [
    {
      "id": "weekly-update",
      "source": "store"
    }
  ],
  "teams": [
    {
      "id": "first-team",
      "source": "project"
    },
    {
      "id": "research",
      "source": "store"
    }
  ]
}
```

Read it line by line:

- `format` names the version of the file format.
- `harnesses` names the tools that get copies: `claude` for Claude Code and `codex` for Codex.
- `id` names the item.
- `source` says where the item is defined: `store` for your store, or `project` for `.bowerloom` in this project.
- `via` names the store team that picked the item. It appears only on a store entry. Here the team `research` picked the skill `tanstack-db`.

This `bowerloom.lock.json` records the four store entries of that file:

<!-- example: lock -->

```json
{
  "format": "bowerloom/lock/v1beta1",
  "skills": [
    {
      "id": "house-style",
      "from": "store",
      "authored": {
        "remote": "https://github.com/example-org/example-store",
        "commit": "1f3a5c7e9b2d4f6a8c0e1f3a5c7e9b2d4f6a8c0e",
        "path": "skills/house-style",
        "tree": "2b4d6f8a0c1e3b5d7f9a2b4d6f8a0c1e3b5d7f9a",
        "files": [
          {
            "path": "SKILL.md",
            "sha256": "0e2b9128b3ca4540ca0074f4355a10026bc9088d02e37b874fbd106b9a1ee1ee",
            "bytes": 123
          }
        ],
        "hash": "67caff1ce2c00c6a72b456b9ea81a6cbed8da1b5f2286032b87883566f6ab680"
      }
    },
    {
      "id": "tanstack-db",
      "from": "store",
      "pin": {
        "id": "tanstack-db",
        "teams": [
          "research"
        ],
        "source": {
          "kind": "npm",
          "registry": "https://registry.npmjs.org",
          "package": "@synthetic/db-skills",
          "version": "0.0.1",
          "integrity": "sha512-WEulm6u0xlv6OJAWm8DFfNlA2syTcgEcxyECodQoOJk6/uEGm52rLqlgGJ9kXkA3/9JL8azzjQnefCumP6dVxQ==",
          "metadataSha256": "8272960d9c74dcf2eab552cbdc6aea2a948bf26efbd4d95a89ceb7c4fd2cb095",
          "publisher": "synthetic-publisher"
        },
        "skill": {
          "name": "synthetic-db-collections",
          "sourceRoot": "skills/synthetic-db/collections"
        },
        "license": {
          "spdx": "MIT",
          "files": [
            "LICENSE"
          ]
        },
        "files": [
          {
            "path": "LICENSE",
            "sourcePath": "LICENSE",
            "sha256": "f47b3adc7ebff1b708c1f2cbfb74d9a0dd2bf91f1794ec232a532d39b4c0f4cb",
            "bytes": 481
          },
          {
            "path": "SKILL.md",
            "sourcePath": "skills/synthetic-db/collections/SKILL.md",
            "sha256": "89b882f6829a2fb778b540bba6e02ee24f97255c84634e9f58017e8894209054",
            "bytes": 249
          },
          {
            "path": "references/local-collections.md",
            "sourcePath": "skills/synthetic-db/collections/references/local-collections.md",
            "sha256": "cdf3722d89c8b806c946d412cec92dc266bf3f9113cdb5eaa6fad554e813c29c",
            "bytes": 47
          },
          {
            "path": "references/sync-modes.md",
            "sourcePath": "skills/synthetic-db/collections/references/sync-modes.md",
            "sha256": "143cdcb3ad6522f3f13ca87e5faf5ea20fc1c7745f6592c9f53a09509256d22a",
            "bytes": 63
          }
        ],
        "references": [
          {
            "from": "SKILL.md",
            "to": "references/local-collections.md"
          },
          {
            "from": "SKILL.md",
            "to": "references/sync-modes.md"
          },
          {
            "from": "references/sync-modes.md",
            "to": "references/local-collections.md"
          }
        ]
      }
    }
  ],
  "prompts": [
    {
      "id": "weekly-update",
      "from": "store",
      "authored": {
        "remote": "https://github.com/example-org/example-store",
        "commit": "1f3a5c7e9b2d4f6a8c0e1f3a5c7e9b2d4f6a8c0e",
        "path": "prompts/weekly-update.md",
        "tree": "3c5e7a9b1d2f4c6e8a0b3c5e7a9b1d2f4c6e8a0b",
        "files": [
          {
            "path": "weekly-update.md",
            "sha256": "6bead5b3fdda8d4dc2d0c53c7724f1ae3947ba73dd228b0653a92d2f36570525",
            "bytes": 71
          }
        ],
        "hash": "b29e56dd68e0316aea230dcaa046cd26f324b39e6891dc5cf34926563d301df6"
      }
    }
  ],
  "teams": [
    {
      "id": "research",
      "from": "store",
      "authored": {
        "remote": "https://github.com/example-org/example-store",
        "commit": "1f3a5c7e9b2d4f6a8c0e1f3a5c7e9b2d4f6a8c0e",
        "path": "teams/research",
        "tree": "4d6f8b0c2e3a5d7f9b1c4d6f8b0c2e3a5d7f9b1c",
        "files": [
          {
            "path": "agents/researcher.md",
            "sha256": "c35e88af253ddd6f41b1ea02ac798ed57feae9f82e963c9010bab772e55fd18a",
            "bytes": 46
          },
          {
            "path": "team.yaml",
            "sha256": "9a926f2439b1fc198aec9998ba9fec04872ab2bfd2f278c8ae7fcbb52521d718",
            "bytes": 15
          }
        ],
        "hash": "de4d28cf3ef27b6d0fa0301f14019517ef739d40378b8a856bd8af898856d928"
      }
    }
  ]
}
```

Read one item of each kind:

- Every item carries `id` and `from: "store"`.
- The pinned skill `tanstack-db` carries `pin`, the whole entry of `skills.json`, `teams` included. Its `teams` is `["research"]`, so the config lists it with `via: ["research"]`. The example pins a test package.
- A written item carries `authored`, with `remote`, `commit`, `path`, `tree`, `files`, and `hash`. `remote` and `commit` name the GitHub copy of the store. `path` is the place of the item in the store. `files` lists each file with its sha256 and size.
- If the store entry of a written skill or prompt names teams, its lock item carries `teams` too. A team never carries `teams`.
- `hash` proves that the bytes a teammate fetches are the bytes you locked.

A `pin` in the lock is an entry of `skills.json`. Its content key comes from the entry, so one pin downloads once on a machine.

The two files must agree: the lock lists exactly the store items that the config lists. `bowerloom lock verify` checks that. If they differ, `apply --frozen` refuses.

Bowerloom writes one `.gitignore` of its own in a project, inside `.bowerloom/managed`. It ignores nothing else. It does not ignore `.claude/skills`, `.claude/commands`, `.agents/skills`, or `.claude/agents`. The project items in `.bowerloom` are files you commit. [What to commit](#commit-list) lists who commits what. A project with only `bowerloom.json` has no `.bowerloom` until its first install or create.

<a id="work-alone"></a>

## If you work alone

A project that only you use needs no lock and no remote. Run these commands in order:

```text
bowerloom skill create house-style --global
bowerloom use skill house-style
bowerloom skills sync
bowerloom apply
```

- `skill create house-style --global` creates the skill in your store.
- `use skill house-style` lists the skill in `bowerloom.json`.
- `skills sync` installs the skill into `.bowerloom/managed`, `.claude/skills`, and `.agents/skills`.
- `apply` puts prompts and agents in place, and any skill copy that is still missing.

A project is shared in two cases. Either `bowerloom.lock.json` exists, or the project sits in a git repository with a remote named `origin`. Any remote on any host counts, a private repository that only you use included. [If you share a project](#share-a-project) gives the full rule.

If your project is not shared, `use` writes no lock and makes no network call.

The folder must already be a project. In a new folder, run `bowerloom up --team <name> --goal <goal>` first.

In a terminal, each command asks `Apply plan <short revision>? [y/N]`. Without a terminal, or with `--json`, it prints the plan and exits 3. Then run it again with `--approve <revision>`.

If you add a remote later and `bowerloom.json` lists a store item, the project becomes shared with no lock. `bowerloom status` then shows `Lock: absent` and this note:

```text
This project is shared but has no bowerloom.lock.json. Run bowerloom lock update.
```

A config with no store item shows `Lock: not-used`. Run `bowerloom lock update` and commit the lock.

<a id="share-a-project"></a>

## If you share a project

Bowerloom treats a project as shared in these cases:

- `bowerloom.lock.json` exists in the project folder, even an empty one. Bowerloom checks the lock first.
- Or the project folder is in a git work tree whose config has a `[remote "origin"]` section with a `url` line. A remote section with no `url` line does not count.
- Any `origin` on any host counts. A private repository that only you use counts too.
- Bowerloom walks up from the project folder to the first folder with a `.git` entry. It stops at your home folder and at `/`, and never looks inside them. So a git repository at `~` does not make a project shared.
- It follows a worktree and a submodule to their git folder.
- If it fails to read the lock, `.git`, or `.git/config`, it treats the project as shared. The plans and `status` then print `could not read <x>; treating this project as shared`. A refusal that this caused starts `Bowerloom could not read <x> and treats this project as shared`.
- Bowerloom reads files and starts no process.
- A project with a lock stays shared until you delete the file. `use` creates a lock only in a shared project whose config lists a store item. It keeps an existing lock up to date, even an empty one.

In a shared project, `use` checks that a teammate is able to fetch each store item. A pinned npm or GitHub skill is always fetchable.

The author takes these steps, in order:

```text
1. Give the store a remote. Use the commands that bowerloom store status prints.
2. bowerloom use skill house-style
3. Commit bowerloom.json and bowerloom.lock.json, and push the project.
```

[When the store has no remote](#store-has-no-remote) shows the commands of step 1.

In a shared project, `use` does this, in order. It reads the store. It finds the pushed commit of the store. It asks `api.github.com` for that commit. It compares the bytes with your store. It writes the config. It writes the lock.

If HEAD is ahead of the pushed commit, `use` prints this warning:

```text
Your store has commits that are not pushed (HEAD differs from origin/<branch>). The lock records the pushed commit <commit8>.
```

Bowerloom reads the local refs of the store. It never runs `git fetch`. So `origin/<branch>` is what your last push or fetch left.

Bowerloom talks only to `api.github.com` here. The plan names the host, and Bowerloom fetches nothing that the plan did not name.

The store must be on GitHub in this beta, in a repository whose `origin` is a `github.com` address. Other hosts refuse with `STORE_ITEM_NOT_SHAREABLE`.

In a shared project, each plan names each store item that the config asks for, in this form:

```text
skill house-style comes from your store; this project asks for it
```

<a id="commit-list"></a>

### What to commit

- The author commits `bowerloom.json` and `bowerloom.lock.json`.
- The author commits the project items in `.bowerloom`: `skills.json`, `skills/`, `prompts/`, `teams/` with the `agents/` folder of each team, `slices/`, and `.bowerloom/authoring/receipt.json`. The receipt matters. Apply skips a slice file that the receipt does not register.
- The author pushes the store to its own GitHub repository. The store never goes into the project repository.
- Nobody commits `.bowerloom/managed`, the copies in `.claude/skills`, `.claude/commands`, and `.agents/skills`, or the setup files that stay on one machine. [What to commit](/docs/guides/add-skills/#what-to-commit) gives the exact `.gitignore` lines.
- If an agent has the read guard, keep `.claude/agents` out of git. A guarded copy names the project folder of your machine.
- The store keeps its own `.gitignore`, which keeps `folders/` out of the store repository.

<a id="teammate-steps"></a>

## What a teammate does

A teammate needs the project and network access to `api.github.com` and `registry.npmjs.org`. A teammate does not need your store. A teammate needs Bowerloom 0.7.0-beta.3 or later.

<a id="check-modes"></a>

### Before you run

A clone made under `umask 002` gets folders and files that the group is able to write. Bowerloom refuses them. `PROJECT_UNSAFE` applied in beta.2 too. The other three codes are new in beta.3. Bowerloom checks `.bowerloom` first, then `bowerloom.json`, then the folder. So a clone sees one code at a time:

- `PROJECT_UNSAFE` for a `.bowerloom` folder that the group or others write in.
- `CONFIG_UNSAFE` for a `bowerloom.json` that the group or others write in.
- `PROJECT_FOLDER_UNSAFE` for a project folder that is not yours, or that the group or others write in.
- `LOCK_UNSAFE` for a `bowerloom.lock.json` that the group or others write in. `bowerloom status` shows it as `Lock: invalid (LOCK_UNSAFE)`. `bowerloom lock verify` and `bowerloom apply --frozen` refuse with it.

The fix: run `umask 022` before `git clone`. In a clone you already have, run `chmod -R go-w .` in the project folder. Git records no write bits, so the change shows no diff.

```text
umask 022
git clone <project>
```

```text
cd <project>
chmod -R go-w .
```

Then take these steps, in this order:

```text
git clone <project>
cd <project>
bowerloom apply --frozen
Read the plan.
bowerloom apply --frozen --approve <revision>
```

The plan shows a written store skill that this machine has not fetched yet like this:

```text
install skill: <places> (not on this machine yet; Bowerloom shows what it can do after the fetch)
```

Some fetched skills and prompts set `allowed-tools`, register hooks, or run shell lines. If the approved plan did not show that, apply installs nothing of such an item. It holds the item with `ITEM_REVIEW_REQUIRED`. The `Next:` line names the command that shows the item, in the form `Run <command> again to review it.` The command is `bowerloom apply --frozen`, `bowerloom skills sync`, or `bowerloom skills sync --frozen`. For example:

```text
Run bowerloom apply --frozen again to review it.
```

For an item from the lock, the plan shows the tag `[store, from the lock: github.com/<owner>/<repo>]`. It also shows the line `Frozen: installing only what bowerloom.lock.json records.` and a `Network:` line with the hosts. With a token, a `Credentials:` line comes before the `Network:` line. Read the `Credentials:` and `Network:` lines before you approve.

`--frozen` does this, in order. It reads the config and the lock. When they disagree, it refuses. It ignores any store on the machine. It fetches what the machine does not hold, project pins included. It checks every byte against its pin or the lock. It installs.

Afterward the teammate has the same files you installed, byte for byte.

If `bowerloom.json` lists the team, `bowerloom up --team <name>` also installs on a fresh clone, through its sync step. It is not strict. If the store of the machine defines the same id, plain `apply`, `skills sync`, and `up` use the live store. A lock that differs only produces a note. That holds for the own store of a teammate too: their store wins over your lock. Use `bowerloom apply --frozen` to get exactly the locked bytes.

If the config lists a store item and the lock is missing, `apply --frozen` refuses with `LOCK_MISSING`. Its next step is `bowerloom lock update on a machine with the store.` See [Refusals](#item-source-refusals).

Bowerloom keeps the fetched store items in the store cache, so a second run needs no network. After `bowerloom cache prune`, plain `apply` holds such an item with `SKILLS_OFFLINE`. Its next step is `Run bowerloom apply --frozen, or bowerloom skills sync.`

A slice whose root is a registered folder needs two steps on each machine. Folder records stay on the machine that made them. First run `bowerloom folder add <folder-name> <path>`, with the same name. Then run `bowerloom folder allow <folder-name>` in the project. Without the record, apply holds the slice with `SLICE_ROOT_MISSING`. Without the grant, it holds the slice with `FOLDER_NOT_ALLOWED`. The folder must be yours, below your home folder, outside iCloud folders, and closed to other users.

An agent copy with the read guard names the project folder of your machine. If the project commits `.claude/agents`, apply on the machine of a teammate holds that agent with `AGENT_TARGET_OCCUPIED`. Keep `.claude/agents` out of git.

<a id="store-has-no-remote"></a>

## When the store has no remote

In a shared project, a store item must be fetchable by your team. Otherwise Bowerloom refuses with `STORE_ITEM_NOT_SHAREABLE` and adds the cause:

- `none`: `The store is not a git repository.`
- `no-origin`: `The store repository has no remote named origin.`
- `unsupported-remote`: `The store remote is not a github.com repository.`
- `unreadable`: `Bowerloom cannot read the git files of the store.`
- `unpushed`: `The store has no pushed commit for this branch.`
- `file`: `The item holds a file that a lock cannot record.`
- `size`: `The item is larger than a lock can record.`

A lock records only these files: names that end in `.md`, `.txt`, `.json`, `.yaml`, `.yml`, or `.csv`, and `LICENSE` and `NOTICE` files. Each file is not empty, is UTF-8 with no byte order mark, and has no execute bit. An item holds at most 126 files, 65536 bytes in a file, and 2 MiB in all. So a store item never carries a script.

A store whose git uses a `reftable` folder or `objectFormat = sha256` is `unreadable`. So is a store whose `.git` holds a file that the group or others write in. A store made under `umask 002` has such files. A detached HEAD without `--commit` is `unpushed`.

In a project that is not shared, nothing is wrong. The project works on your machine.

In a shared project, `use` refuses. For the cause `none`, a terminal shows:

```text
Refused (STORE_ITEM_NOT_SHAREABLE): This project is shared, and a teammate cannot fetch this store item. The store is not a git repository.
A shared project needs every store item to be fetchable by your team.
Next: Give the store a remote and push it. bowerloom store status shows the commands. Or adopt a team into this project with bowerloom team adopt.
```

`bowerloom store status` shows the state of the git repository of the store. Every git state ends with this line:

```text
A private repository needs BOWERLOOM_GITHUB_TOKEN on each machine that fetches.
```

If the store has a GitHub remote, a `GitHub token:` line follows the `Git:` line. That holds for a ready store and for `unpushed`. For `unreadable`, `store status` prints no commands.

For each other case, `store status` prints the commands that fix it. The output indents them by four spaces. Bowerloom never runs them. Run them yourself.

If the store is not a git repository, `store status` prints:

```text
cd ~/.bowerloom
git init
git add -A
git rm -r -q --cached --ignore-unmatch folders
git commit -m "Store"
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin <branch>
```

The `git rm` line keeps `folders/` out of the first commit. It works with no `.gitignore` in the store too. If the store has no branch yet, the output prints `<branch>`. That is the case for `none`.

If the store repository has no remote named `origin`, `store status` prints:

```text
cd ~/.bowerloom
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin <branch>
```

If the remote is not on github.com, `store status` prints:

```text
cd ~/.bowerloom
git remote set-url origin https://github.com/<owner>/<repo>.git
```

If the store has no pushed commit for this branch, `store status` prints:

```text
cd ~/.bowerloom
git push -u origin <branch>
```

If the `.gitignore` of the store misses lines, `store status` warns. Its commands then add a `printf` line right after `cd ~/.bowerloom`, which appends the missing lines. If the `.gitignore` is a link, or not a plain file that you own, a line before the commands names it. Fix that file first.

`store status` also checks whether git tracks `folders/`. Folder records belong to one machine. These are its warnings:

```text
Warning: ~/.bowerloom/.gitignore misses lines that keep this machine's files, folders/ among them, out of git.
Warning: folders/ is tracked by git. In ~/.bowerloom, run git rm -r --cached folders and commit. Records already pushed stay in git history.
Warning: Bowerloom could not read the store's git index, so it cannot tell whether folders/ is tracked. Run git -C ~/.bowerloom ls-files folders.
Warning: ~/.bowerloom is inside another git repository, so Bowerloom cannot tell whether folders/ is tracked. Run git -C ~/.bowerloom ls-files folders.
```

Before you run `git add -A` in the store, finish or clear any interrupted `--global` create.

If your umask is 002, set `umask 022` in your shell profile. Then run `chmod -R go-w ~/.bowerloom/.git`. Otherwise each new git file makes the store `unreadable` again.

<a id="unpushed-cases"></a>

### Every case of an unpushed store item

| Case | Result |
| --- | --- |
| The project is not shared. | It works on your machine. `use` writes no lock and makes no network call. |
| The project is shared, and the store has one of the first five causes above. | `STORE_ITEM_NOT_SHAREABLE` with that cause. |
| The project is shared, and the item holds a `.DS_Store` or another file that a lock does not record. | `STORE_ITEM_NOT_SHAREABLE` with the cause `file`, before any network call. |
| The project is shared, and the item is too large. | `STORE_ITEM_NOT_SHAREABLE` with the cause `size`, before any network call. |
| The project is shared and the store is pushed, but the item is new, or edited and not pushed. Uncommitted edits count. | `LOCK_STORE_NOT_PUSHED`. |
| The project is shared and the store is pushed, but a git-ignored `.md` file, `core.autocrlf`, or a git filter makes the pushed bytes differ. | `LOCK_STORE_NOT_PUSHED`. |
| The project is shared, HEAD is ahead of `origin/<branch>`, and the item is unchanged. | The warning of [If you share a project](#share-a-project). The lock records the pushed commit. |
| You run `store migrate` in a shared project with an unpushed store. | It copies the item to the store and does not switch it. The plan prints `Not switched: <kind> <id> cannot be locked yet.` |
| You edit a store item after you lock it. | Your plain commands install your unpushed bytes, with the note that the lock is out of date. The frozen install of a teammate gets the locked bytes. |
| Bowerloom fails to read a file, and only that makes the project shared. | The refusal starts `Bowerloom could not read <x> and treats this project as shared`. |

These are the ways out:

1. Give the store a remote on github.com, and push it.
2. For a team, run `bowerloom team adopt <id>`. This works for a store team that `bowerloom.json` does not list yet. One approved plan copies the team into the project and lists it as a project item. Store skills and prompts that name the team stay store entries. They still need a pushed store, and the plan names them.
3. For a skill or a prompt, read the config first. If it lists the item, run `bowerloom unuse <kind> <id>`. Then run `bowerloom <kind> create <id>`. Then copy the files from `~/.bowerloom` into the new project item yourself.
4. For a skill, pin a published copy in the store under a new id: `bowerloom skills add <source> --id <new-id> --global`. Then run `bowerloom use skill <new-id>`. If the config lists the old id, run `bowerloom unuse skill <id>` first. The same id refuses. `skills add` without `--replace` refuses with `SKILLS_ADD_EXISTS`. With `--replace` over a skill you wrote, it refuses with `SKILLS_ADD_SOURCE_CHANGED`.

<a id="private-store"></a>

## A store in a private repository

Without a token, Bowerloom sends no credentials. A private repository answers 404, and Bowerloom refuses with `STORE_REMOTE_PRIVATE`.

To use a private store, set `BOWERLOOM_GITHUB_TOKEN` to a GitHub token with read access to the store repository. Use a fine-grained token, limited to that one repository. A classic token needs the `repo` scope, which grants write access to every private repository. [My store is private](/docs/troubleshooting/#my-store-is-private) shows how to set the variable and keep the token out of your shell history.

Bowerloom makes these promises:

- Bowerloom sends the token to one host, `api.github.com`.
- It sends it only for the repository of your store remote, or the repositories that the lock names for its store items. In a clone, the lock names them. A lock names at most 8 store remotes.
- Each plan that uses the token shows a `Credentials:` line that names those repositories.
- It never stores the token. It never prints it. It never writes it to a plan, a lock, a receipt, a log, or any other file.
- It refuses redirects.
- In a project you did not write, read the `Credentials:` line before you approve. The token goes to each repository the lock names.
- Do not script `--approve` in a loop. A script that approves every plan also approves a repository it never saw.

The `Credentials:` line and the end of the `Network:` line look like this:

```text
Credentials: BOWERLOOM_GITHUB_TOKEN is set. It is sent to api.github.com for github.com/<owner>/<repo> only.
Store items use your GitHub token for the repositories above.
```

These commands read the variable:

- `apply --frozen`
- `skills sync`
- the sync step of `up`
- `use`
- `lock update`
- `store migrate`

Each reads it only for a store item that needs the store repository. `store status` only reports whether it is set, not set, or set but not valid. Plain `apply` never reads it. `team adopt` never reads it, and it makes no network call.

`skills add` and pinned skills stay anonymous. They send no token.

If GitHub refuses, Bowerloom names the reason:

- `GITHUB_TOKEN_INVALID`: the variable holds something that is not a token. Set it again, as [My store is private](/docs/troubleshooting/#my-store-is-private) shows.
- `STORE_REMOTE_AUTH_FAILED`: GitHub refused the token. Check that the token reads the store repository, and that the repository name is right.
- `GITHUB_TOKEN_SSO_REQUIRED`: the organization uses single sign-on. Authorize the token for that organization on GitHub.

A teammate sets the same variable on their machine.

If you make a plan with the token set, then approve it without the token, it refuses with `STALE_APPROVAL`. The reverse refuses too. The plan says why, with this note:

```text
Setting or removing BOWERLOOM_GITHUB_TOKEN between the plan and --approve also changes the plan.
```

A malformed variable refuses with `GITHUB_TOKEN_INVALID` in every command that reads it, for a public store too.

See [The GitHub token for a private store](/docs/security/#the-github-token-for-a-private-store).

<a id="rate-limit"></a>

## GitHub request limits

GitHub allows about 60 requests an hour without a token, and about 5,000 with one.

A skill or team takes 4 requests plus 1 for each file with different content. A prompt takes 5. One item takes at most 130.

These commands spend requests. `use`, `lock update`, and `store migrate` check a written item against its pushed copy. `apply --frozen`, `skills sync`, and the sync step of `up` fetch a written item that this machine lacks. `lock update` skips an unchanged item. A cached item costs nothing.

`apply` and `skills sync` take `--max-github-requests <n>`, a whole number from 1 to 5000. The default is 1000. `use`, `lock update`, and `store migrate` have a fixed budget of 1000. A run over its budget refuses with `GITHUB_REQUEST_BUDGET`.

During a fetch, GitHub answers 404 for a locked commit that it does not show. Then Bowerloom makes one more request, to the repository itself. That request counts in the budget. It tells a removed commit from a private repository. A refused token gets no such request.

A plan that checks written items prints these lines:

```text
Network: reads api.github.com, to check the pushed copy of <n> items, about <r> requests to api.github.com.
Without a token GitHub allows about 60 requests an hour. Set BOWERLOOM_GITHUB_TOKEN, or run the command again after an hour to finish.
```

If the count is over 60 and no token is set, the second line prints. Otherwise it does not. With a token, the `Network:` line ends with `Store items use your GitHub token for the repositories above.`, and a `Credentials:` line comes before it.

The frozen and sync plans print a `Network:` line of their own. It names the hosts and the number of items to fetch. For public sources it reads:

```text
Network: reads <hosts> for <n> items, public and without credentials. Bytes must match their pins or bowerloom.lock.json.
```

The request line is a second line:

```text
GitHub requests: at most <r>, of the <max> this run allows.
```

The sync and apply plans print it in two cases: the run makes requests, or you set the limit. Over the limit, the line ends with `Run it with --max-github-requests <r> or more.`

With `BOWERLOOM_GITHUB_TOKEN` set, store items count against the limit of 5,000, for a public store too. Pinned GitHub skills never send the token, so they stay at 60.

If GitHub stops you, Bowerloom refuses with `GITHUB_RATE_LIMITED`. Wait until the limit resets, at most an hour, or set a token. The items fetched before the stop stay in the store cache.

<a id="frozen-and-plain"></a>

## Frozen installs and plain apply

| Command | Reads the store | Reads the lock | Fetches | Network |
| --- | --- | --- | --- | --- |
| `apply` | Yes, for store items | Yes, for items the store lacks | Never | None |
| `apply --frozen` | No | Yes | What this machine lacks, project pins included | The hosts in the plan |
| `skills sync` | Yes | Yes, for items the store lacks | Pins and lock items that this machine lacks | `registry.npmjs.org` and `api.github.com`, as the plan names |
| `skills sync --frozen` | No | Yes | What this machine lacks | As the plan names. With `--offline`, none |
| `up --team <name>` | Its sync step works as `skills sync` | Its apply step works as `apply` | As `skills sync` | As `skills sync` |

`apply` has no `--offline` flag.

Plain `apply` never fetches. It holds an item from the lock that this machine lacks with `SKILLS_OFFLINE`. Its next step is `Run bowerloom apply --frozen, or bowerloom skills sync.`

A frozen install works like `npm ci`: it installs exactly what the lock records, or it stops.

A frozen run refuses before the plan in the order Bowerloom checks:

1. The project checks: the `PROJECT_*` codes, among them `PROJECT_FOLDER_UNSAFE` and `PROJECT_UNSAFE`, and `CONFIG_UNSAFE` and `CONFIG_UNREADABLE`.
2. `bowerloom.json`: if it is missing, `LOCK_CONFIG_MISSING`, even with no lock. So a beta.2 project without `bowerloom.json` does not run `--frozen`. If the file does not parse, its own code: `CONFIG_INVALID`, `CONFIG_LIMIT`, or `CONFIG_DUPLICATE_ID`.
3. `bowerloom.lock.json`: `LOCK_UNSAFE`, `LOCK_LIMIT`, or `LOCK_INVALID`.
4. `LOCK_MISSING`. It applies only to a config that lists a store item.
5. `LOCK_CONFIG_MISMATCH`.

The [refusal table](#item-source-refusals) gives the `Next:` step of each code.

Files that disagree stop a frozen run before any network call or write.

After the plan, a frozen run refuses with one of these, in no fixed order:

- `STORE_ITEM_GONE_AT_COMMIT`
- `LOCK_COMMIT_GONE`
- `STORE_REMOTE_PRIVATE` and `STORE_REMOTE_AUTH_FAILED`
- `GITHUB_TOKEN_INVALID` and `GITHUB_TOKEN_SSO_REQUIRED`
- `GITHUB_RATE_LIMITED`, `GITHUB_REQUEST_FAILED`, and `GITHUB_REQUEST_BUDGET`
- `LOCK_HASH_MISMATCH` and `SKILLS_SYNC_CONTENT_MISMATCH`
- `SKILLS_OFFLINE` and `SKILLS_SYNC_INTERRUPTED`
- `STALE_APPROVAL`. A token set or removed between the plan and `--approve` also causes it.
- the hold `ITEM_REVIEW_REQUIRED`

`skills sync --frozen --offline` is allowed. A fetch that it needs refuses with `SKILLS_OFFLINE`.

<a id="item-changes"></a>

## Change an item

To edit a store item, change it in the store and lock the new commit:

```text
1. Edit the files in ~/.bowerloom.
2. Commit and push the store.
3. Run bowerloom lock update in each project.
4. Commit the lock.
5. Teammates run bowerloom apply --frozen.
```

A project without a lock needs only `bowerloom skills sync` and `bowerloom apply`.

To replace a pinned store skill, add the new pin and update the lock:

```text
1. bowerloom skills add <source> --id <id> --replace --global
2. bowerloom lock update
```

To stop using an item, drop it from the config:

```text
1. bowerloom unuse skill <id>
2. Delete the copies in .claude/skills and .agents/skills yourself, if you want them gone.
```

The copies stay until you delete them.

To pick a team and its items, use the team:

```text
1. bowerloom use team <id>
```

`use team` also picks the store skills and prompts that name that team. Each one carries `via` with the team id, so `unuse team` drops it too.

To copy a store team into the project, adopt it:

```text
1. bowerloom team adopt <id>
```

The project then owns the copy. The team need not be listed first.

When the lock is out of date, the sync and apply plans print:

```text
The lock is out of date for <ids>. Run bowerloom lock update.
```

`bowerloom status --json` then reports `config.lock.state` as `stale`. `bowerloom status` prints one of seven `Lock:` states: `not-used`, `valid`, `stale`, `mismatch`, `invalid`, `absent`, and `orphan`.

When a store item changes, the next plan shows an update tagged `[store]`. Nothing is written until you approve.

When an item leaves the store, a normal run installs it from the lock when the lock holds it. Without a lock item, the plan holds it with `STORE_ITEM_MISSING`.

Never rewrite or delete the store branch after you lock it. A frozen install of a teammate then fails with `LOCK_COMMIT_GONE`. Its message is `The locked commit is no longer on GitHub.` Its next step is `Ask the author of the store to run bowerloom lock update, then commit and push bowerloom.lock.json. Then pull the project.` A store repository made private, or deleted, refuses with `STORE_REMOTE_PRIVATE` without a token.

`--commit <sha>` on `use`, `lock update`, and `store migrate` records that commit of the store remote, instead of the pushed commit of the current branch. A commit that GitHub does not have refuses with `LOCK_COMMIT_UNREACHABLE`.

<a id="lock-conflicts"></a>

## Merge conflicts in the lock

Conflicts in the lock are rare. The lock holds one item per id, sorted, with no times. Two branches that add items with adjacent ids still conflict, because their lines touch.

A real conflict leaves markers in the file. Then `use`, `lock verify`, `skills sync`, and `apply` refuse with `LOCK_INVALID`. `bowerloom status` shows `Lock: invalid`.

Settle `bowerloom.json` first. Until it parses, Bowerloom reads it as `CONFIG_INVALID`.

Then settle the lock:

```text
1. For each conflicting item, keep either side.
2. Delete the markers.
3. Run bowerloom lock verify.
```

On a machine with the store, run `bowerloom lock update` without `--item` instead. It rebuilds a lock that reads as `LOCK_INVALID` from `bowerloom.json`, and it drops the old pins. With `--item`, it refuses. The plan prints:

```text
bowerloom.lock.json could not be read (LOCK_INVALID); it is rebuilt from your store. The old pins are dropped.
```

If the settled pair lists different items, `lock verify` refuses with `LOCK_CONFIG_MISMATCH`. Run `bowerloom lock update`.

`lock verify` checks in this order. First the lock file and its hashes. Then that `bowerloom.json` is there and parses. Then that the two agree. A missing lock refuses with `LOCK_MISSING`. It uses no network.

<a id="move-to-store"></a>

## Move a project to the store

This section is for a project from beta.2.

In a project that is not shared, move its items like this:

1. Run `bowerloom store migrate --all`. Read the plan, then approve it.
2. Check the result with `bowerloom ls`.
3. Run `bowerloom skills sync` and `bowerloom apply`. The copies are up to date, because the bytes are equal.
4. Delete the old files with the `git rm` lines that the command printed.
5. Remove the `skills.json` lines that the result names.
6. Run `bowerloom receipt clean`. It removes the records of the items you deleted.

A shared project needs more. After the first run, commit and push the store. `bowerloom store status` shows the commands. Then run `bowerloom store migrate --all` again, and commit `bowerloom.json` and `bowerloom.lock.json`. Until you push, `store migrate` copies the items and does not switch them.

`store migrate` never deletes a file.

`receipt clean` removes the records of created items whose files are gone. Delete the old files before you run it.

A project without `bowerloom.json` keeps working. Beta.3 changes these things for it:

- A project folder that is not yours, or that others write in, refuses with `PROJECT_FOLDER_UNSAFE`.
- `apply` copies the agents of every team, `first-team` included, to `.claude/agents` for Claude Code.
- A file named `bowerloom.json` also marks a project, and `~/.bowerloom` no longer stops project discovery.
- New JSON formats: `ls --json` is `bowerloom/ls/v1beta2`. `status --json` is `bowerloom/project-status/v1beta2`. `skills check --json` is `bowerloom/skills-manifest-check/v1beta2`. The `skills add` plan is `bowerloom/skills-manifest-change/v1beta2`. The `apply` plan and result are `bowerloom/project-apply-plan/v1beta2` and `bowerloom/project-apply-result/v1beta2`. The create plans are `bowerloom/authoring-plan/v1beta2`. The sync plan and result are `bowerloom/skills-sync-plan/v1beta2` and `bowerloom/skills-sync-result/v1beta2`.

A skill or prompt tagged to a team keeps its tag in the store. So that team must be in the store already, or move in the same run. Otherwise a named item refuses with `MIGRATE_TEAM_MISSING`, and `--all` leaves the item in the project. A store team projects no agents in this beta. So moving a team with agents to the store stops the projection of its agents.

<a id="item-source-refusals"></a>

## Refusals

These are the codes this page names. [Errors](/docs/reference/errors/) lists every code.

**Store**

| Code | What it means | What to do |
| --- | --- | --- |
| `STORE_NOT_FOUND` | There is no store yet. The first `--global` create or `skills add` makes the store. | Run `bowerloom skill create <name> --global`. |
| `STORE_INVALID` | The store folder has no usable `store.json`. If `~/.bowerloom` holds no `store.json` that Bowerloom wrote, Bowerloom does not use it and never takes over the folder. | Run `bowerloom store status`. |
| `STORE_UNSAFE` | The store must be a real folder that you own, with no write access for others and no link on its path. Your home folder must be yours or root's, and others must not be able to write in it unless it is sticky. Bowerloom does not check the folders above your home folder. | Run `ls -ld ~/.bowerloom`. |
| `STORE_IN_CLOUD_FOLDER` | The store is in a cloud-synced folder. Cloud sync changes file times and moves files, which breaks the checks that keep the store safe. | Move the home folder setup out of iCloud. The store must stay at `~/.bowerloom`. |
| `STORE_UNREADABLE` | Bowerloom cannot read the store or a folder on the way to it. A folder that cannot be read cannot be checked. | Run `ls -ld ~ ~/.bowerloom`. |
| `STORE_LOCKED` | Another Bowerloom command is changing the store. Two commands must not change the store at the same time, so nothing was changed. | When the other command is done, run this one again. |
| `STORE_STATE_NESTED` | The private state folder and the store must not be inside one another. Bowerloom keeps the cache outside the store, so a store inside the state folder, or the reverse, is refused. | Set `XDG_STATE_HOME` to a folder outside `~/.bowerloom`. |
| `STORE_NOT_A_PROJECT` | The store holds definitions only, so a folder inside it cannot be a project. | Run the command in a project folder outside `~/.bowerloom`. |
| `STORE_WRITE_FAILED` | Bowerloom failed to write to the store. The disk refused the write, and the message names the system error, such as `ENOSPC`. | Run `df -h ~ && ls -ld ~/.bowerloom`. |

**Store items**

| Code | What it means | What to do |
| --- | --- | --- |
| `STORE_ITEM_NOT_FOUND` | Bowerloom picks only items that your store defines. | `bowerloom ls --global` |
| `STORE_ITEM_MISSING` | A listed store item is not in your store and not in the lock, so Bowerloom cannot install it. | Create it with `bowerloom <kind> create <id> --global`, or run `bowerloom unuse <kind> <id>`. |
| `STORE_ITEM_NOT_SHAREABLE` | A shared project needs every store item to be fetchable by your team. | Give the store a remote and push it. `bowerloom store status` shows the commands. Or adopt a team into this project with `bowerloom team adopt`. |
| `STORE_ITEM_GONE_AT_COMMIT` | The lock names a store commit that does not hold this item, so Bowerloom cannot install it. | `bowerloom lock verify`, then ask the owner of the store to run `bowerloom lock update`. |
| `SKILLS_ADD_EXISTS` | `skills.json` already holds a skill with this id or this source. | To move that id to another version or commit, add `--replace`: `bowerloom skills add <source> --id <id> --replace`. |
| `SKILLS_ADD_SOURCE_CHANGED` | `--replace` keeps the npm package or GitHub repository and moves only its version or commit. | Add the other source under a new id. |

**GitHub and the store remote**

| Code | What it means | What to do |
| --- | --- | --- |
| `STORE_REMOTE_PRIVATE` | GitHub does not show this repository without a token. It is private, or it does not exist. | Set `BOWERLOOM_GITHUB_TOKEN` to a GitHub token that can read the repository, or make the repository public. |
| `STORE_REMOTE_AUTH_FAILED` | GitHub answers the same way for a token that cannot read the repository and for a repository that does not exist. | Check that the token can read the repository, and that the repository name is right. |
| `GITHUB_TOKEN_INVALID` | Bowerloom checks the token's shape before any network call and never shows the value. | Set it to a token with letters, digits, `_` or `-`, 20 to 255 characters. |
| `GITHUB_TOKEN_SSO_REQUIRED` | An organization that uses single sign-on refuses a token until it is authorized for that organization. | Authorize the token for the organization on GitHub, under the token's `settings`, then run the command again. |
| `GITHUB_RATE_LIMITED` | GitHub allows about 60 requests an hour without a token and about 5,000 with one. It also limits bursts of requests, and a 403 answer can say so. | Wait until the limit resets, at most an hour. Without a token, set `BOWERLOOM_GITHUB_TOKEN` to raise the limit. |
| `GITHUB_REQUEST_FAILED` | GitHub answered with an error status, so Bowerloom stopped before any change to the project. The message names the status. | Run the command again later. If the status is 401 or 403, make sure that the store repository is public. If this is your store repository, set `BOWERLOOM_GITHUB_TOKEN`. |
| `GITHUB_REQUEST_BUDGET` | A lock this large needs several runs or a smaller selection. One run makes at most 1,000 GitHub requests by default. `apply` and `skills sync` take `--max-github-requests <n>`, up to 5000. | `bowerloom lock verify` |

**Project and config**

| Code | What it means | What to do |
| --- | --- | --- |
| `PROJECT_FOLDER_UNSAFE` | The project folder is not yours, or other people can write in it. Bowerloom will not trust a project folder that other people can change. | Run `ls -ld .`. |
| `PROJECT_UNSAFE` | Bowerloom does not trust a `.bowerloom` folder that other people or links can change. | Run `ls -ld .bowerloom`. |
| `CONFIG_INVALID` | `bowerloom.json` does not match the project config format. Bowerloom reads it strictly, so a hand edit can break it. | Run `git diff bowerloom.json`. |
| `CONFIG_UNSAFE` | `bowerloom.json` must be a plain file that you own, with one link, no write access for others, and at most 1 MiB. This refusal stops every project command. | Run `ls -l bowerloom.json`. |
| `CONFIG_UNREADABLE` | Bowerloom cannot read `bowerloom.json`. A file that cannot be read cannot be checked, so Bowerloom does not use it. | Run `ls -l bowerloom.json`. |
| `CONFIG_LIMIT` | `bowerloom.json` lists too many items. This beta allows 128 skills, 128 prompts, and 32 teams at most. | Run `bowerloom status`. |
| `CONFIG_DUPLICATE_ID` | `bowerloom.json` lists a skill, prompt, or team twice. Each item is listed once, from one source. | Run `git diff bowerloom.json`. |

**Config items**

| Code | What it means | What to do |
| --- | --- | --- |
| `CONFIG_ITEM_SELECTED` | This project already picks that item from that source. | `bowerloom ls` |
| `CONFIG_ITEM_NOT_SELECTED` | Bowerloom changes only items that `bowerloom.json` lists. | `bowerloom ls` |
| `CONFIG_ITEM_MISSING` | `bowerloom.json` lists a project item that the project does not define. | `bowerloom <kind> create <id>`, or `bowerloom unuse <kind> <id>`. |
| `CONFIG_WRITE_UNCONFIRMED` | `bowerloom.json` was written, but it changed again before Bowerloom read it back. | `git diff bowerloom.json` |
| `TEAM_NOT_SELECTED` | `up` installs only the teams that `bowerloom.json` lists. | `bowerloom use team <id>` |

**Lock**

| Code | What it means | What to do |
| --- | --- | --- |
| `LOCK_MISSING` | A frozen install needs `bowerloom.lock.json`, and there is none. | `bowerloom lock update` on a machine with the store. |
| `LOCK_INVALID` | Bowerloom reads the lock strictly, so a hand edit or a merge conflict can break it. | `bowerloom lock verify`. For a merge conflict, take one side for each item, then run it. |
| `LOCK_UNSAFE` | Bowerloom will not trust a lock file that links or other users can change. | `ls -l bowerloom.lock.json` |
| `LOCK_LIMIT` | This beta keeps the lock small: 128 skills, 128 prompts, 32 teams, and 4 MiB at most. An item holds at most 126 files, 65536 bytes in a file, and 2 MiB in all. A lock names at most 8 store remotes. | `bowerloom lock verify` |
| `LOCK_CONFIG_MISSING` | A lock and a config go together, and one of them is missing. | `bowerloom use skill <id>`, or restore `bowerloom.json` from version control. |
| `LOCK_CONFIG_MISMATCH` | A frozen install must match `bowerloom.json` exactly, as `npm ci` does. | `bowerloom lock update` |
| `LOCK_WRITE_UNCONFIRMED` | `bowerloom.lock.json` was written, but it changed again before Bowerloom read it back. | `git diff bowerloom.lock.json` |
| `LOCK_HASH_MISMATCH` | Bowerloom installs only bytes that match the lock, so it stopped before any change to the project. | `bowerloom lock verify`, then ask the owner of the store to run `bowerloom lock update`. |
| `LOCK_STORE_NOT_PUSHED` | A teammate can fetch only what you pushed, and your store differs from the pushed copy. | Commit and push the store, then run the command again. |
| `LOCK_COMMIT_UNREACHABLE` | The lock needs a commit that GitHub has, and GitHub does not have this one. | Push the store, or pass `--commit <sha>` of a pushed commit. |
| `LOCK_COMMIT_GONE` | A force-push or a deleted branch removes a commit that a lock still names. GitHub shows the store repository but no longer has the locked commit. | Ask the author of the store to run `bowerloom lock update`, then commit and push `bowerloom.lock.json`. Then pull the project. |

**Install and sync**

| Code | What it means | What to do |
| --- | --- | --- |
| `SKILLS_OFFLINE` | `--offline` found a pin that needs a fetch. Nothing changed in the project. | Run `bowerloom skills sync` without `--offline`. |
| `SKILLS_SYNC_CONTENT_MISMATCH` | Fetched bytes do not match the pin. Bowerloom stopped before any change to the project. | Run `bowerloom skills check`. |
| `SKILLS_SYNC_INTERRUPTED` | Every skill it finished is complete, and the rest are untouched. | Run `bowerloom skills sync`. |
| `STALE_APPROVAL` | Current inputs or binding do not match approval. | Retain the refusal. Plan again and obtain new approval. |
| `ITEM_REVIEW_REQUIRED` | Bowerloom shows what an item can do before it installs it. | Run `bowerloom apply --frozen` again to review it. |
| `SLICE_ROOT_MISSING` | A registered folder is not recorded in your store, the store is absent, or its folder is gone. A registered folder must be recorded in your store and must exist. The slice is held back and an installed index stays. | Run `bowerloom folder list`, or register the folder with `bowerloom folder add <folder-name> <path>`, then run `bowerloom apply`. |
| `FOLDER_NOT_ALLOWED` | This project is not allowed to read registered folder `<name>`. A registered folder is shared with the projects you allow, one by one. A slice that names it is held back. If the project has no grant, `folder deny` refuses. | Run `bowerloom folder allow <folder-name>` inside the project. |
| `AGENT_TARGET_OCCUPIED` | Bowerloom never overwrites what it did not install. The agent is held back. | Move the file the `Next:` line names aside, then run `bowerloom apply`. |

**Migrate and cache**

| Code | What it means | What to do |
| --- | --- | --- |
| `MIGRATE_ID_EXISTS` | Bowerloom never overwrites a store item, so an item with the same id and other bytes cannot move. | Rename the project item, or remove the store item yourself. For a store record whose files are gone, run `bowerloom receipt clean --global`. |
| `MIGRATE_ITEM_NOT_FOUND` | `store migrate` moves only items that this project defines in `.bowerloom`, with their files in place. | `bowerloom ls` |
| `MIGRATE_ITEM_UNSUPPORTED` | A store item holds only md, txt, json, yaml, yml, csv, and license files, within the size limits. | `bowerloom help store` |
| `MIGRATE_RESERVED` | Setup made these items for this project, so they stay in it. | `bowerloom store migrate --all` skips them. |
| `MIGRATE_TEAM_MISSING` | The store keeps the team tag, so that team must be in the store. | Add `--team <name>` to move that team too. |
| `MIGRATE_LIMIT` | This beta keeps the store record small: 512 items and 1 MiB at most. | Remove items from the store, or move fewer items. |
| `CACHE_ENTRY_NOT_FOUND` | `cache prune --entry` deletes only an entry that `cache list` shows, so the text must start one of its ids. | `bowerloom cache list` |
| `CACHE_ENTRY_BUSY` | Bowerloom never deletes an entry while another command holds it. An owner lock older than a day does not count. | When the other command is done, run this one again. |
| `CACHE_PRUNE_FAILED` | Bowerloom deletes only private folders of this user, one at a time, and stops at the first one it cannot delete. | Run `bowerloom cache list`, then run the command again without `--approve`. The message names the folder, the step, and how many entries were deleted. If it gives a `chmod` line, run that first. |

<a id="words"></a>

## Words used on this page

store
: The folder `~/.bowerloom` on your machine, which holds the definitions of your skills, prompts, and teams.

project item
: A skill, prompt, or team that the project defines in `.bowerloom`, which git versions.

store item
: A skill, prompt, or team that your store defines and a project picks with `bowerloom use`.

pin
: An exact npm version or a full GitHub commit, with the hashes of the files.

lock
: The file `bowerloom.lock.json`, which records where each store item comes from and a hash of its bytes.

content key
: The name of a cache entry, made from the pin, so one pin downloads once on a machine.

remote
: The git repository on GitHub that your store pushes to, named `origin`.

frozen install
: A run of `bowerloom apply --frozen`, which installs only what the lock records.

shared project
: A project with `bowerloom.lock.json`, or in a git repository with a remote named `origin`.

cache
: The bytes Bowerloom fetched and keeps in the private state folder of this machine.

store cache
: The cache of store items fetched from the GitHub copy of a store.

config
: The file `bowerloom.json`, which says what the project installs and where each item comes from.

registered folder
: A folder outside the project that `bowerloom folder add` records, so a slice reads from it.

written item
: A skill, prompt, or team that you wrote in your store, as opposed to a pinned skill.
