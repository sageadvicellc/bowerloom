---
title: "Create teams, skills, and prompts"
description: "Create a team, a skill of your own, or a reusable prompt inside .bowerloom, and put it in place for Claude Code and Codex."
section: "Guides"
order: 7.7
---

Three commands create files inside `.bowerloom`: `team create`, `skill create`, and `prompt create`. Agents use them most. Each one finds the project, shows a plan, and writes after you approve that exact plan. They write inside `.bowerloom` only. They start no workers and run nothing. You and your agents own the files they make and can edit them.

## Before you start

Install Bowerloom and run `bowerloom up --team <name> --goal <goal>` once, so the project holds `.bowerloom`. See [Install Bowerloom](/docs/start/). Keep the project out of iCloud Drive. A project in a cloud-synced folder refuses with `PROJECT_IN_CLOUD_FOLDER`.

Every command takes `--approve <revision>` and `--json`. Without `--approve`, a terminal asks before it writes. Without a terminal, or with `--json`, the command prints the plan and its revision and exits 3. [Approvals and exit codes](/docs/cli/#approvals-and-exit-codes) explains the flow.

If you delete a created prompt or team, `status` and `up` hold it and name it. Run `bowerloom prompt create <id>` to restore a registered prompt that was deleted. Restore a deleted team from version control.

## Ask your agent

```text
Create a Bowerloom team named research-desk, a skill named house-style, and a prompt named weekly-update in this project. Run each command without --approve first and show me the plan. Wait for my approval of each plan, then run the same command with that revision. Then run bowerloom ls and bowerloom apply, and show me the apply plan. Do not edit AGENTS.md or CLAUDE.md, and do not start workers.
```

## Agent procedure

### Create a team

```sh
bowerloom team create research-desk --profile research
```

The team lands in `.bowerloom/teams/research-desk`. It is built from the project brief, with a lead, a maker, and a reviewer. The name is the team id. Use lower-case words joined by hyphens. `first-team` is taken by setup, and `TEAM_ID_RESERVED` refuses it. `--profile` takes `engineer`, `founder`, or `research`. The default is the profile in the project brief.

### Create a skill of your own

```sh
bowerloom skill create house-style
```

The skill lands in `.bowerloom/skills/house-style/SKILL.md`, and `.bowerloom/skills.json` lists it as a local skill. The name is the skill id. `personal-assistant` and any id that starts with `prompt-` are reserved. `--team <team>` limits the skill to a team that exists. Pass it once for each team. Without it, every team gets the skill.

Commit this skill with your project. To pin a skill that someone else published, use `skills add`. See [Add third-party skills](/docs/guides/add-skills/).

### Create a prompt

```sh
bowerloom prompt create weekly-update
```

The prompt lands in `.bowerloom/prompts/weekly-update.md`. The name is the prompt id, at most 57 characters. `--team <team>` limits the prompt to a team that exists.

### Read the plan

Each create command prints a plan before it writes. The plan has this shape:

<!-- BIND: pending installed evidence -->
```text
Create skill house-style in .bowerloom/skills/house-style
  Teams: every team
  Files: <count>
  skills.json: adds a local entry; a new file
You and your agents own these files and can edit them.
This writes inside .bowerloom only. It starts no workers and runs nothing.
Revision: <64-character revision>
Approval required. Run the same command again with --approve <64-character revision>
```

Show the plan to the human. After approval, run the same command with the revision:

```sh
bowerloom skill create house-style --approve REVISION_FROM_THE_PLAN
```

### Check the result

```sh
bowerloom ls
bowerloom ls prompts
```

`ls` lists teams, skills, and prompts. It reads only. An empty section shows `none yet`.

### Put the files in place

Created skills and prompts are not copied for your harnesses until you run `apply`:

```sh
bowerloom apply
```

A skill goes to `.claude/skills` and `.agents/skills`. A prompt becomes the Claude Code command `.claude/commands/weekly-update.md` and the Codex skill `.agents/skills/prompt-weekly-update`. `apply` never edits `AGENTS.md` or `CLAUDE.md`. It prints a line for you to add. See [Apply the skills](/docs/guides/add-skills/#apply-the-skills).

### If a command refuses

- `TEAM_EXISTS`, `SKILL_EXISTS`, and `PROMPT_EXISTS` mean the id is taken. Run `bowerloom ls teams`, `ls skills`, or `ls prompts`, and choose another id.
- `TEAM_NAME_INVALID`, `SKILL_NAME_INVALID`, and `PROMPT_NAME_INVALID` mean the id is not a plain id. The id becomes a folder or file name.
- `SKILL_NAME_RESERVED` means Bowerloom uses that id itself.
- `TEAM_NOT_FOUND` means `--team` names a team that does not exist.
- `PROJECT_BRIEF_INVALID` means a new team cannot be built from the saved project brief. Run `bowerloom status`.
- `REVISION_PENDING` means a revise is unfinished. Finish it first. See [Recover an interrupted revision](/docs/guides/recover-revision/).
- `AUTHORING_PENDING` means an interrupted create left files. Bowerloom finishes a create only when the leftovers match its record exactly. Read `.bowerloom/authoring/pending.json`, then run the same command without `--approve` to see how the next plan finishes or clears it.
- `AUTHORING_UNREGISTERED` means Bowerloom keeps track only of what `create` made.

[Errors](/docs/reference/errors/#project-and-approval-refusals) lists the other project refusals.

## Limits in this beta

- `bowerloom revise` refuses once a project holds content added after setup. The fix comes in a later 0.7 release.
- No worker starts. Created teams, skills, and prompts are files.
- Native discovery of the copies by Claude Code and Codex is not observed.
