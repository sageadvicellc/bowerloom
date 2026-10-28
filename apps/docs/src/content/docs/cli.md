---
title: "CLI reference"
description: "Find the beta command forms and their required scope."
section: "Reference"
order: 22
---

Use the documentation for the installed version. This reference describes the `0.7.0-beta` line.

<!-- release:status:start -->
Open beta · 0.7.0-beta.3

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads pinned skills only from public sources. A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`, as [Where your items come from](/docs/guides/item-sources/#private-store) explains. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

Workers do not start in this beta.

## Discovery

After meeting [installation requirements](/docs/start/), read:

```sh
bowerloom --version
bowerloom --help
bowerloom help <command>
bowerloom help advanced
```

`bowerloom --help` lists the commands you use first. `bowerloom help <command>` shows the full help of one command. These commands have it: `up`, `ls`, `status`, `store`, `use`, `unuse`, `lock`, and `receipt`. So do `cache`, `skills`, `apply`, `context`, `team`, `skill`, `prompt`, and `init`. `bowerloom help slice` and `bowerloom help folder` show the help of `context`. `bowerloom help advanced` lists every form, including the request-file forms and the plumbing commands below. A command followed by `--help` shows the same text as `help <command>`.

Bare `bowerloom` prints the short help. An unknown command prints `Unknown command <word>. Run bowerloom help.` The help heading reads `open beta`.

The version output reads `Bowerloom 0.7.0-beta.3`. Command syntax does not grant execution permission.

## Approvals and exit codes

Every command that changes a project shows a plan first. The plan ends with a revision, a 64-character lowercase hex value that names that exact plan.

- In a terminal, the command asks `Apply plan <short revision>? [y/N]`, plans again, and applies only if the revision is unchanged.
- With `--approve <revision>`, the command applies once and never asks. A revision that no longer matches refuses with `STALE_APPROVAL` and changes nothing.
- With `--json`, or without a terminal, the command prints the plan and its revision and exits 3. Nothing is written.
- Pass `--approve` once. There is no `--yes` and no `-y`. Either one is a usage error, exit 2, and no environment variable changes that.

| Exit code | Meaning |
| --- | --- |
| 0 | Done, or nothing to change. |
| 1 | Refused. The refusal code names the reason. |
| 2 | Usage error. The command line did not match a Bowerloom command. |
| 3 | Approval required. Read the plan, then run the same command with `--approve <revision>`. |
| 4 | Held by a gate. `up` returns 4 with `prepared, workers held`, or `prepared, N items held` with a next command for each item. |
| 130 | You stopped at the yes/no question with Ctrl-C or Ctrl-D. It prints `Stopped. Nothing was changed.` |

In a terminal, a refusal prints its code, a plain sentence, and a `Next:` line. Without a terminal, a refusal prints one line of JSON on standard error: `{"error":{"code":"...","message":"..."}}`. Agents parse that line. [Errors](/docs/reference/errors/) lists the codes.

## Project commands

These commands work in a project folder. The project is the nearest parent folder that holds `.bowerloom` or `bowerloom.json`, found the way git finds `.git`. The search stops at your home folder. A project in a cloud-synced folder refuses with `PROJECT_IN_CLOUD_FOLDER`. A home folder or a whole disk refuses with `PROJECT_ROOT_REFUSED`. So does a non-empty `~/.bowerloom` with no `store.json`, and a `bowerloom.json` in your home folder. A `~/.bowerloom` that is unsafe, a link, or has an invalid `store.json` refuses with its `STORE_*` code. A project folder that is not yours, or that others can write in, refuses with `PROJECT_FOLDER_UNSAFE`.

```text
bowerloom up --team <name> [--goal <goal>] [--name <project-name>] [--allow-agent <role>:<hash>]... [--approve <revision>] [--json]
bowerloom ls [teams|skills|prompts|slices] [--global] [--json]
bowerloom status [--json]
bowerloom store status [--json]
bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all] [--commit <sha>] [--approve <revision>] [--json]
bowerloom receipt clean [--global] [--approve <revision>] [--json]
bowerloom cache list [--json]
bowerloom cache prune [--unreferenced] [--partial] [--legacy] [--all] [--entry <id-prefix>]... [--approve <revision>] [--json]
bowerloom use skill|prompt|team <id> [--project] [--commit <sha>] [--max-github-requests <n>] [--approve <revision>] [--json]
bowerloom unuse skill|prompt|team <id> [--approve <revision>] [--json]
bowerloom lock verify [--json]
bowerloom lock update [--item <kind>:<id>]... [--commit <sha>] [--approve <revision>] [--json]
```

A project is marked by `.bowerloom`, by `bowerloom.json`, or by both. A project with only `bowerloom.json` works with every command; its first install makes a `.bowerloom` whose engine files git ignores.

`use` picks an item for this project. By default the item comes from your store, `~/.bowerloom`; `--project` picks an item this project defines in `.bowerloom` that `bowerloom.json` does not list yet. If `bowerloom.json` is missing, `use` creates it and lists the items this project defines now, with the source project. `use team <id>` also picks the store skills and prompts that name that team. In a shared project the item must be fetchable by your team, and `bowerloom.lock.json` records where. `--commit <sha>` records that commit of the store remote instead of the pushed commit of the current branch. `--max-github-requests <n>` lets one run make up to n GitHub requests, at most 5000. The default is 1000. `use` changes `bowerloom.json`, and `bowerloom.lock.json` when the project has a lock, or is shared and uses a store item. The plan names each file it changes. Run `bowerloom skills sync` and `bowerloom apply` to put the copies in place.

`unuse` removes an item from `bowerloom.json`, and from `bowerloom.lock.json` when a lock exists. It removes no copy that sync or apply already made, and the plan names where the copies stay. `unuse team <id>` also removes the items that were picked only through that team.

`lock verify` reads only. It checks `bowerloom.lock.json`, its hashes, and that it agrees with `bowerloom.json`, and it uses no network. `lock update` looks at your store again and rewrites the lock items; `--item <kind>:<id>` refreshes some. A pinned skill needs no network. A skill, prompt, or team written in the store is checked against its pushed copy on github.com. Without a token, GitHub allows about 60 requests an hour. Each item takes about 4 plus one per file. A file that a lock cannot record, such as a `.DS_Store`, refuses with `STORE_ITEM_NOT_SHAREABLE`, and the `Next:` line names it. A git-ignored file makes the check fail, and so can `core.autocrlf` or a git filter, because they change the bytes the check compares.

In plan output each item line ends with its source tag: `[project]`, `[store]`, or `[store, from the lock: ...]`.

`up` prepares the project one step at a time and starts no workers. See [Install Bowerloom](/docs/start/#prepare-a-project-with-one-command). With `--json`, each line is one JSON object, and each step plan names its `step` and `team`. `up` never edits `AGENTS.md` or `CLAUDE.md`, and it never runs `claude`, `codex`, or any other program. `up` ends at `prepared, workers held`. When a skill, prompt, agent, or team is held or gone, it ends at `prepared, N items held` and prints a next command for each item.

`ls` reads the names of teams, skills, prompts, and slices in `.bowerloom` and writes nothing. Each item shows where it comes from, `project` or `store`, in a column after its name. Names in a section are padded to the widest name of that section. A pinned skill adds `pinned:` and its pin, such as `pinned: npm @tanstack/db-skills@0.0.1:skills/tanstack-db/collections`. An empty section shows `none yet`. A link, a stray file, or a name that is not a plain id counts as `Not listed`, and `ls` never follows it. A folder with more than 256 entries refuses with `INSPECTION_LIMIT`. A project with a `bowerloom.json` shows a `Config:` line first, as `status` does.

`ls --global` lists your store, `~/.bowerloom`, from any folder, and tags every item `store`. It needs no project. With no store it prints `No store yet.` and exits 0. A project listing never mixes in store items.

With `--json`, `ls` prints one object in the format `bowerloom/ls/v1beta2`. The fields are `scope` (`project` or `store`), `listedBy` (`folders`), `teams`, `skills`, and `prompts`, `pinsReadable`, `unselected`, `unlisted`, and, for the store, `storeState` (`ready` or `absent`). Each item is an object with `id`, `source`, `via`, `locked`, `resolvedFrom`, and `state`. A team adds `displayName`. A skill adds `kind` (`local`, `npm`, or `git`) and `pin`, which is null for a local skill. `pinsReadable` is false when `skills.json` cannot be read. Then `pinsError` holds the refusal code, every skill has the state `pins-unreadable`, and you run `bowerloom skills check` (or `skills check --global`). A local skill that `skills.json` lists but whose folder is gone has the state `missing`; every other item has the state `ok`. `ls teams`, `ls skills`, and `ls prompts` print only that array, with the fixed fields. A script that reads `bowerloom/ls/v1beta1` must accept `bowerloom/ls/v1beta2`: each item is an object now, and the old `pinned` list is gone.

`status` shows the project folder, the setup state, any drift, and any skill you edited by hand. It reads only. It prints `Workers: none started (this beta starts none)`. With `--json` it prints one object, format `bowerloom/project-status/v1beta3`, with `markers`, `setup`, `status`, `revision`, `drift`, `owned`, `config`, `runtimeReady`, and `executionAuthorized`. `markers` says whether the project has a `.bowerloom` folder and a `bowerloom.json` file. `setup` is `startup` when the project has a startup receipt and `none` when it does not. `config` is null for a project with no `bowerloom.json`. Otherwise it holds the file hash and size, whether the file is valid, and the item counts. A `bowerloom.json` that does not match its format shows as the drift kind `config-invalid`. `status` names each held or missing skill, prompt, agent, or team with its next step. A deleted prompt or team is held. Run `bowerloom prompt create <id>` to restore a registered prompt that was deleted. Restore a deleted team from version control. A skill installed by an earlier Bowerloom shows as `Legacy managed skill: .bowerloom-skills`, with the migrate command.

`store status` shows your store, the folder `~/.bowerloom`. The store holds definitions of skills, prompts, and teams, and it holds no cache and no installed copy. The store is always at `~/.bowerloom`, where `~` is your `$HOME` folder, and no setting moves it. `store status` reads only. It prints `Store: none yet` when there is no store, `Store: ready` with the counts of skill folders, pinned skills, prompts, and teams when there is one, and `Store: refused (<code>)` when the folder is a link, sits in an iCloud folder, or can be changed by other users. It shows how many entries it ignored in each folder (a stray file, a link, or a name that is not a plain id), and says `or more` when a count stops at 256. A `skills`, `prompts`, or `teams` entry that is a link or not a folder refuses with `STORE_UNSAFE`. It exits 0 in each case, refusals included. A project can be marked by a file named `bowerloom.json`, with or without a `.bowerloom` folder. A folder inside the store is never a project. In a shared home folder with the sticky bit, another local user can create `~/.bowerloom` first and block store setup. Bowerloom fails closed and does not use that folder.

For a store with a git remote, `store status` adds one line after `Git:`: `GitHub token: BOWERLOOM_GITHUB_TOKEN is set`, `is not set`, or `is set but is not a valid token`. With `--json`, `git.token` is `set`, `not-set`, or `invalid`. It never prints the token or its length, and it sends nothing.

The store keeps a `.gitignore` that leaves out `folders/` and the other files of this machine. Bowerloom adds its lines when it makes the store and on each later store write, after any lines you wrote, and never removes one. Registered-folder records and grants stay on each machine: run `bowerloom folder add` on each machine that needs the folder. `store status` warns when the `.gitignore` misses lines, and its fix commands add them before `git add -A`. After `git add -A` they run `git rm -r -q --cached --ignore-unmatch folders`, so `folders/` stays out of the commit even when the `.gitignore` is missing, a link, or open to others. A `.gitignore` that is a link or not a plain file you own is named first, to fix before the commands. It warns when git already tracks something under `folders/`, and when it cannot tell: the git index is a split index or cannot be read, or the store sits inside another git repository. With `--json`, `git.gitignore` is `ok`, `update`, `create`, or `unsafe`. `git.foldersCheck` is `checked`, `no-repository`, `outer-repository`, or `unreadable`. `git.foldersTracked` is true, false, or null when Bowerloom cannot tell.

`store migrate` copies skills, prompts, and teams from this project to your store, `~/.bowerloom`. Then it lists them in `bowerloom.json` with the source `store`. It deletes nothing. It prints the `git rm` lines so you can delete the old files after you check. `--all` picks every skill, prompt, and team that `bowerloom.json` lists, except `first-team` and `personal-assistant`. If the project has no `bowerloom.json`, `--all` picks every skill, prompt, and team of the project, and the plan creates `bowerloom.json`. Naming an item with `--skill`, `--prompt`, or `--team` moves it even when `bowerloom.json` does not list it. Slices never move. A store skill or prompt holds only md, txt, json, yaml, yml, csv, and license files. Each file is UTF-8, not empty, and not executable. An item holds at most 126 files, 65536 bytes in a file, and 2 MiB in all. The store never overwrites an item: the same id with other bytes refuses `MIGRATE_ID_EXISTS`. In a shared project, a skill, prompt, or team that you wrote is switched to the store only after the store is pushed to its git remote. Until then it is copied and nothing else changes. Push the store and run the command again. `--commit <sha>` records that commit of the store remote instead of the pushed commit of the current branch. It shows the plan first. Agents pass `--approve <revision>` or `--json`. With `--json`, an item that is not switched carries `notSwitched` with `code` and `sentence`, and, when its cause has one, `next`, the step that lifts it.

`receipt clean` removes entries from the record of created items when the files of those items are gone. Run it after you delete old files, for example after `store migrate`. Then `bowerloom status` no longer names them as missing. `--global` cleans the record of your store, `~/.bowerloom`, and works from any folder. It also removes the local entry of a gone skill from `skills.json`, and the project entry from `bowerloom.json`. It deletes no file and no installed copy, and it never changes `bowerloom.lock.json`. Copies that sync or apply made stay where they are. It shows the plan first, and prints `Nothing to clean.` when no file is gone.

`bowerloom status --installation <private.json>` still reads a prepared session. See [Historical demo and session](#historical-demo).

## Store and lock

- `~/.bowerloom/store.json` marks your store.
- `bowerloom.json` lists what a project installs and where each item comes from.
- `bowerloom.lock.json` records where each store item comes from and a hash of its bytes.

[Where your items come from](/docs/guides/item-sources/) explains how they fit together.

## Cache

Bowerloom keeps the skill bytes it downloads in a cache on this machine, outside your projects and your store. The cache sits in the private state folder. If `XDG_STATE_HOME` is an absolute path, that folder is `$XDG_STATE_HOME/bowerloom`. Otherwise it is `~/.local/state/bowerloom`. These commands work from any folder.

```text
bowerloom cache list [--json]
bowerloom cache prune [--unreferenced] [--partial] [--legacy] [--all] [--entry <id-prefix>]... [--approve <revision>] [--json]
```

`cache list` shows what is there. It reads only, takes no lock, and writes nothing. It lists the skills cache, the store cache of items that come from a store remote, and the per-project caches of earlier betas. Each entry shows its id, `completed` or `partial`, what it holds, and its size. `[store]` means your store lists it, and `[project]` means this project lists it. With `--json` it prints one object in the format `bowerloom/cache-list/v1beta1`. If your store or this project cannot be read, it says `Some references were not checked`, with the refusal code, the file, and the next step. With `--json`, each entry of `unreadable` has `source`, `code`, and `item`, and, when the refusal carries its own step, such as a store item with a file that a lock cannot record, `next`. A partial entry says why: an unfinished fetch, an unreadable entry, a store item that changed since it was written, or a folder that a stopped prune or write left. Its size is unknown. A name that `cache prune` would refuse to delete, such as a link or a folder whose mode is not 0700, is not an entry: `cache list` counts it under `Not listed` and says why.

`cache prune` deletes entries after you approve a plan. Nothing is deleted by itself. Give at least one selector:

- `--unreferenced` picks entries that your store and this project do not list. Other projects are not checked. If your store or this project cannot be read, it picks nothing.
- `--partial` picks unfinished fetches. `--legacy` picks the per-project caches of earlier betas. `--all` picks everything, and goes alone.
- `--entry <id-prefix>` picks one entry by the first 8 or more characters of its id from `cache list`, or by its full store folder name. For a per-project cache of an earlier beta, `<projectId>/<id-prefix>` picks it, as `cache list` prints it. If a prefix matches more than one entry, the refusal names each match.

An entry that another command is using is skipped, and `--entry` refuses it with `CACHE_ENTRY_BUSY`. An entry whose owner lock is older than a day counts as not in use. If `bowerloom skills sync` or `apply --frozen` needs a deleted pin, it fetches the pin again. `cache prune` shows the plan first. Agents pass `--approve <revision>` or `--json`. If a picked entry changed between the plan and the approval, it refuses with `STALE_APPROVAL` and deletes nothing. A new entry that is not in the plan stays. It waits up to 60 seconds for another command that holds the cache, then refuses with `PROJECT_LOCK_UNAVAILABLE`.

`cache prune` never touches project files, installed copies, `.bowerloom/managed`, the private item folders of a project, or the store. It deletes only the folders its plan lists, and a link is removed as a name and never followed. A delete that fails refuses with `CACHE_PRUNE_FAILED`. The message names the folder, the step, and how many entries it deleted. Run `bowerloom cache list`, then the same command again: `--partial` removes what a stopped delete left. If a folder inside an entry cannot be deleted, the refusal names the leftover `.prune-` folder and the path that failed, and its `Next:` line is a `chmod -R -- u+rwx` command. Run that command, then run the prune again. Each path in a printed command is in single quotes, after `--`, so you can paste it into a shell as it is. A name can hold the zero-width non-joiner and joiner, U+200C and U+200D, which some folder names need. Bowerloom prints them as they are, in the command too. For a name that holds a control character, any other invisible format character, or a backslash, Bowerloom prints no command: find the folder with `ls -i` and rename or remove it by hand. The next prune deletes every other entry first, and `cache list` shows the same line under the leftover. Ctrl-C stops `cache prune` between two entries with exit code 130, and it prints how many entries it deleted. A stop waits for the current entry. Real entries are small: a skills-cache operation holds at most 1200 files and folders and 12 MiB, and a store item at most 126 files and 2 MiB. A leftover that someone else put in the cache can be larger and take longer. During that time, other cache commands wait for the cache lock, and they can refuse with `PROJECT_LOCK_SLOT_COLLISION`.

## Create commands

```text
bowerloom team create <name> [--profile engineer|founder|research] [--global] [--approve <revision>] [--json]
bowerloom skill create <name> [--team <team>]... [--global] [--approve <revision>] [--json]
bowerloom prompt create <name> [--team <team>]... [--global] [--approve <revision>] [--json]
bowerloom team adopt <id> [--approve <revision>] [--json]
bowerloom slice create <name> [--root <folder>] [--registered <folder-name>] [--include <pattern>]... [--approve <revision>] [--json]
```

`team adopt` copies a team from your store into this project, at `.bowerloom/teams/<id>`, and lists it in `bowerloom.json` as a project item. A team that `bowerloom.json` lists from the store switches to the project copy. A team it does not list yet is added, and store skills and prompts tagged to the team stay store items. The project then owns the copy; later store changes do not reach it. In a project with `bowerloom.json`, the create commands also add the new skill, prompt, or team to it. A context slice is a project item only: `bowerloom.json`, the store, and the lock never hold it.

Agents use these commands most. They write inside `.bowerloom` only, or inside your store with `--global`. You and your agents own the files they make.

`--global` creates the item in your store, `~/.bowerloom`, and not in a project. It works from any folder and never looks for a project. The first `--global` write makes the store, and the plan says so first. The store holds definitions only, and a project picks store items with `bowerloom use`. With `--global`, `--team` names a team in the store. A team made with `--global` is built from a fixed store brief and the profile you choose, and it does not read a project brief. A store that Bowerloom did not make refuses with `STORE_INVALID`, and Bowerloom never takes it over. [Create teams, skills, and prompts](/docs/guides/create-items/) explains each one.

`slice create` writes `.bowerloom/slices/<name>.yaml`, or registers that file when it is already there. A slice belongs to its project, so it takes no `--global`. With `--registered <folder-name>`, `--root` is a folder inside that registered folder, and a name that the store does not hold refuses `FOLDER_NOT_FOUND`. [Context slices for agents](/docs/guides/context-slices/) explains slices.

## Context

```text
bowerloom context show <slice> [--json]
bowerloom context measure [--agent <role>]... [--team <team>] [--from <folder>] [--baseline <folder>] [--bytes-per-token <number>] [--user] [--json]
bowerloom context guard --agent <role> --explain <path> [--tool Read|Grep|Glob] [--slice <id>]...
```

`context show` prints the files a slice selects and the index skill that `apply` writes for it. `context measure` compares what each agent loads at start with the same agent loaded with every `.md` file of a baseline folder. Bytes are exact and tokens are an estimate. Both read only and use no network. `context guard` is the read guard that `apply` adds to an agent with slices. Claude Code runs it as `bowerloom-guard`, a second command of the package, before each Read, Grep, and Glob of that agent. The hook form reads the hook input on standard input and prints a deny line or nothing. With `--explain` it prints what the guard decides for one path. See [Context slices for agents](/docs/guides/context-slices/#the-read-guard).

## Registered folders

```text
bowerloom folder add <folder-name> <path> [--approve <revision>] [--json]
bowerloom folder allow <folder-name> [heading|frontmatter:<key>] [--approve <revision>] [--json]
bowerloom folder deny <folder-name> [--approve <revision>] [--json]
bowerloom folder list [--json]
bowerloom folder remove <folder-name> [--approve <revision>] [--json]
```

A registered folder is a folder outside the project, such as a knowledge base, that a slice can select from. The record lives in your store, at `~/.bowerloom/folders/<folder-name>.json`, and names the folder as a path below your home folder. `add`, `list`, and `remove` work from any folder and never look for a project. `allow` and `deny` run inside a project: `allow` shows a plan that prints the project and the absolute folder, then records a grant for that project only. The grant also records the summary kind that a slice may copy, `heading` unless you name `frontmatter:<key>`. A slice in a project without a grant, or with another summary kind than the grant records, is held with `FOLDER_NOT_ALLOWED` until you run `allow` again with that kind. A grant made before the kind was recorded has no kind, so it holds every slice, and makes the read guard refuse already installed slices, until you run `allow` again. One grant holds one kind per folder per project, so two slices on one folder that ask for different kinds cannot both be live. A grant file with a kind has the same format name as before, and an older beta.3 build reports `FOLDER_INVALID` for it. `add`, `allow`, `deny`, and `remove` show a plan first and write only the store. `folder list` reads only and prints `ready`, `missing`, or `refused (<code>)` for each folder; with `--json` it prints the format `bowerloom/folder-list/v1beta1`. Bowerloom reads a registered folder and never writes it. [Context slices for agents](/docs/guides/context-slices/#registered-folders) lists the rules a folder must meet.

## Apply

```text
bowerloom apply [--harness claude|codex|both] [--allow-agent <role>:<hash>]... [--frozen] [--max-github-requests <n>] [--approve <revision>] [--json]
```

`--frozen` installs only what `bowerloom.lock.json` records, as `npm ci` does. It refuses if the lock file and `bowerloom.json` disagree. It ignores your store. It fetches what this machine does not hold yet, from the hosts the plan names. Plain apply never fetches. A store skill or prompt fetched from the lock that sets `allowed-tools`, registers hooks, or runs `!` shell lines is held with `ITEM_REVIEW_REQUIRED`, unless the approved plan showed it. Run `bowerloom apply --frozen` again to review it. `--max-github-requests <n>` lets one run make up to n GitHub requests, at most 5000. The default is 1000.

A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`. Six commands read it: `apply --frozen`, `skills sync`, the sync step of `up`, `use`, `lock update`, and `store migrate`. Each reads it only for a store item that needs the store repository. Then the plan shows a `Credentials:` line that names each repository that gets the token, and its `Network:` line says that store items use your GitHub token. The token goes only to `api.github.com`, for those repositories. Pinned skills are fetched without credentials. A plain `apply` never reads the variable. If the variable is set or removed between the plan and `--approve`, the run refuses `STALE_APPROVAL`. See [Trust and security boundaries](/docs/security/#the-github-token-for-a-private-store).

`skills sync` already copies the skills in `.bowerloom/skills.json` into place. `apply` puts the prompts in `.bowerloom/prompts` in place for Claude Code, Codex, or both (the default), and it places any skill copy that is still missing. It also copies the agents of every team, `first-team` included, from `.bowerloom/teams/<team>/agents/<role>.md` to `.claude/agents/<role>.md` for Claude Code. A context slice in `.bowerloom/slices/<name>.yaml` becomes the skill `.claude/skills/slice-<name>/SKILL.md`, a list of paths that an agent whose `skills` list names `slice-<name>` loads at start. Such an agent also gets a read guard in its copy. Codex agents are not projected in this beta. Context slices are projected for Claude Code only. Claude Code and Codex are the harnesses, the agent applications that read these copies. Run `apply` when the project has prompts or agents. When every copy is already in place, it prints `Nothing to change.` and exits 0. It never fetches. It adds copies and removes none. It never overwrites a copy you changed or a copy that Bowerloom did not install. A hand-made agent file that equals the copy is adopted. One that differs holds that agent with `AGENT_TARGET_OCCUPIED`, and a bad agent file holds only that agent. It never edits `AGENTS.md` or `CLAUDE.md`. The plan shows a note for a prompt that sets `allowed-tools`, registers hooks, or runs shell commands, and for an agent that sets hooks or lists shell tools. Read that prompt or agent before you approve. An agent that sets `permissionMode: bypassPermissions`, `hooks`, or `mcpServers` is held with `AGENT_GRANT_REVIEW_REQUIRED` until you read it and pass `--allow-agent <role>:<hash>`. The hash is the full sha256 of the agent file, 64 hex characters. The flag works only in a terminal and not with `--json`. For each allowed agent, Bowerloom prints the plan notes and then asks you to type its role name. The plan itself never carries the flag, so a terminal and a pipe see one revision. At a terminal, the text output names the exact flag. `--approve` alone never installs such an agent. The terminal gate is a guardrail, not a security boundary. It stops a pipe, `--json`, and a CI job from allowing an agent by accident. An agent that has a shell or can write files can drive a pseudo-terminal, or write `.claude/agents` itself, so the gate does not stop it. The flag repeats, and `up` takes it too. See [Project agents for Claude Code](/docs/guides/agents/). See [Add third-party skills](/docs/guides/add-skills/#apply-the-skills).

<a id="init"></a>

## First setup

```text
bowerloom init plan --mode new|existing --target <absolute-directory> --name <project-name> --goal <goal> [--profile engineer|founder|research] [--assistant <name>] [--team <name>] [--review milestones|handoff] [--json]
bowerloom init apply --mode new|existing --target <absolute-directory> --name <project-name> --goal <goal> [--profile engineer|founder|research] [--assistant <name>] [--team <name>] [--review milestones|handoff] --approve <revision>
bowerloom init plan --mode new|existing --target <absolute-directory> --brief <brief.json> [--json]
bowerloom init apply --mode new|existing --target <absolute-directory> --brief <brief.json> --approve <revision>
bowerloom init status --target <absolute-directory>
bowerloom init demo-plan --target <absolute-directory> --from <installed-revision> [--json]
```

Plans describe files. Apply requires unchanged inputs and exact approval. Status reads the installation. Demo-plan describes a synthetic handoff without execution.

[First-team tutorial](/docs/learn/first-team/) and [Existing project](/docs/guides/existing-project/) explain the sequence. A stale approval requires another plan.

<a id="revise"></a>

## Revision

```text
bowerloom revise plan --target <absolute-directory> --brief <brief.json>
bowerloom revise apply --target <absolute-directory> --brief <brief.json> --from <installed-revision> --approve <plan-revision>
bowerloom revise recover --target <absolute-directory> --approve <plan-revision> --action resume|rollback
```

Apply requires the old installed revision and exact new plan approval. Recovery uses the recorded transaction and original approval. It starts no workers.

The parser also accepts inline name, goal, profile, assistant, team, review, and plan --json. Do not mix inline fields with --brief. Read [Revision](/docs/revision/) and [Recovery](/docs/guides/recover-revision/).

<a id="control-and-destruct"></a>

## Control and stop

```text
bowerloom control plan|register --root <root> --team <id> --spec <relative-team-file> [--adapter graph|recipe --installation <private.json>] [--registry <directory>] [--approve <revision>]
bowerloom destruct <team-id> --root <root> [--registry <directory>] [--timeout-ms <milliseconds>]
bowerloom destruct all [--registry <directory>] [--timeout-ms <milliseconds>]
```

Control records a separately reviewed owner. Registration needs its exact approval. It does not start work. Destruct requests a stop within the selected registry.

A missing owner or uncertain result is not proof of cleanup. Keep the original enrollment and records. Read [Stop registered work](/docs/stop/).

<a id="link"></a>

## Local definition links

```text
bowerloom link plan --from <root> --to <root> --file <definition> --out <private-new-file>
bowerloom link apply --from <root> --to <root> --file <definition> --out <private-new-file> --approve <revision>
bowerloom link read --connection <file> --target <receiving-root>
bowerloom link revoke --connection <file>
```

Links disclose one selected definition between reviewed installed local roots. Apply requires the exact file and recipient binding. Read and revoke use the private connection record.

A link grants no execution authority. Changed source, recipient, expiry, or file binding requires inspection and renewed approval. Do not share raw receipts.

<a id="harness"></a>

## Synthetic harness configuration

```text
bowerloom harness import --harness codex|claude --file <absolute-fixture-file> --synthetic
bowerloom harness plan --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --synthetic
bowerloom harness managed-plan --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --state <new-private-directory> --synthetic
bowerloom harness apply --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --state <new-private-directory> --synthetic --approve <revision>
bowerloom harness removal-plan --state <private-directory> --synthetic
bowerloom harness remove --state <private-directory> --synthetic --approve <removal-plan-revision>
bowerloom harness recover --state <private-directory> --synthetic --approve <recorded-operation-revision>
```

Import and plan read separately reviewed synthetic inputs. Approved projection and removal change the selected fixture. Projection writes the selected files into that fixture configuration. Recovery requires its recorded operation approval.

The --synthetic flag is an assertion. If a file is live or unreviewed, stop. Read [Codex and Claude Code](/docs/harnesses/).

<a id="mcp"></a>

## MCP planning

```text
bowerloom mcp plan --declaration <absolute-json-file> --binding <absolute-json-file> --catalog <absolute-json-file> --synthetic
```

This form reads three reviewed synthetic files and prints a private plan. It starts no server, resolves no secret, and invokes no tool.

Keep private bindings and output private. Catalog descriptions remain untrusted data. Read [MCP connections](/docs/mcp/).

<a id="backend"></a>

## Local backend

```text
bowerloom backend doctor
bowerloom backend plan|install --root <new-absolute-directory> [--studio-port <port>] [--database-port <port>] [--approve <revision>]
bowerloom backend status --root <private-installation-directory>
```

Doctor inspects prerequisites. Plan describes a separate Supabase installation. Install needs exact approval and starts the named services. Status reads retained state.

The macOS Docker context, ARM64 daemon, Compose v2, storage, and approval requirements remain separate. Read [Local backend](/docs/backend/).

<a id="skills"></a>

## Third-party skills

```text
bowerloom skills add npm:<package>@<version>:<path> [--id <id>] [--team <team>]... [--replace] [--global] [--approve <revision>] [--json]
bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path> [--id <id>] [--team <team>]... [--replace] [--global] [--approve <revision>] [--json]
bowerloom skills check [--global] [--json]
bowerloom skills sync [--offline] [--team <team>] [--frozen] [--max-github-requests <n>] [--approve <revision>] [--json]
bowerloom skills recover plan|apply --item <id> [--action resume|rollback|abandon] [--approve <revision>] [--json]
bowerloom skills migrate plan|apply --state <earlier-state-folder> [--approve <revision>] [--json]
```

`skills add` pins one skill in `.bowerloom/skills.json`. The pin must be exact. An npm source takes an exact version such as `1.2.3`. A GitHub source takes a full 40-character lower-case commit, and the repository name is lower case. Ranges, tags, branches, and short commits refuse before anything is fetched. `<path>` is the skill folder inside the package or repository. `skills add` reads only `registry.npmjs.org` or `api.github.com`, without credentials. It takes MIT and Apache-2.0 skills only. It records the pin, keeps the bytes it checked in this machine's skills cache, and installs nothing.

`--id` sets the entry id. The default is the skill name. `--team` limits the skill to a team. Without it, every team gets the skill. `--replace` moves an existing id to another version or commit of the same package or repository. The plan shows the old pin and the new pin, and the entry keeps its teams unless you pass `--team`. Then `skills sync` updates the copies. [Move a skill to a newer pin](/docs/guides/add-skills/#move-a-skill-to-a-newer-pin) shows an example.

`--global` pins the skill in `~/.bowerloom/skills.json`, your store, and keeps the checked bytes in this machine's skills cache, which is never inside the store. It works from any folder. The store holds up to 256 skills and 4 MiB in `skills.json`. A project holds up to 128 skills and 1 MiB. If the private state folder and the store lie inside one another, the command refuses with `STORE_STATE_NESTED`.

`skills check` reads `.bowerloom/skills.json` and checks every pin offline. It writes nothing. `skills check --global` checks the store `skills.json`. Its JSON format is `bowerloom/skills-manifest-check/v1beta3`, with the new fields `scope` and, on each skill, `source`.

`skills sync` installs the skills that the project selects into `.bowerloom/managed`, `.claude/skills`, and `.agents/skills`. It installs them for Claude Code and Codex. In a project without `bowerloom.json`, that is every skill in `.bowerloom/skills.json`. In a project with it, that is the skills it lists. It fetches only what this machine lacks. That is a pin that the skills cache does not hold. It is also a lock item that the store cache does not hold. It checks every byte against its pin or the lock first. `--frozen` installs only what `bowerloom.lock.json` records and ignores your store, as `apply --frozen` does. `--max-github-requests <n>` lets one run make up to n GitHub requests, at most 5000. The default is 1000. If a pin still needs fetching, `--offline` refuses before any change. `--team` syncs only that team's skills. A skill whose copy you changed is held and shown with its next step, and the others apply. Sync removes nothing. Ctrl-C stops it between two skills, never inside one.

`skills recover` finishes or undoes the one unfinished change of an item, after a crash or a refusal inside it. `skills migrate` moves a skill that an earlier Bowerloom installed in `.bowerloom-skills` to `.bowerloom/managed`. `skills.json` must pin the same source first. `migrate plan` prints the `skills add` command if it does not.

[Add third-party skills](/docs/guides/add-skills/) explains the sequence and the refusal codes. `bowerloom help skills` shows the same forms.

### Request-file forms

These older forms take hand-written request files. `bowerloom help advanced` lists them. The `skills add`, `sync`, and `apply` commands above replace them for everyday use.

```text
bowerloom skills source plan --request <absolute-json> --state <private-root> --operation <id> --min-free-bytes <integer>
bowerloom skills source acquire --plan <absolute-json> --approve <revision>
bowerloom skills source git plan --request <absolute-json> --state <private-root> --operation <id> --min-free-bytes <integer>
bowerloom skills source git acquire --plan <absolute-json> --approve <revision>
bowerloom skills source inspect --request <absolute-local-cache-selector-json>
bowerloom skills source recover plan --request <absolute-json>
bowerloom skills source recover apply --plan <absolute-json> --approve <revision>
bowerloom skills plan --request <absolute-install-request-json>
bowerloom skills update plan --request <absolute-update-request-json>
bowerloom skills apply --plan <absolute-json> --approve <revision> --previous <revision|none>
bowerloom skills inspect --request <absolute-json>
bowerloom skills recover plan --request <absolute-json>
bowerloom skills recover apply --plan <absolute-json> --approve <revision>
```

These forms read public npm and public GitHub sources only. `skills recover` takes `--item` for the new forms and `--request` for the request-file forms.

<a id="routine"></a>

## Routine planning

```text
bowerloom routine plan --root <absolute-.bowerloom-directory> --experiment-id <logical-id> --experiment-digest <sha256:hex>
```

Routine planning describes a routine. It starts no workers.

<a id="portable"></a>

## Portable bundles

```text
bowerloom portable validate <bundle-directory>
bowerloom portable plan|install <bundle-directory> --select <part,part> --harness codex|claude --target <new-absolute-directory> [--approve <revision>]
```

These forms require a separately reviewed bundle and selected parts. Approved installation copies selected files into a new target. It starts no workers.

The portable installer accepts `codex` and `claude`. Any other value fails with `UNSUPPORTED_HARNESS`. The `codex` value projects skills into `.agents/skills/`. The `claude` value projects them into `.claude/skills/bowerloom-<part-id>/`. Claude Code has not been observed to discover these files natively. The installer does not establish general harness conversion. An existing target or stale approval requires inspection.

<a id="recipe"></a>

## Recipe controller

```text
bowerloom recipe inspect|setup --installation <private.json>
bowerloom recipe plan|review|approve|run|reconcile|cancel|status --installation <private.json> --input <request.json>
```

These forms require the exact private installation, input, operator authority, and accepted recipe scope. They are not a general startup procedure.

The operator CLI owns exact approval. An uncertain external result requires reconciliation of the original operation. Do not replay it blindly.

<a id="validate-and-plan"></a>

## Team source

```text
bowerloom validate <crew.yaml> [--root <directory>]
bowerloom plan <crew.yaml> [--root <directory>]
```

These forms read crew.yaml and print JSON. The source root defaults to its containing directory. They start no workers.

Use a separately scoped source tree. Successful validation does not grant runtime permission or prove a model sandbox.

<a id="authoring"></a>

## Scenario authoring

```text
bowerloom authoring validate|export <authoring.json> --scenario <frozen-scenario.json> [--root <directory>]
```

These forms require a separately frozen supported scenario. They compile the selected authoring input for that scenario.

An export is not an executed experiment. Preserve the scenario and source-license requirements in [Workbench](/docs/workbench/).

<a id="historical-demo"></a>

## Historical demo and session

```text
bowerloom up --demo --pro|--5x|--20x --installation <private.json>
bowerloom status|review|cancel --installation <private.json>
bowerloom approve --installation <private.json> --candidate <sha256:...> --action <sha256:...>
```

These forms require a private prepared installation and separately accepted execution scope. They do not replace first-team setup.

Up stops for exact approval. Approve writes and tests the stored proposal. Tier flags do not promise measured throughput. The task runner executes sequentially.

## Flags and refusal

`init plan --json` and `revise plan --json` expose the complete plan. Apply requires the exact reviewed revision, not a guessed value.

Malformed, duplicate, extra, or conflicting arguments refuse. Do not infer success without reading the actual result.

The CLI has no generic `init recover`, public MCP connect command, or general native bootstrap command.

## Compatibility aliases

`trellis` and `trellis-mcp` remain compatibility aliases. They do not expose a different authority or qualify an older runtime path.

## Support boundary

[Current support](/docs/status/) describes supported tasks and limits. [Status and error reference](/docs/reference/errors/) explains core refusals.
