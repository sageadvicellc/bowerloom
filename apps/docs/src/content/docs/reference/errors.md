---
title: "Status and error reference"
description: "Read the exact status or refusal before choosing a next action."
section: "Reference"
order: 24
---

Use the actual result from the matching installed version. A status is an observed state. An error identifies a refused operation.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

## Status fields

| Field | Meaning in the reviewed setup |
| --- | --- |
| `status` | `ready-for-review`, `drifted`, or `revision-pending` |
| `revision` | Installed setup revision, or null when inspection cannot establish it |
| `specReady` | Whether the inspected specification meets its required checks |
| `runtimeReady` | False in the setup results documented here |
| `executionAuthorized` | False in the setup results documented here |
| `reviewRequired` | True in the setup results documented here |
| `drift` | Recorded differences or inspection failures |
| `compiledCandidate` | The compiled definition identity when inspection can establish it |
| `contextImported` | False in the setup results documented here |
| `hostedAgentCreated` | False in the setup results documented here |

`bowerloom status` in a project folder reports `ready`, `drifted`, or `revision-pending` in `Setup:`. With `--json` it prints format `bowerloom/project-status/v1beta2` and reports `format`, `markers`, `setup`, `config`, `specReady`, `runtimeReady`, `executionAuthorized`, `revision`, `drift`, and `owned`. `runtimeReady` and `executionAuthorized` are false. A `bowerloom.json` that does not match its format adds the drift kind `config-invalid`, with the refusal code. Read [CLI reference](/docs/cli/#project-commands).

`ready-for-review` requires human review. It does not mean that a team runs or has execution permission.

`revision-pending` requires retained transaction state and [explicit recovery](/docs/guides/recover-revision/). `drifted` requires inspection of actual differences.

## Setup refusals

| Code | Trigger and meaning | Preserve and next action |
| --- | --- | --- |
| `BOWERLOOM_EXISTS` | The target already contains `.bowerloom/`. | Inspect the setup. Use [revision](/docs/revision/). |
| `EXACT_APPROVAL_REQUIRED` | Approval is absent or lacks the required revision form. | Retain the plan. Obtain its exact human approval. |
| `IDENTITY_POLICY_UNSUPPORTED` | Recorded identity policy does not meet the supported path. | Preserve the receipt. Inspect compatibility without editing identity. |
| `PRIVATE_OWNER_REQUIRED` | Directory ownership or permissions violate the required boundary. | Inspect the selected path. Do not bypass ownership controls. |
| `REVISION_PENDING` | A retained revision marker blocks fresh installation. | Preserve the transaction. Use [recovery](/docs/guides/recover-revision/). |
| `STALE_APPROVAL` | Current inputs or binding do not match approval. | Retain the refusal. Plan again and obtain new approval. |
| `STARTUP_TARGET` | The target fails the required absolute path form. | Select the intended valid path. Plan again. |
| `TARGET_EXISTS` | New mode finds an existing target. | Inspect it. Choose existing mode only for the intended project. |
| `UNSAFE_DIRECTORY` | A path fails required directory conditions. | Inspect the path and ancestors. Do not force the write. |

A wrong setup approval returns `STALE_APPROVAL` with exit 1 and no project changes. Do not infer every I/O failure is unchanged.

## Exit codes

| Exit code | Meaning |
| --- | --- |
| 0 | Done, or nothing to change. |
| 1 | Refused. The code names the reason. |
| 2 | Usage error (`USAGE`). |
| 3 | Approval required. The plan and its revision are printed. Nothing was written. |
| 4 | Held by a gate. `bowerloom up` returns 4 with `prepared, workers held`, or `prepared, N items held`. |
| 130 | Stopped at the yes/no question with Ctrl-C or Ctrl-D. It prints `Stopped. Nothing was changed.` |

Exit 3 and exit 4 belong to the project commands: `up`, `ls`, `status`, `team`, `skill`, `prompt`, `skills add`, `check`, `sync`, `recover`, `migrate`, and `apply`. There is no `--yes`. Pass `--approve <revision>` with the revision from the plan. [Approvals and exit codes](/docs/cli/#approvals-and-exit-codes) explains the flow.

In a terminal, a refusal prints `Refused (<CODE>): <message>`, one plain sentence, and a `Next:` line. Without a terminal, it prints one line of JSON on standard error.

## Project and approval refusals

| Code | Meaning | Next action |
| --- | --- | --- |
| `USAGE` | The command line did not match a Bowerloom command. Nothing changed. | Run `bowerloom help`. |
| `APPROVAL_REQUIRED` | The plan needs your approval. Exit 3. | Run the same command with `--approve <revision>`. |
| `APPROVAL_DECLINED` | You declined. Nothing changed. | Run the command again to see the plan. |
| `STALE_APPROVAL` | The plan changed after you saw it. Nothing was applied. Setting or removing `BOWERLOOM_GITHUB_TOKEN` after the plan also changes it, and the message then says so. | Run the command again without `--approve` to see the new plan. |
| `WORKERS_HELD` | The project is prepared. No worker was started. Exit 4. | Run `bowerloom status`. |
| `PROJECT_NOT_FOUND` | Bowerloom looked in this folder and every parent up to your home folder. | Run `bowerloom up --team <name> --goal <goal>` in the project folder. |
| `PROJECT_ROOT_REFUSED` | A whole disk or home folder is too broad to be a project. It also covers a non-empty `~/.bowerloom` with no `store.json`, and a `bowerloom.json` in your home folder. A `~/.bowerloom` that is unsafe, a link, or has an invalid `store.json` refuses with its `STORE_*` code instead. | Change into the project folder. |
| `PROJECT_IN_CLOUD_FOLDER` | The project is under `~/Documents` or `~/Desktop` with Desktop and Documents sync on, or under a `~/Library` cloud folder. Cloud sync changes file times and moves files, which breaks the checks that keep a project safe. | Move the project, for example `mv <project-folder> ~/Projects/`. |
| `PROJECT_FOLDER_UNSAFE` | The project folder is not yours, or other people can write in it. Bowerloom will not trust a project folder that other people can change. | Run `ls -ld .`. |
| `PROJECT_UNSAFE` | Bowerloom does not trust a `.bowerloom` folder that other people or links can change. | Run `ls -ld .bowerloom`. |
| `PROJECT_UNREADABLE` | Bowerloom cannot read a folder on the way to the project. | Run `ls -ld <folder>`. |
| `PROJECT_LOCKED` | Two commands must not change one project at the same time. Nothing changed. | Run `bowerloom status`, then try again. |
| `PROJECT_LOCK_UNAVAILABLE` | The lock uses a local port, and this computer did not give it out. A sandbox that blocks local ports gives this refusal. | Run `bowerloom status`. If an agent sandbox runs Bowerloom, read [Agent sandboxes](/docs/troubleshooting/#agent-sandboxes). |
| `PROJECT_LOCK_SLOT_COLLISION` | The lock uses a local port. Another program listens on it, or another Bowerloom command is too busy to answer. | Wait for other Bowerloom commands to finish and run the command again. If it repeats, run `lsof -nP -iTCP:<port> -sTCP:LISTEN`. |
| `PROJECT_BRIEF_INVALID` | A new team is built from the project brief that setup saved, and it cannot be read. On a clone, `bowerloom up --team` and `team create` refuse this way, because `.bowerloom/brief.json` stays on the first machine. | Run `bowerloom status`. On a clone, follow the [teammate steps](/docs/guides/add-skills/#get-the-same-skills-on-another-machine). |
| `INSPECTION_LIMIT` | A `.bowerloom` folder holds too many entries to list. | Reduce the entries. |

Create commands also refuse with `TEAM_EXISTS`, `TEAM_ID_RESERVED`, `TEAM_NAME_INVALID`, `TEAM_NOT_FOUND`, `SKILL_EXISTS`, `SKILL_NAME_RESERVED`, `SKILL_NAME_INVALID`, `PROMPT_EXISTS`, `PROMPT_NAME_INVALID`, `REVISION_PENDING`, `AUTHORING_PENDING`, `AUTHORING_RECEIPT_INVALID`, `AUTHORING_UNSAFE_PATH`, `AUTHORING_UNREGISTERED`, `AUTHORING_WRITE_INTERRUPTED`, and `AUTHORING_ITEM_MISSING`. [Create teams, skills, and prompts](/docs/guides/create-items/#if-a-command-refuses) explains them. `AUTHORING_RECEIPT_INVALID` means Bowerloom reads its record of created items strictly, so a hand edit can break it. Run `git diff .bowerloom/authoring/receipt.json`. `AUTHORING_UNSAFE_PATH` means Bowerloom does not read or write through links, shared files, or files others can change. Run `ls -la .bowerloom`. `AUTHORING_ITEM_MISSING` means a created item is gone. Run `git status .bowerloom`. `AUTHORING_DISK_FULL` means the disk has no room, so Bowerloom stopped before it wrote more. Run `df -h .`. `AUTHORING_ACCESS_DENIED` means the system refused the write, so Bowerloom stopped before it wrote more. Run `ls -ld .bowerloom ~/.bowerloom`.

## Store and config refusals

The store is the folder `~/.bowerloom`. `bowerloom store status` reports a store refusal as `Store: refused (<CODE>)` and exits 0. Every other command exits 1.

| Code | Meaning | Next action |
| --- | --- | --- |
| `STORE_NOT_FOUND` | There is no store yet. The first `--global` create or `skills add` makes the store. | Run `bowerloom skill create <name> --global`. |
| `STORE_INVALID` | The store folder has no usable `store.json`. If `~/.bowerloom` holds no `store.json` that Bowerloom wrote, Bowerloom does not use it and never takes over the folder. | Run `bowerloom store status`. |
| `STORE_UNSAFE` | The store must be a real folder that you own, with no write access for others and no link on its path. Your home folder must be yours or root's, and others must not be able to write in it unless it is sticky. Bowerloom does not check the folders above your home folder. | Run `ls -ld ~/.bowerloom`. |
| `STORE_UNREADABLE` | Bowerloom cannot read the store or a folder on the way to it. A folder that cannot be read cannot be checked. | Run `ls -ld ~ ~/.bowerloom`. |
| `STORE_IN_CLOUD_FOLDER` | The store is in a cloud-synced folder. Cloud sync changes file times and moves files, which breaks the checks that keep the store safe. | Move the home folder setup out of iCloud. The store must stay at `~/.bowerloom`. |
| `STORE_STATE_NESTED` | The private state folder and the store must not be inside one another. Bowerloom keeps the cache outside the store, so a store inside the state folder, or the reverse, is refused. | Set `XDG_STATE_HOME` to a folder outside `~/.bowerloom`. |
| `STORE_WRITE_FAILED` | Bowerloom could not write to the store. The disk refused the write, and the message names the system error, such as `ENOSPC`. | Run `df -h ~ && ls -ld ~/.bowerloom`. |
| `STORE_LOCKED` | Another Bowerloom command is changing the store. Two commands must not change the store at the same time, so nothing was changed. | When the other command is done, run this one again. |
| `STORE_NOT_A_PROJECT` | The store holds definitions only, so a folder inside it cannot be a project. | Run the command in a project folder outside `~/.bowerloom`. |
| `CONFIG_INVALID` | `bowerloom.json` does not match the project config format. Bowerloom reads it strictly, so a hand edit can break it. | Run `git diff bowerloom.json`. |
| `CONFIG_UNREADABLE` | Bowerloom cannot read `bowerloom.json`. A file that cannot be read cannot be checked, so Bowerloom does not use it. | Run `ls -l bowerloom.json`. |
| `CONFIG_UNSAFE` | `bowerloom.json` must be a plain file that you own, with one link, no write access for others, and at most 1 MiB. This refusal stops every project command. | Run `ls -l bowerloom.json`. |
| `CONFIG_LIMIT` | `bowerloom.json` lists too many items. This beta allows 128 skills, 128 prompts, and 32 teams at most. | Run `bowerloom status`. |
| `CONFIG_DUPLICATE_ID` | `bowerloom.json` lists a skill, prompt, or team twice. Each item is listed once, from one source. | Run `git diff bowerloom.json`. |

`CONFIG_INVALID`, `CONFIG_LIMIT`, and `CONFIG_DUPLICATE_ID` do not stop `bowerloom status`. They show in its `config` object and as the drift kind `config-invalid`.

These store and config codes come from `use`, `unuse`, `team adopt`, and the plans of a project with `bowerloom.json`.

| Code | Meaning | Next action |
| --- | --- | --- |
| `STORE_ITEM_NOT_FOUND` | Bowerloom picks only items that your store defines. | `bowerloom ls --global` |
| `STORE_ITEM_MISSING` | A listed store item is not in your store and not in the lock, so Bowerloom cannot install it. | Create it with `bowerloom <kind> create <id> --global`, or run `bowerloom unuse <kind> <id>`. |
| `STORE_ITEM_NOT_SHAREABLE` | A shared project needs every store item to be fetchable by your team. | Give the store a remote and push it. `bowerloom store status` shows the commands. Or adopt a team into this project with `bowerloom team adopt`. |
| `STORE_REMOTE_PRIVATE` | GitHub does not show this repository without a token. It may be private or may not exist. | Set `BOWERLOOM_GITHUB_TOKEN` to a GitHub token that can read the repository, or make the repository public. |
| `STORE_REMOTE_AUTH_FAILED` | GitHub answers the same way for a token that cannot read the repository and for a repository that does not exist. | Check that the token can read the repository, and that the repository name is right. |
| `GITHUB_TOKEN_INVALID` | Bowerloom checks the token's shape before any network call and never shows the value. | Set it to a token with letters, digits, `_` or `-`, 20 to 255 characters. |
| `GITHUB_TOKEN_SSO_REQUIRED` | An organization that uses single sign-on refuses a token until it is authorized for that organization. | Authorize the token for the organization on GitHub, under the token's settings, then run the command again. |
| `CONFIG_ITEM_SELECTED` | This project already picks that item from that source. | `bowerloom ls` |
| `CONFIG_ITEM_NOT_SELECTED` | Bowerloom changes only items that `bowerloom.json` lists. | `bowerloom ls` |
| `CONFIG_ITEM_MISSING` | `bowerloom.json` lists a project item that the project does not define. | `bowerloom <kind> create <id>`, or `bowerloom unuse <kind> <id>`. |
| `CONFIG_WRITE_UNCONFIRMED` | `bowerloom.json` was written, but it changed again before Bowerloom could read it back. | `git diff bowerloom.json` |
| `TEAM_NOT_SELECTED` | `up` installs for a team only if `bowerloom.json` lists it. | `bowerloom use team <id>` |
| `ITEM_REVIEW_REQUIRED` | Bowerloom shows what an item can do before it installs it. | Run `bowerloom apply --frozen` again to review it. |

These codes come from `bowerloom store migrate`. It also raises the store, config, lock, and token codes above. A refusal after the run wrote part of its work says what it wrote. Its `Next:` line is the command that finishes the run, and its JSON envelope has `partial: true` and that command as `next`. Run it, and its plan finishes the rest. If another command holds the project lock, `store migrate` may already have made an empty store. Then its old plan no longer applies: run the command again without `--approve` to see the next plan.

| Code | Meaning | Next action |
| --- | --- | --- |
| `MIGRATE_ITEM_NOT_FOUND` | `store migrate` moves only items that this project defines in `.bowerloom`, with their files in place. | `bowerloom ls` |
| `MIGRATE_ITEM_UNSUPPORTED` | A store item holds only md, txt, json, yaml, yml, csv, and license files, within the size limits. | `bowerloom help store` |
| `MIGRATE_ID_EXISTS` | Bowerloom never overwrites a store item, so an item with the same id and other bytes cannot move. | Rename the project item, or remove the store item yourself. For a store record whose files are gone, run `bowerloom receipt clean --global`. |
| `MIGRATE_RESERVED` | Setup made these items for this project, so they stay in it. | `bowerloom store migrate --all` skips them. |
| `MIGRATE_TEAM_MISSING` | The store keeps the team tag, so that team must be in the store. | Add `--team <name>` to move that team too. |
| `MIGRATE_LIMIT` | This beta keeps the store record small: 512 items and 1 MiB at most. | Remove items from the store, or move fewer items. |

These codes come from `bowerloom cache prune`. It also raises `STALE_APPROVAL`, `PROJECT_LOCK_UNAVAILABLE`, `STORE_STATE_NESTED`, and `SKILLS_STATE_UNSAFE`.

| Code | Meaning | Next action |
| --- | --- | --- |
| `CACHE_ENTRY_NOT_FOUND` | `cache prune --entry` deletes only an entry that `cache list` shows, so the text must start one of its ids. | `bowerloom cache list` |
| `CACHE_ENTRY_BUSY` | Bowerloom never deletes an entry while another command holds it. An owner lock older than a day does not count. | When the other command is done, run this one again. |
| `CACHE_PRUNE_FAILED` | Bowerloom deletes only private folders of this user, one at a time, and stops at the first one it cannot delete. | Run `bowerloom cache list`, then run the command again without `--approve`. The message names the folder, the step, and how many entries were deleted. If it gives a `chmod` line, run that first. |

## Lock refusals

`bowerloom.lock.json` records where each store item of a project comes from. Without a token, GitHub allows about 60 requests an hour. Each item takes about 4 plus one per file.

| Code | Meaning | Next action |
| --- | --- | --- |
| `LOCK_MISSING` | A frozen install needs `bowerloom.lock.json`, and there is none. | `bowerloom lock update` on a machine with the store. |
| `LOCK_INVALID` | Bowerloom reads the lock strictly, so a hand edit or a merge conflict can break it. | `bowerloom lock verify`. For a merge conflict, take one side for each item, then run it. |
| `LOCK_UNSAFE` | Bowerloom will not trust a lock file that links or other users can change. | `ls -l bowerloom.lock.json` |
| `LOCK_LIMIT` | This beta keeps the lock small: 128 skills, 128 prompts, 32 teams, and 4 MiB at most. | `bowerloom lock verify` |
| `LOCK_CONFIG_MISSING` | A lock and a config go together, and one of them is missing. | `bowerloom use skill <id>`, or restore `bowerloom.json` from version control. |
| `LOCK_CONFIG_MISMATCH` | A frozen install must match `bowerloom.json` exactly, as `npm ci` does. | `bowerloom lock update` |
| `LOCK_HASH_MISMATCH` | Bowerloom installs only bytes that match the lock, so it stopped before any change to the project. | `bowerloom lock verify`, then ask the owner of the store to run `bowerloom lock update`. |
| `LOCK_STORE_NOT_PUSHED` | A teammate can fetch only what you pushed, and your store differs from the pushed copy. | Commit and push the store, then run the command again. |
| `LOCK_COMMIT_UNREACHABLE` | The lock needs a commit that GitHub has, and GitHub does not have this one. | Push the store, or pass `--commit <sha>` of a pushed commit. |
| `LOCK_WRITE_UNCONFIRMED` | `bowerloom.lock.json` was written, but it changed again before Bowerloom could read it back. | `git diff bowerloom.lock.json` |
| `GITHUB_RATE_LIMITED` | GitHub allows about 60 requests an hour without a token and about 5,000 with one. It also limits bursts of requests, and a 403 answer can say so. | Wait until the limit resets, at most an hour. Without a token, set `BOWERLOOM_GITHUB_TOKEN` to raise the limit. |
| `GITHUB_REQUEST_FAILED` | GitHub answered with an error status, so Bowerloom stopped before any change to the project. The message names the status. | Run the command again later. If the status is 401 or 403, make sure that the store repository is public. If this is your store repository, set `BOWERLOOM_GITHUB_TOKEN`. |
| `GITHUB_REQUEST_BUDGET` | A lock this large needs several runs or a smaller selection. One run makes at most 1,000 GitHub requests. | `bowerloom lock verify` |
| `STORE_ITEM_GONE_AT_COMMIT` | The lock names a store commit that does not hold this item, so Bowerloom cannot install it. | `bowerloom lock verify`, then ask the owner of the store to run `bowerloom lock update`. |

## Skills and sync refusals

| Code | Meaning | Next action |
| --- | --- | --- |
| `MANIFEST_NOT_FOUND` | There is no `skills.json` to check yet. | Run `bowerloom skills add npm:<package>@<version>:<path>`. |
| `MANIFEST_INVALID` | Bowerloom reads `skills.json` strictly, so a hand edit can break it. | Run `git diff .bowerloom/skills.json`. |
| `MANIFEST_UNSAFE` | Bowerloom does not trust a `skills.json` that other people or links can change. | Run `ls -l .bowerloom/skills.json`. |
| `MANIFEST_WRITE_UNCONFIRMED` | `skills.json` was written, but it changed again before Bowerloom read it back. | Check it, then run `bowerloom skills check`. |
| `MANIFEST_PIN_NOT_EXACT` | A pin that can move installs different files on different machines. | Run `bowerloom help skills`. |
| `MANIFEST_LICENSE_UNSUPPORTED` | This beta installs MIT and Apache-2.0 skills only. | Choose another skill. |
| `MANIFEST_DUPLICATE_ID` | Each skill needs its own id. | Run `git diff .bowerloom/skills.json`. |
| `MANIFEST_LIMIT` | `skills.json` holds at most 128 skills, local and pinned together, and 1 MiB. The store `skills.json` holds at most 256 skills and 4 MiB. | Run `bowerloom skills check`. |
| `SKILLS_ADD_SPEC_INVALID` | The source names a package or repository, an exact pin, and the skill folder. | Run `bowerloom help skills`. |
| `SKILLS_ADD_EXISTS` | `skills.json` already holds a skill with this id or this source. | To move that id to another version or commit, add `--replace`: `bowerloom skills add <source> --id <id> --replace`. |
| `SKILLS_ADD_SOURCE_CHANGED` | `--replace` keeps the npm package or GitHub repository and moves only its version or commit. | Add the other source under a new id. |
| `SKILLS_ADD_REPLACE_MISSING` | There is no skill with this id to replace. | Run `bowerloom skills check`. |
| `SKILLS_ADD_NOT_FOUND` | The package name, version, commit, or folder was not found. | Check each. |
| `SKILLS_ADD_SKILL_MISSING` | A skill folder holds a `SKILL.md` file at its top. | Check the folder. |
| `SKILLS_ADD_LICENSE_UNKNOWN` | This beta installs a skill only when its MIT or Apache-2.0 license ships with it. | Choose another skill. |
| `SKILLS_ADD_FRONTMATTER` | The SKILL.md frontmatter has a key or a value Bowerloom does not accept. It accepts `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` and `argument-hint`. | Choose another skill. |
| `SKILLS_ADD_UNSAFE_CONTENT` | Skills here are text files only, and nothing in them is run. | Choose another skill. |
| `SKILLS_ADD_NETWORK` | The fetch failed. Nothing changed. | Run the same command again. |
| `SKILLS_ADD_HOST_REFUSED` | Bowerloom asked no other host than `registry.npmjs.org` or `api.github.com`. Nothing changed. | Run `bowerloom help skills`. |
| `SKILLS_OFFLINE` | `--offline` found a pin that needs a fetch. Nothing changed in the project. | Run `bowerloom skills sync` without `--offline`. |
| `SKILLS_SYNC_CONTENT_MISMATCH` | Fetched bytes do not match the pin. Bowerloom stopped before any change to the project. | Run `bowerloom skills check`. |
| `SKILLS_SYNC_INTERRUPTED` | Every skill it finished is complete, and the rest are untouched. | Run `bowerloom skills sync`. |
| `SKILLS_SYNC_LIMIT` | A sync handles at most 256 skills at once. | Run `bowerloom skills check`. |
| `SKILLS_CACHE_RECOVERY_REQUIRED` | The private cache needs a look before this pin can be read. | Run `bowerloom help advanced`. |
| `SKILLS_PROJECT_UNSAFE` | The project folder, or a folder above it, can be changed by other users or has special mode bits. A shared folder such as `/tmp` is refused. The message names the folder. | Move the project into your home folder, then run the command again. |
| `SKILLS_STATE_UNSAFE` | The private state folder is not one that only you can change. | Check `$XDG_STATE_HOME/bowerloom` when `XDG_STATE_HOME` is set, else `~/.local/state/bowerloom`. |
| `SKILLS_STATE_STRAY_ENTRY` | The private state folder holds an entry Bowerloom did not make. | Move the named entry out with `mv`. |
| `SKILLS_RECOVER_NOTHING` | Nothing of this item is unfinished. | Run `bowerloom status`. |
| `SKILLS_MIGRATE_NOTHING` | The project has no `.bowerloom-skills` folder. | Run `bowerloom skills sync`. |
| `SKILLS_MIGRATE_STATE_INVALID` | Migrate needs the private state folder the earlier install was made with. | Run `bowerloom help skills`. |
| `SKILLS_MIGRATE_NOT_IN_MANIFEST` | `skills.json` must pin the installed skill before it can be migrated. | Run `bowerloom skills check`. |
| `MANAGED_SKILL_LEGACY_PRESENT` | Skills from an earlier Bowerloom must be migrated before sync can manage this project. | Run `bowerloom skills migrate plan --state <earlier-state-folder>`. |
| `MANAGED_SKILL_RECOVERY_REQUIRED` | A change was interrupted inside one skill. Bowerloom changes nothing else until it is recovered. | Run `bowerloom skills recover plan --item <id>`. |
| `MANAGED_SKILL_LOCAL_DRIFT` | You changed a copy. Bowerloom never overwrites it. | Undo the edit, then run `bowerloom skills sync`. |
| `MANAGED_SKILL_PATH_OCCUPIED` | Something Bowerloom did not install is where a copy goes. | Move it, then run `bowerloom skills sync`. |
| `MANAGED_SKILL_LOCK_SLOT_COLLISION` | Bowerloom holds its project lock on a local port on `127.0.0.1`, and it checks the lock by connecting to that port. The check failed. Another program may listen on the port, or a sandbox may block Bowerloom from connecting to `localhost`. Nothing of the named skill changed. In this beta the message does not name the port, and the terminal `Next:` line shows `<port>` as written. | If an agent sandbox runs Bowerloom, run Bowerloom outside it, as [Agent sandboxes](/docs/troubleshooting/#agent-sandboxes) says. Otherwise list the programs that listen with `lsof -nP -iTCP -sTCP:LISTEN`. Then run `bowerloom skills sync` again. |
| `MANAGED_SKILL_HISTORY_FULL` | A skill has 64 operations in its private history. Bowerloom deletes no history by itself. | Follow the `Next:` line: move the older `op-<key>` folders out with `mv`, then run the command again. |
| `APPLY_NAME_COLLISION` | Bowerloom never overwrites what it did not install, and two items cannot share one place. | Run `bowerloom apply` after you resolve it. |
| `PROMPT_INVALID` | Bowerloom reads only plain prompt files you own. | Run `ls -l .bowerloom/prompts`. |
| `AGENT_INVALID` | Bowerloom copies only agent files it can check. The file holds only that agent back. | Follow the `Next:` line, fix the file, then run `bowerloom apply`. |
| `AGENT_KEY_UNKNOWN` | Bowerloom accepts only the documented subagent keys. The file holds only that agent back. | Remove the key the `Next:` line names, then run `bowerloom apply`. |
| `AGENT_NAME_MISMATCH` | The name becomes the file name in `.claude/agents`. The file holds only that agent back. | Make the `name` key equal the file name, then run `bowerloom apply`. |
| `AGENT_LIMIT` | This beta applies at most 128 agents. Nothing was changed. | Remove agent files until 128 or fewer remain, then run `bowerloom apply`. |
| `APPLY_AGENT_DUPLICATE` | Each agent name goes to one file in `.claude/agents`. Both agents are held back. | Rename or remove one of the two files the `Next:` line names, then run `bowerloom apply`. |
| `APPLY_AGENTS_FOLDER_UNSAFE` | Bowerloom writes agents only into a real folder that only you can change. Nothing was changed. | Run `ls -ld .claude .claude/agents`. Replace a link with a folder, and remove group and world write access. |
| `AGENT_GRANT_REVIEW_REQUIRED` | Bypass permissions, hooks, and MCP servers change what Claude Code lets the agent do. The agent is held back until you allow it. | Read the agent file, then run `bowerloom apply --allow-agent <role>:<hash>` in a terminal. The plan's `Next:` line says to allow it from a terminal. At a terminal, the shown text carries the exact flag. |
| `AGENT_TEAM_UNREGISTERED` | Bowerloom applies agents only from teams it created or adopted. The agent is held back. | Run `bowerloom team create`, or move the agent into a registered team. |
| `AGENT_TARGET_OCCUPIED` | Bowerloom never overwrites what it did not install. The agent is held back. | Move the file the `Next:` line names aside, then run `bowerloom apply`. |

## Context slice refusals

A hold keeps one slice or one agent back, and the rest of `apply` goes on. A refusal stops one command. A guard code is a reason in the deny line that `bowerloom-guard` prints, or the text on its standard error. [Context slices for agents](/docs/guides/context-slices/) explains each case.

| Code | Meaning | Next action |
| --- | --- | --- |
| `SLICE_INVALID` | Bowerloom builds an index only from slice files it can check. The slice is held back. | Follow the `Next:` line, fix the file named in `.bowerloom/slices`, then run `bowerloom apply`. |
| `SLICE_KEY_UNKNOWN` | Bowerloom accepts only the documented slice keys. The slice is held back. | Remove the key the `Next:` line names, then run `bowerloom apply`. |
| `SLICE_NAME_INVALID` | The id becomes a file name and a skill name, so it is kept plain: lower-case words joined by single hyphens, at most 57 characters, not starting with `prompt-`. | Choose another id, or run `bowerloom help context`. |
| `SLICE_EXISTS` | Each slice needs its own id and its own skill name. The project already has a slice with that id, a file that differs only in case, or a skill `slice-<id>`. | Run `bowerloom ls slices`. |
| `SLICE_LIMIT` | This beta applies at most 64 slices. Nothing was changed. | Run `bowerloom ls slices`, then remove slices. |
| `SLICE_PATH_MISSING` | The folder or the file that a slice names is gone. The slice is held back and an installed index stays. | Fix the path in the slice file, or restore the file, then run `bowerloom apply`. |
| `SLICE_ROOT_MISSING` | A registered folder is not recorded in your store, the store is absent, or its folder is gone. A registered folder must be recorded in your store and must exist. The slice is held back and an installed index stays. | Run `bowerloom folder list`, or register the folder with `bowerloom folder add <folder-name> <path>`, then run `bowerloom apply`. |
| `SLICE_ROOT_UNSAFE` | The root or a folder above it is a link, is not yours, other users can write in it, or a folder record or grant is not valid. A registered root inside the project, one that is or holds the private state folder, one that the managed path rule rejects, and a store that cannot be read are held too. The slice is held back. | Run `ls -ld <folder>`, or follow the `Next:` line, which names the project root to use. |
| `SLICE_SOURCE_UNSAFE` | A selected file or a folder on its path is a link, has more than one link, is not yours, can be written by others, or two names differ only in case. The slice is held back. | Run `ls -l <path>`. |
| `SLICE_EMPTY` | The slice selects no file, and an empty index would give an agent nothing. The slice is held back. | Widen `include`, then run `bowerloom apply`. |
| `SLICE_TOO_LARGE` | The slice selects more than `maxFiles` files, reads more than 32 MiB, walks more than 8,192 entries or 16 levels, or its index passes 64 KiB. The slice is held back. | Narrow the slice, or set `summary: none`, then run `bowerloom apply`. |
| `SLICE_TARGET_OCCUPIED` | Something Bowerloom did not install is where a slice index goes. The slice is held back. | Move `.claude/skills/slice-<id>` aside, then run `bowerloom apply`. |
| `AGENT_GUARD_CONFLICT` | An agent's `hooks` is not a map, or its `hooks.PreToolUse` is not a list, so the read guard cannot be added. The agent is held back. | Make `hooks` a map and `hooks.PreToolUse` a list, then run `bowerloom apply`. |
| `AGENT_GUARD_WORKTREE` | A guarded agent that sets `isolation: worktree` runs in a git worktree, which holds its own copies of every tracked file outside the guarded folders. The agent is held back. | Remove `isolation: worktree` or the agent's slices, then run `bowerloom apply`. |
| `CONTEXT_SLICE_NOT_FOUND` | `context show` names a slice that this project does not register. | Run `bowerloom ls slices`. |
| `CONTEXT_AGENT_NOT_FOUND` | `--agent` or `--explain` names a role that no team of this project holds. | Run `bowerloom ls teams`. |
| `CONTEXT_BASELINE_INVALID` | The `--baseline` folder does not exist or is not safe to read. The baseline must be a folder you own. | Run `bowerloom help context`. |
| `CONTEXT_MEASURE_LIMIT` | The baseline folder holds more than 100,000 entries, the most this beta measures. | Pass a narrower `--baseline`. |
| `GUARD_OUTSIDE_SLICE` | The read guard blocked a Read, Grep, or Glob that reaches a file under a guarded folder when no slice of the agent lists it. | Run `bowerloom context show <slice>`. To widen a slice, edit its file and run `bowerloom apply`. |
| `GUARD_SLICE_NOT_INSTALLED` | A slice of the agent is not installed, or its catalog changed. The guard blocked every call. | Run `bowerloom apply`. |
| `GUARD_ROOT_MISSING` | The folder of a slice cannot be found, or it changed since `apply`. The guard blocked every call. | Run `bowerloom apply`. |
| `GUARD_PROJECT_MISMATCH` | The project path or id in the agent copy matches no project that manages the agent. The guard blocked every call. | Run `bowerloom apply` in the project that holds `.claude/agents/<role>.md`. |
| `GUARD_INTERNAL_ERROR` | The guard met an error it did not expect, such as a folder it may not read, a link loop, or a name that is too long. It blocked the call. | Run `claude --debug`, then `bowerloom apply`. |
| `FOLDER_NAME_INVALID` | A folder name is lower-case letters and digits in words joined by single hyphens, at most 64 characters. The name becomes a file name in your store. | Run `bowerloom help context`. |
| `FOLDER_EXISTS` | Your store already has a folder with that name, or one that differs only in case. Each registered folder needs its own name. | Run `bowerloom folder list`. |
| `FOLDER_NOT_FOUND` | The store or the record is absent. Only a registered folder can be used or removed. | Run `bowerloom folder list`. |
| `FOLDER_UNSAFE` | The folder is missing, is not below your home folder, is your home folder, is a link, is not yours, can be written by others, has a hidden segment, touches the store, or its record is not a plain file. Bowerloom reads only folders that you own and that no other user can change. | Run `ls -ld <folder>`. |
| `FOLDER_IN_CLOUD` | The folder is in an iCloud or cloud-synced folder. Cloud sync changes file times and moves files, which breaks the checks that keep a folder safe. | Move the folder, for example `mv <folder> ~/Projects/`. |
| `FOLDER_NOT_ALLOWED` | This project is not allowed to read registered folder `<name>`. A registered folder is shared with the projects you allow, one by one. A slice that names it is held back, and `folder deny` refuses when the project has no grant. | Run `bowerloom folder allow <folder-name>` inside the project. |
| `FOLDER_INVALID` | A folder record in your store has wrong content. Bowerloom reads folder records strictly, so a hand edit can break one. | Run `bowerloom folder list`. |
| `GUARD_INPUT_INVALID` | The hook input from Claude Code could not be read. The guard blocked the call and exited 2. | Run `claude --debug`. |

## Request-file skills refusals

The request-file `bowerloom skills source`, `skills plan`, `skills update`, `skills apply`, and `skills inspect` forms print one line of JSON on standard error. A refusal exits 1. A usage error exits 2. [CLI reference](/docs/cli/#skills) lists the forms.

| Code | Trigger and meaning | Preserve and next action |
| --- | --- | --- |
| `USAGE` | The command form is not valid. Exit 2. | Read help. Use the exact form. |
| `SKILLS_RECORD` | A request or plan record is not valid. | Keep the record. Fix it and plan again. |
| `SKILLS_CHANGED` | The record or its directory changed. | Inspect the record and its directory. Plan again. |
| `SKILLS_OUTPUT` | The command could not write its result. | Inspect the output path. Do not assume a write happened. |
| `SKILLS_INTERRUPTED_UNCERTAIN` | A signal or the 35-second limit stopped the command. | Inspect before another write. |
| `SKILLS_REFUSED` | The command stopped for a known reason. The message names the reason in parentheses, such as `NPM_CACHE_DIRECTORY` or `GIT_TREE_BOUND`. | Keep the error. Inspect the cache and installation records. |
| `SKILLS_UNCERTAIN` | The cache state is not certain. The message names two codes. | Run `skills source inspect`, then `skills source recover plan`, before another action. |
| `SKILLS_UNCERTAIN` with `_CACHE_OPEN_PARTIAL` | Recovery cannot read the operation folder. | Start again with a new `SOURCE_OPERATION`. |

Installation commands name these reasons in parentheses, in the message of a `SKILLS_REFUSED` error:

| Code in parentheses | Meaning | Preserve and next action |
| --- | --- | --- |
| `MANAGED_SKILL_STALE_APPROVAL` | The approved revision no longer matches the plan. | Plan again and obtain new approval. |
| `MANAGED_SKILL_LOCAL_DRIFT` | Someone edited an installed file. | Keep the edit. Inspect before you plan again. |
| `MANAGED_SKILL_RECOVERY_REQUIRED` | An earlier installation needs recovery. | Run `skills recover plan`. |
| `MANAGED_SKILL_LOCKED` | Another command holds the installation. | Wait, then plan again. |
| `MANAGED_SKILL_TIMEOUT` | The command ran past its time limit. | Inspect before you plan again. |
| `MANAGED_SKILL_ABORTED` | The command stopped early. | Inspect before you plan again. |
| `MANAGED_SKILL_REFUSED` | The general installation refusal. It also covers cache or receipt drift. | Inspect the cache and installation. Do not overwrite local files. |

For example, a wrong approval printed this line on standard error in the test run for this release, and exited 1:

```text
{"error":{"code":"SKILLS_REFUSED","message":"The skills command stopped (MANAGED_SKILL_STALE_APPROVAL). Inspect the exact local cache and operation records before another action; no native execution authority is granted."}}
```

## Stop results

| Result | Meaning | Next action |
| --- | --- | --- |
| `NOT_RUNNING` | No execution started, or previous execution finished. | Report this actual scope. |
| `STOPPED` | The original registered owner acknowledged cleanup. | Retain the owner's result. |
| `STOP_UNCONFIRMED` | Cleanup remains unconfirmed. | Preserve records and inspect the original owner. |

A timeout does not establish cleanup. [Stop registered work](/docs/stop/) explains registry scope.

## Other subsystem errors

Connection, harness, backend, recipe, and runtime commands have separate boundaries. A harness is an agent application, such as Claude Code or Codex. Read the exact subsystem output and its reference prerequisites.

A refused operation does not authorize an older or less restricted path. Use [Troubleshooting](/docs/troubleshooting/) for the next supported inspection.
