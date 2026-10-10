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

`bowerloom status` in a project folder reports `ready`, `drifted`, or `revision-pending` in `Setup:`. With `--json` it also reports `specReady`, `runtimeReady`, `executionAuthorized`, `revision`, `drift`, and `owned`. `runtimeReady` and `executionAuthorized` are false. Read [CLI reference](/docs/cli/#project-commands).

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
| `STALE_APPROVAL` | The plan changed after you saw it. Nothing was applied. | Run the command again without `--approve` to see the new plan. |
| `WORKERS_HELD` | The project is prepared. No worker was started. Exit 4. | Run `bowerloom status`. |
| `PROJECT_NOT_FOUND` | Bowerloom looked in this folder and every parent up to your home folder. | Run `bowerloom up --team <name> --goal <goal>` in the project folder. |
| `PROJECT_ROOT_REFUSED` | A whole disk or home folder is too broad to be a project. | Change into the project folder. |
| `PROJECT_IN_CLOUD_FOLDER` | The project is under `~/Documents` or `~/Desktop` with Desktop and Documents sync on, or under a `~/Library` cloud folder. Cloud sync changes file times and moves files, which breaks the checks that keep a project safe. | Move the project, for example `mv <project-folder> ~/Projects/`. |
| `PROJECT_UNSAFE` | Bowerloom does not trust a `.bowerloom` folder that other people or links can change. | Run `ls -ld .bowerloom`. |
| `PROJECT_UNREADABLE` | Bowerloom cannot read a folder on the way to the project. | Run `ls -ld <folder>`. |
| `PROJECT_LOCKED` | Two commands must not change one project at the same time. Nothing changed. | Run `bowerloom status`, then try again. |
| `PROJECT_LOCK_UNAVAILABLE` | The lock uses a local port, and this computer did not give it out. A sandbox that blocks local ports gives this refusal. | Run `bowerloom status`. If an agent sandbox runs Bowerloom, read [Agent sandboxes](/docs/troubleshooting/#agent-sandboxes). |
| `PROJECT_LOCK_SLOT_COLLISION` | The lock uses a local port, and another program is listening on it. | Run `lsof -nP -iTCP:<port> -sTCP:LISTEN`. |
| `PROJECT_BRIEF_INVALID` | A new team is built from the project brief that setup saved, and it cannot be read. On a clone, `bowerloom up --team` and `team create` refuse this way, because `.bowerloom/brief.json` stays on the first machine. | Run `bowerloom status`. On a clone, follow the [teammate steps](/docs/guides/add-skills/#get-the-same-skills-on-another-machine). |
| `INSPECTION_LIMIT` | A `.bowerloom` folder holds too many entries to list. | Reduce the entries. |

Create commands also refuse with `TEAM_EXISTS`, `TEAM_ID_RESERVED`, `TEAM_NAME_INVALID`, `TEAM_NOT_FOUND`, `SKILL_EXISTS`, `SKILL_NAME_RESERVED`, `SKILL_NAME_INVALID`, `PROMPT_EXISTS`, `PROMPT_NAME_INVALID`, `REVISION_PENDING`, `AUTHORING_PENDING`, `AUTHORING_RECEIPT_INVALID`, `AUTHORING_UNSAFE_PATH`, `AUTHORING_UNREGISTERED`, `AUTHORING_WRITE_INTERRUPTED`, and `AUTHORING_ITEM_MISSING`. [Create teams, skills, and prompts](/docs/guides/create-items/#if-a-command-refuses) explains them. `AUTHORING_RECEIPT_INVALID` means Bowerloom reads its record of created items strictly, so a hand edit can break it. Run `git diff .bowerloom/authoring/receipt.json`. `AUTHORING_UNSAFE_PATH` means Bowerloom does not read or write through links, shared files, or files others can change. Run `ls -la .bowerloom`. `AUTHORING_ITEM_MISSING` means a created item is gone. Run `git status .bowerloom`.

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
| `MANIFEST_LIMIT` | `skills.json` holds at most 128 skills, local and pinned together, and 1 MiB. | Run `bowerloom skills check`. |
| `SKILLS_ADD_SPEC_INVALID` | The source names a package or repository, an exact pin, and the skill folder. | Run `bowerloom help skills`. |
| `SKILLS_ADD_EXISTS` | `skills.json` already holds a skill with this id or this source. | To move that id to another version or commit, add `--replace`: `bowerloom skills add <source> --id <id> --replace`. |
| `SKILLS_ADD_SOURCE_CHANGED` | `--replace` keeps the npm package or GitHub repository and moves only its version or commit. | Add the other source under a new id. |
| `SKILLS_ADD_REPLACE_MISSING` | There is no skill with this id to replace. | Run `bowerloom skills check`. |
| `SKILLS_ADD_NOT_FOUND` | The package name, version, commit, or folder was not found. | Check each. |
| `SKILLS_ADD_SKILL_MISSING` | A skill folder holds a `SKILL.md` file at its top. | Check the folder. |
| `SKILLS_ADD_LICENSE_UNKNOWN` | This beta installs a skill only when its MIT or Apache-2.0 license ships with it. | Choose another skill. |
| `SKILLS_ADD_UNSAFE_CONTENT` | Skills here are text files only, and nothing in them is run. | Choose another skill. |
| `SKILLS_ADD_NETWORK` | The fetch failed. Nothing changed. | Run the same command again. |
| `SKILLS_ADD_HOST_REFUSED` | Bowerloom asked no other host than `registry.npmjs.org` or `api.github.com`. Nothing changed. | Run `bowerloom help skills`. |
| `SKILLS_OFFLINE` | `--offline` found a pin that needs a fetch. Nothing changed in the project. | Run `bowerloom skills sync` without `--offline`. |
| `SKILLS_SYNC_CONTENT_MISMATCH` | Fetched bytes do not match the pin. Bowerloom stopped before any change to the project. | Run `bowerloom skills check`. |
| `SKILLS_SYNC_INTERRUPTED` | Every skill it finished is complete, and the rest are untouched. | Run `bowerloom skills sync`. |
| `SKILLS_SYNC_LIMIT` | A sync handles at most 256 skills at once. | Run `bowerloom skills check`. |
| `SKILLS_CACHE_RECOVERY_REQUIRED` | The private cache needs a look before this pin can be read. | Run `bowerloom help advanced`. |
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
