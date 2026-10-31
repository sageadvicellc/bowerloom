---
title: "Add a setup to an existing project"
description: "Legacy 0.7. Add reviewed Bowerloom files without importing your project or agent configuration."
section: "Legacy 0.7 team setup"
order: 7
---

> **Legacy (0.7).** This page describes the team setup flow of Bowerloom 0.7. Its commands are still in the CLI help of 0.8.0-beta.1. The current path is [Adopt and install a harness](/docs/guides/adopt-and-install/).

Existing mode integrates Bowerloom definitions with your current project through a new `.bowerloom/` directory. Start by [mapping your workflow](/docs/guides/integrate-workflow/) and reviewing the proposed roles, handoffs, and access. The installer does not read project-file contents or import live agent configuration. If `.bowerloom/` already exists, use [revision](/docs/revision/) instead of fresh setup.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads pinned skills only from public sources. A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`, as [Where your items come from](/docs/guides/item-sources/#private-store) explains. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

The shorter route is `bowerloom up --team <name> --goal <goal>` in the project folder. It runs this setup as its first step and then installs skills and prompts. See [Integrate your first team](/docs/learn/first-team/). This guide shows the explicit `init` forms.

## Ask your agent

```text
Help me integrate a Bowerloom team specification with this existing project from our reviewed workflow description. Show the full file plan and working agreement before changing anything. If .bowerloom already exists, use revision. Wait for my exact approval. Do not import project contents or live agent configuration, start workers, or execute the project.
```

## Agent procedure

### Prerequisites

Install the matching CLI version through [Install Bowerloom](/docs/start/).

Select an existing absolute project directory that you own. Its ancestors must meet the setup path requirements.

The project must contain no `.bowerloom/` installation or pending revision. Inspect the intended target before planning.

### Plan the addition

Replace `/absolute/projects/existing-project` with that exact project path.

```sh
bowerloom init plan --mode existing --target /absolute/projects/existing-project --name "Clean install trial" --goal "Review a synthetic team setup" --profile engineer --json
```

Read the complete inputs, binding, file inventory, identity policy, and revision. Review the fixed roles, agreement, and milestones.

The plan's `specReady` field does not mean that files exist or execution is authorized.

### Apply the reviewed plan

Wait for the human to approve the exact plan. Replace `EXACT_REVIEWED_PLAN_REVISION` with its complete 64-character `revision`.

Keep every input identical to that approved plan.

```sh
bowerloom init apply --mode existing --target /absolute/projects/existing-project --name "Clean install trial" --goal "Review a synthetic team setup" --profile engineer --approve EXACT_REVIEWED_PLAN_REVISION
```

### Inspect the addition

```sh
bowerloom init status --target /absolute/projects/existing-project
```

A successful setup reports `ready-for-review` with no drift. Runtime readiness and execution authority remain false.

Approval adds 20 setup files and one private receipt. Unrelated project files remain unchanged.

### If the command refuses

If `.bowerloom/` exists, inspect it and follow [revision](/docs/revision/). Do not overwrite the installation through fresh setup.

If inputs or binding change, prepare another plan and obtain exact approval. Do not guess a replacement revision.

If a revision is pending, preserve its transaction records. Use [revision recovery](/docs/guides/recover-revision/).

Continue with [Read and review your setup](/docs/learn/review-your-setup/). Compare its team specification and handoff map with your current workflow.

## Move your items to the store

A project from 0.7.0-beta.2 keeps its skills, prompts, and teams in `.bowerloom`. `bowerloom store migrate` copies them to your store, `~/.bowerloom`, and lists them in `bowerloom.json` with the source `store`. It creates `bowerloom.json` when the project has none. It deletes nothing, and no state moves by itself.

1. Run `bowerloom store migrate --all`. Read the plan, then run it again with `--approve <revision>`.
2. Check the result with `bowerloom ls`.
3. Run `bowerloom skills sync` and `bowerloom apply`. The copies are up to date, because the bytes are equal.
4. Delete the old files with the `git rm` lines that the command printed.
5. Remove the `skills.json` lines that the result names.
6. Run `bowerloom receipt clean`. It removes the records of the items you deleted, so `bowerloom status` no longer names them as missing.

In a shared project, the first run copies the items that you wrote, and it does not switch them. Commit and push the store: `bowerloom store status` shows the commands. Then run `bowerloom store migrate --all` again, and commit `bowerloom.json` and `bowerloom.lock.json`.

Installed copies do not change. A skill that moves to the store keeps its catalog until the next update.
