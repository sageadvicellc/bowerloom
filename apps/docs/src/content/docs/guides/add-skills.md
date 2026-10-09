---
title: "Add third-party skills to a project"
description: "Pin skills from npm or GitHub, approve each step, sync them, and apply them for Claude Code and Codex."
section: "Guides"
order: 7.5
---

Bowerloom governs every file that a third-party skill adds to your project. Every step shows a plan first, and nothing is written until you approve that exact plan. Every skill is pinned to an exact npm version or a full Git commit, so each machine gets the same bytes. Bowerloom installs only MIT and Apache-2.0 skills, and only when the license ships with the skill. It copies text files and runs nothing. No worker starts.

Three commands carry the work. `skills add` records a pin in `.bowerloom/skills.json`. `skills sync` installs the pinned skills on this machine and copies them into place for Claude Code and Codex. `apply` puts the prompts in place, and it places any skill copy that is still missing. It never fetches.

This guide uses two public skills. The first is `collections` from `@tanstack/db-skills@0.0.1`, an npm package. Its native name is `tanstack-db-collections`. The selection holds `SKILL.md`, five reference files, and the package `LICENSE` file, which is MIT. It totals seven files and 37,953 bytes. The second is `verification-loop` from ECC, the public GitHub repository `affaan-m/ecc`, pinned to one full commit. Its selection holds `SKILL.md` and the repository `LICENSE` file, which is MIT.

## Before you start

Install Bowerloom from the private archive. [Install Bowerloom](/docs/start/) lists the Node requirement, the global npm prefix steps, and the first `bowerloom up` run.

Run these commands in a project folder that holds `.bowerloom`. Run `bowerloom up --team <name> --goal <goal>` first if it does not. Keep the folder out of iCloud Drive. A project under `~/Documents` or `~/Desktop` with Desktop and Documents sync on, or under a `~/Library` cloud folder, refuses with `PROJECT_IN_CLOUD_FOLDER`. [Errors](/docs/reference/errors/#project-and-approval-refusals) shows the fix.

Use public skills. The npm route reads only `registry.npmjs.org`. The Git route reads only the public GitHub API, `api.github.com`, without credentials. Private registries and private repositories are not supported in this beta.

## What stays under your control

- You choose the exact package version or the full 40-character Git commit. `skills add` refuses `latest`, a range, a branch, a tag, and a short commit before it fetches anything.
- You read the plan before any write. The plan names the source, the skill folder, the license, the file count, and the teams.
- You approve with `--approve <revision>`. A changed plan has a new revision, and the old approval refuses with `STALE_APPROVAL`.
- Bowerloom checks every fetched byte against its pin before it installs a file. A mismatch refuses with `SKILLS_SYNC_CONTENT_MISMATCH` and changes nothing in the project.
- Bowerloom accepts only MIT and Apache-2.0 skills. Another license refuses with `MANIFEST_LICENSE_UNSUPPORTED` or `SKILLS_ADD_LICENSE_UNKNOWN`.
- Skills are text files only. Bowerloom runs nothing in them, and adding a skill does not run it. Review runtime permissions before you ask your harness to use a skill. A harness is the agent application that reads the skill, such as Claude Code or Codex.
- `apply` and `sync` never overwrite a copy you changed, and they remove nothing.

## Ask your agent

```text
Add the collections skill from @tanstack/db-skills@0.0.1 and the verification-loop skill from affaan-m/ecc at commit d29cf651c795869f733669c33e3d33dfd8307d10 to this Bowerloom project. Run each command without --approve first, read the plan, and show it to me. Wait for my approval of each plan, then run the same command with that revision. Run skills sync, then apply. Report the result of each step. Do not edit AGENTS.md or CLAUDE.md, do not run the skills, and do not start workers.
```

## Agent procedure

When this guide does not answer a question, run `bowerloom help skills`. It lists every skills form and option, and it reads only.

### Add the pins

Add the npm skill. `--id` names the entry:

```sh
bowerloom skills add npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections --id collections
```

The command reads the package metadata and the package archive from `registry.npmjs.org`. It selects the skill folder and the package license file from that archive. It then prints the plan and exits 3. Add `--json` to get the plan as one JSON object, with the code `APPROVAL_REQUIRED` and the revision. In a trial run of this release, the plan read:

```text
Add skill collections to .bowerloom/skills.json
  Source: npm @tanstack/db-skills 0.0.1, folder skills/tanstack-db/collections
  Skill name: tanstack-db-collections
  License: MIT (LICENSE)
  Files: 7
  Teams: every team
  skills.json: a new file
This records the pin only. Nothing is installed or run.
Revision: e4c0e12968b83e9e86dfd964496624507af8f47fc8ffe9e4b28c207be0b7315b
Approval required. Run the same command again with --approve e4c0e12968b83e9e86dfd964496624507af8f47fc8ffe9e4b28c207be0b7315b
```

Show the plan to the human. Read the license line and the file count. After approval, run the same command with the revision:

```sh
bowerloom skills add npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections --id collections --approve REVISION_FROM_THE_PLAN
```

The command reads the same two files again, records the pin in `.bowerloom/skills.json`, and exits 0.

Add the Git skill the same way. The repository name is lower case. The commit is 40 lower-case hex characters:

```sh
bowerloom skills add github:affaan-m/ecc@d29cf651c795869f733669c33e3d33dfd8307d10:skills/verification-loop --id verification-loop
```

The Git route reads through `api.github.com`. It reads the commit, the folder listings on the path to the skill, and each selected file. It reads no other file. In this example, the selected files are `SKILL.md` and the `LICENSE` file at the top of the repository. Approve and run it again with `--approve`, as above. Without `--id`, the entry id is the skill name.

By default every team gets the skill. Pass `--team <team>` once for each team that gets it. A team must exist, or the command refuses with `TEAM_NOT_FOUND`.

`skills add` refuses an id that `skills.json` already holds (`SKILLS_ADD_EXISTS`). To move that id to a newer version or commit, add `--replace`. [Move a skill to a newer pin](#move-a-skill-to-a-newer-pin) shows how. `skills add` records the pin only. Nothing is installed yet.

### Check the pins

```sh
bowerloom skills check
```

`skills check` reads `.bowerloom/skills.json` and checks every pin offline. It writes nothing. It prints the count of skills and the harnesses, then one line per skill, shown as the id, the source kind, and the pin. With only the TanStack pin, it printed this text in the test run for this release:

```text
skills.json is valid: 1 skill, for Claude Code and Codex.
  collections  npm @tanstack/db-skills@0.0.1:skills/tanstack-db/collections
```

Add `--json` for one machine-readable object.

### Sync the skills

```sh
bowerloom skills sync
```

`skills sync` reads `skills.json` and prints a plan. Each skill shows what sync does with it. A skill that needs a fetch shows its host. The plan ends with a revision and exit 3.

In the test run for this release, a teammate project received a `skills.json` that pins `verification-loop` at a later commit. `bowerloom up --team "Studio crew"` then showed this sync step:

```text
Next step: sync. Install the skills of team Studio crew on this machine.
Sync skills from .bowerloom/skills.json for Claude Code and Codex, team first-team
  verification-loop  install git affaan-m/ecc@ef648e01899ba3e8dc6371642deaaf64b4477775:skills/verification-loop, fetched from api.github.com
Network: reads api.github.com for 1 skill, public and without credentials. Bytes must match their pins.
Private state: ~/.local/state/bowerloom/bdf8c073f8b7f31a72b8014d900edc27 (new folders get mode 0700)
Copies go to .bowerloom/managed, .claude/skills and .agents/skills, and stay on this machine. Commit .bowerloom/skills.json and your own skills.
This copies text files only. It starts no workers and runs nothing.
Revision: 1180cef330b62e1b90f22b9e5e513e07e26db22b05ce10bb9382afbfc20220b5
Approval required. Run the same command again with --approve 1180cef330b62e1b90f22b9e5e513e07e26db22b05ce10bb9382afbfc20220b5
```

Bowerloom prints full paths. This example shows the home folder as `~`. `first-team` is the id of the team named Studio crew. A direct `bowerloom skills sync` prints the same plan without the `Next step:` line and without the team.

Show the plan. After approval, run the same command with the revision:

```sh
bowerloom skills sync --approve REVISION_FROM_THE_PLAN
```

The result names what sync did with each skill. For the TanStack skill, the test run printed this text:

```text
Applied plan 2bf293ff8c60a9ea41fa0cfcb25800ad0f20b3f242330f298e88e966d5a2434d.
  collections: installed
```

After the pin moved to a later commit, the same step reported `verification-loop: updated`.

Sync writes three things. In the project, it writes the managed copy in `.bowerloom/managed` and a copy for each harness in `.claude/skills` and `.agents/skills`. Outside the project, it keeps its fetch cache and its records in a private state folder, `~/.local/state/bowerloom/<project id>`. Set `XDG_STATE_HOME` to an absolute path to move that folder to `$XDG_STATE_HOME/bowerloom/<project id>`. Each project has its own folder there, so the cache is not shared between projects. Sync fetches only pins that the cache does not hold yet.

Use `--offline` on a machine with no network or when you want no fetch. With `--offline`, sync refuses before any change if a pin still needs fetching (`SKILLS_OFFLINE`). Use `--team <team>` to sync only that team's skills.

If nothing needs a change, sync prints its plan and `Nothing to change.` and exits 0.

A skill whose copy you changed is held. The result shows `held (MANAGED_SKILL_LOCAL_DRIFT)` and a `Next:` line. The other skills apply. Press Ctrl-C once to stop between two skills. Press it twice to stop at once. A second Ctrl-C during a change names the item to recover with `skills recover`.

### Apply the skills

`skills sync` already copies each skill into `.bowerloom/managed`, `.claude/skills`, and `.agents/skills`. So after a sync, `apply` has no skill left to place. Run `apply` when the project has prompts in `.bowerloom/prompts`, because sync places skills only. `apply` also places any skill copy that is still missing.

```sh
bowerloom apply
```

`apply` puts the prompts in `.bowerloom/prompts` in place, and any skill copy from `.bowerloom/skills.json` that is still missing. It works from what this machine already holds and never fetches. A pin that is not cached yet refuses until `skills sync` fetches it. The default harness is both. Pass `--harness claude` or `--harness codex` for one.

Skills go to `.claude/skills` and `.agents/skills`. A prompt becomes the Claude Code command `.claude/commands/<name>.md` and the Codex skill `.agents/skills/prompt-<name>`. These copies stay on this machine.

When there is something to place, `apply` shows a plan and exits 3. When every copy is already in place, it prints its plan and `Nothing to change.` and exits 0. In the test runs for this release, `apply` right after `skills sync` printed `Nothing to change.`, because those projects had no prompt to place. The plan shows a note for each prompt that grants tools with `allowed-tools`, registers hooks, or runs shell commands. A shell command is a line that starts with `!`, text that holds `` !` ``, or a fence opened with ` ```! `. Read that prompt before you approve. Then apply:

```sh
bowerloom apply --approve REVISION_FROM_THE_PLAN
```

`apply` never edits `AGENTS.md` or `CLAUDE.md`. It prints a line for you to add yourself. This is the text from the test run:

```text
Bowerloom never edits AGENTS.md or CLAUDE.md. To point your agents at these copies, add a line like this to AGENTS.md and CLAUDE.md yourself:
  Project skills are in .claude/skills and .agents/skills. Prompts are Claude Code commands in .claude/commands, and Codex skills named prompt-<name>.
```

Show the line to the human. Add it to `AGENTS.md` and `CLAUDE.md` only after the human approves.

`bowerloom up --team <name>` runs `sync` and `apply` for you, one approved step at a time. On a clone, `bowerloom up --team <name>` and `team create` refuse with `PROJECT_BRIEF_INVALID` in this beta, because they read `.bowerloom/brief.json`, which stays on the first machine. The [teammate steps](#get-the-same-skills-on-another-machine) are the supported path there.

### Check the result

```sh
bowerloom ls skills
bowerloom status
```

`ls skills` lists the skills you authored in `.bowerloom/skills`. `skills check` lists the pinned skills. `status` lists any copy that changed since install. All three read only.

To check that your agent sees a skill, start a new agent session in the project folder. Ask the agent to list the skills it can use, and look for the skill name, such as `tanstack-db-collections`. If the name is missing, the agent did not find the copy. Bowerloom places the files, but it does not prove that a harness finds them.

### Move a skill to a newer pin

To move a skill to a newer version or commit, run `skills add` with the new pin, the same `--id`, and `--replace`. Then run `skills sync`. The source must stay the same npm package or GitHub repository. The entry keeps its teams unless you pass `--team`.

In a trial run of this release, the ECC skill moved from commit `d29cf651c795869f733669c33e3d33dfd8307d10` to `ef648e01899ba3e8dc6371642deaaf64b4477775`:

```sh
bowerloom skills add github:affaan-m/ecc@ef648e01899ba3e8dc6371642deaaf64b4477775:skills/verification-loop --id verification-loop --replace
```

The plan shows the old pin and the new pin, and exits 3:

```text
Replace the pin of skill verification-loop in .bowerloom/skills.json
  Old pin: GitHub affaan-m/ecc at d29cf651c795869f733669c33e3d33dfd8307d10, folder skills/verification-loop
  New pin: GitHub affaan-m/ecc at ef648e01899ba3e8dc6371642deaaf64b4477775, folder skills/verification-loop
  Skill name: verification-loop
  License: MIT (LICENSE)
  Files: 2
  Teams: every team
  skills.json: replaces the file with sha256 f134a9b2e5e7a3dfc085ee64011ad49e38afa1750b3bc13d3455e8f96ebd7aaf
This records the new pin only. Nothing is installed or run. Run bowerloom skills sync to update the installed copies.
Revision: 9c5d61e6fc96ce737e5859b13966228e38500368a5413610d6123d6fb3261aeb
Approval required. Run the same command again with --approve 9c5d61e6fc96ce737e5859b13966228e38500368a5413610d6123d6fb3261aeb
```

After the human approves, run the same command with `--approve` and the revision. Then run `bowerloom skills sync`. Its plan shows `update to affaan-m/ecc@ef648e01899ba3e8dc6371642deaaf64b4477775:skills/verification-loop` for the skill. After approval, the sync result reads `verification-loop: updated`.

## What to commit

Commit `.bowerloom/skills.json`. It holds exact pins only and is its own lock. Commit the team, skill, and prompt definitions too:

- Every team in `.bowerloom/teams/<team id>/`, including `first-team`, which setup makes. Each team holds a copy of the project brief in `assets/brief.json`, with the goal text. The goal is the team's shared purpose. Read the file before you commit it, as you would any file you share.
- Every skill in `.bowerloom/skills/<name>/`, including `personal-assistant`, which setup makes. Its `profile.json` holds the project name.
- Every prompt in `.bowerloom/prompts/<name>.md`.
- `.bowerloom/authoring/receipt.json`, the record of the teams, skills, and prompts that you create.

Everything else stays on each machine. That covers the setup receipt and the setup notes that `bowerloom up` writes, the revision history next to `.bowerloom`, the managed copies in `.bowerloom/managed`, and the projections in `.claude/skills`, `.claude/commands`, and `.agents/skills`. A projection is the copy of a skill or prompt that a harness reads. `.bowerloom/installation-receipt.json` holds absolute paths on your machine. `.bowerloom/brief.json` holds your goal text.

Bowerloom writes a `.gitignore` inside `.bowerloom/managed` only. It does not add the other files to your `.gitignore`. Add these lines to the `.gitignore` at the top of the project yourself:

```text
# Bowerloom files that stay on this machine
.bowerloom/installation-receipt.json
.bowerloom/brief.json
.bowerloom/manifest.json
.bowerloom/startup.json
.bowerloom/startup-review.md
.bowerloom/START-HERE.md
.bowerloom/working-agreement.md
.bowerloom/milestones.md
.bowerloom/optional-controls.md
.bowerloom/managed/
.bowerloom-revision.json
.bowerloom-revision-*/
.claude/skills/
.claude/commands/
.agents/skills/
```

Git then shows `skills.json` and the team, skill, and prompt definitions as files to commit. A teammate's `skills sync` needs only `.bowerloom/skills.json`. In the trial run for this release, the teammate's clone held only that file, and sync and apply worked.

If you keep files of your own in `.claude/skills`, `.claude/commands`, or `.agents/skills`, list only the folders that Bowerloom makes instead, such as `.claude/skills/tanstack-db-collections/`. Each machine rebuilds the same files from the same pins.

### Get the same skills on another machine

A teammate who clones the project gets the pins in `.bowerloom/skills.json`. On the teammate's machine, run these steps in the project folder. They match the trial run for this release.

1. Check the pins offline with `bowerloom skills check`.
2. Plan the sync with `bowerloom skills sync`. Show the plan to the human.
3. After approval, run `bowerloom skills sync --approve REVISION_FROM_THE_PLAN`.
4. Run `bowerloom apply`. It places any prompt or skill copy that is still missing. In the trial, it printed `Nothing to change.`

On a clone, `bowerloom up --team <name>` and `team create` refuse with `PROJECT_BRIEF_INVALID` in this beta, because they read `.bowerloom/brief.json`, which stays on the first machine. These steps are the supported path.

When a teammate changes a pin in `skills.json` and you pull it, `skills sync` shows `update to <pin>` for that skill. You approve the update the same way. To change a pin yourself, see [Move a skill to a newer pin](#move-a-skill-to-a-newer-pin).

## If a command refuses or stops

In a terminal, a refusal prints its code, a plain sentence, and a `Next:` line. Without a terminal, it prints one line of JSON on standard error. A refusal exits 1. A usage error exits 2. Read the code, then follow its `Next:` line. [Errors](/docs/reference/errors/#skills-and-sync-refusals) lists the codes.

After any refusal, run the command again without `--approve` and read the new plan. Show it to the human and approve that plan, not the earlier one. A refusal can change what the next plan holds. For example, a sync that fetched a skill and then refused plans the next run from the cache.

- `SKILLS_ADD_SPEC_INVALID` and `MANIFEST_PIN_NOT_EXACT` mean the source is not an exact pin or a package, repository, and folder. Check the form.
- `SKILLS_ADD_NOT_FOUND` means the package, version, commit, or folder does not exist. Check each.
- `SKILLS_ADD_SKILL_MISSING` means the folder has no `SKILL.md` at its top.
- `SKILLS_ADD_UNSAFE_CONTENT` means a file breaks the plain-text, size, or link rules. Skills here are text files only, and nothing in them is run.
- `SKILLS_ADD_NETWORK` means the fetch failed. Nothing changed. Run the same command again.
- `SKILLS_ADD_HOST_REFUSED` means the source needs a host other than `registry.npmjs.org` or `api.github.com`. Bowerloom asked no other host.
- `SKILLS_ADD_EXISTS` means `skills.json` already holds this id or source. To move the id to a new pin, add `--replace`.
- `MANAGED_SKILL_LOCK_SLOT_COLLISION` means Bowerloom could not confirm its project lock on a local port. Another program may hold the port, or a sandbox may block Bowerloom from connecting to `localhost`. [Agent sandboxes](/docs/troubleshooting/#agent-sandboxes) explains the second case.
- `MANAGED_SKILL_LOCAL_DRIFT` means you changed a copy. Bowerloom never overwrites it. Undo your edit, or copy it into a skill of your own with `bowerloom skill create <name>`, then run `skills sync` again.
- `MANAGED_SKILL_PATH_OCCUPIED` means something Bowerloom did not install is where a copy goes.
- `MANAGED_SKILL_RECOVERY_REQUIRED` means a change stopped inside one skill. Run `bowerloom skills recover plan --item <id>`.
- `MANAGED_SKILL_LEGACY_PRESENT` means an earlier Bowerloom installed skills here. Run `skills migrate`.
- `APPLY_NAME_COLLISION` means two items share one place, or something Bowerloom did not install is there. Bowerloom never overwrites it.

### Recover an unfinished change

```sh
bowerloom skills recover plan --item collections
bowerloom skills recover apply --item collections --approve REVISION_FROM_THE_PLAN
```

`skills recover` finishes or undoes the one unfinished change of an item. `--action resume|rollback|abandon` picks the action. Resume finishes the approved change. Rollback puts back exactly what was there. Abandon ends an operation that never changed the project. The plan form never writes. It changes only that item's copies and its private records.

### Migrate an earlier install

An earlier Bowerloom installed one skill in `.bowerloom-skills`. `status` names it. `skills.json` must pin the same source first. `skills migrate plan --state <earlier-state-folder>` prints the `skills add` command if it does not. The state folder path is absolute.

```sh
bowerloom skills migrate plan --state <earlier-state-folder>
bowerloom skills migrate apply --state <earlier-state-folder> --approve REVISION_FROM_THE_PLAN
```

Migrate reads the earlier state folder and never writes it. It moves `.bowerloom-skills` into a private backup. A rollback puts it back exactly.

## Package your own skills

Keep your own skills in one versioned source. Every project then installs them the same way. Bowerloom pins an exact package version or an exact Git commit, so each install is repeatable and reviewable.

To keep a skill inside one project, use `bowerloom skill create <name>` instead. See [Create teams, skills, and prompts](/docs/guides/create-items/).

### Rules for both routes

- Do not use symlinks. The npm reader refuses a link entry in the archive. The Git reader accepts only regular files and folders.
- Use relative links only, and only to files inside the same skill folder.
- Use the MIT or the Apache-2.0 license, and no other. Include a license file named `LICENSE` or `NOTICE`. Its text must contain "MIT License" or "Apache License".
- Write every other file as `.md`, `.txt`, `.json`, `.yaml`, `.yml`, or `.csv`.
- Start `SKILL.md` with front matter. The allowed keys are `name`, `description`, `license`, `compatibility`, and `metadata`. The `name` must equal the skill name. The `description` is required. If `license` is `MIT` or `Apache-2.0`, it must match the license you ship. The front matter is at most 8 KiB.
- For Git, set every file to mode 100644, with no executable files. Select every file in the skill folder.
- Name the skill with lowercase letters, digits, and single hyphens, up to 64 characters.
- Keep the package working folder out of iCloud Drive.

A selection holds at most 128 files. Each file is at most 65,536 bytes. The whole selection is at most 2,097,152 bytes. `skills.json` holds at most 32 skills and 1 MiB, and one sync handles at most 64.

### Ask your agent to package the skills

```text
Package my skills so that every project can install them from one pinned source. Use the npm route with a skills/<name>/SKILL.md folder for each skill. Add no symlinks. Keep links relative and inside each skill folder. Include a license. Show me the package contents before you publish. Wait for my approval. Do not publish, install, or invoke anything until I approve.
```

### The npm route

Create this layout in a folder that iCloud Drive does not sync:

```text
my-skills/
  package.json
  LICENSE
  skills/
    my-skill/
      SKILL.md
      references/
```

The `package.json` needs `name`, `version`, `files`, and `license`. List `skills` and `LICENSE` in `files`. This is an example. Use your own name and version:

```json
{
  "name": "@my-team/skills",
  "version": "1.0.0",
  "license": "MIT",
  "files": ["skills", "LICENSE"]
}
```

Publish to the public npm registry. The package name is lower case, with an optional lower-case scope. The version is an exact version such as `1.0.0`. A range, `latest`, or a tag does not work. Ask your agent to pack the folder and show the file list before you publish:

```sh
npm pack --dry-run
```

Then add the pin:

```sh
bowerloom skills add npm:@my-team/skills@1.0.0:skills/my-skill
```

To release a change, publish a new exact version and review its content. A teammate then pulls the new pin and runs `skills sync`.

### The Git route

Add a `skills/` folder to a repository you already have. Put each skill at `skills/<name>/SKILL.md`. Add a license file.

Use a public GitHub repository. Write `owner/repo` in lower case. Pin a full commit of 40 lower-case hex characters. A short commit, a branch, or a tag does not work. Read the commit with:

```sh
git rev-parse HEAD
```

Then add the pin:

```sh
bowerloom skills add github:<owner>/<repo>@<40-char-commit>:skills/<name>
```

The path to the skill folder is at most 8 folders deep. A longer path refuses with `SKILLS_ADD_SPEC_INVALID`.

GitHub limits requests that carry no credentials. The Git route makes one request for the commit, one for each folder listing on the path, and one for each selected file. `skills add` makes these requests when it plans and again when you approve. `skills sync` makes them when you approve. In the test run for this release, the two-file ECC skill took 6 requests at each of these steps, and GitHub allowed 60 requests in each window. A skill with many files can reach that limit. If GitHub refuses, wait before you run the command again.

## Bug reports, feedback, and feature discussions

The beta is open. Tell the team what works and what does not.

- Report a reproducible bug in [Issues](https://github.com/sageadvicellc/bowerloom/issues). Name the command, the exact error code, and the Bowerloom version.
- Ask a setup or usage question in [Q&A](https://github.com/sageadvicellc/bowerloom/discussions/categories/q-a).
- Share general feedback in [General](https://github.com/sageadvicellc/bowerloom/discussions/categories/general).
- Propose a feature in [Ideas](https://github.com/sageadvicellc/bowerloom/discussions/categories/ideas). Describe the task, the problem, the result you want, and your current workaround.

Search open and closed reports before you write a new one. Use synthetic inputs in your reproduction. Keep credentials, private paths, raw receipts, and customer data out of public posts. Read [Bug reports and feedback](/docs/feedback/) for a report outline and privacy guidance.

A report or proposal does not guarantee a fix, a response time, or a release date.

## Current beta limits

- Public skills only. The npm route reads only `registry.npmjs.org`. The Git route reads only the public GitHub API, without credentials. Private registries and private repositories are not supported.
- Only the MIT and Apache-2.0 licenses are accepted.
- No worker starts in this beta. Skills and prompts are files. Bowerloom runs nothing in them.
- Native discovery of these files by Claude Code and Codex is not observed. A copy in `.claude/skills` or `.agents/skills` does not prove that either harness finds or runs it.
- `bowerloom revise` refuses once a project holds content added after setup. The fix comes in a later 0.7 release.
- Bowerloom keeps history and deletes none. Each item keeps at most 64 operations in its private history. A full item refuses with `MANAGED_SKILL_HISTORY_FULL`, and you take a manual step. The `Next:` line says to move every `op-<key>` folder except the one it names out of `items/<id>` in the private state folder, using `mv` in a terminal. Then run the command again.
- `apply` and `sync` add copies and remove none. Removing a harness is not supported yet.
- Keep the project, and the private state folder, in folders that iCloud Drive does not sync.

## Future versions

This section lists work that this beta does not do. Do not treat it as a current instruction.

- Worker launch. Workers wait for a later release.
- Private npm registries and private Git repositories.
- The 1.0 release.

## Continue

[Codex and Claude Code](/docs/harnesses/) explains harness boundaries. [Files and configuration](/docs/configuration/) describes project files. [CLI reference](/docs/cli/#skills) lists every skills form.

[Current support](/docs/status/) describes release support. Approval of a plan authorizes the planned files. It does not approve agents, teams, hooks, or skill execution.
