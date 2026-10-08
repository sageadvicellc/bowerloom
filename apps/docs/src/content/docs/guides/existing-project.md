---
title: "Add a setup to an existing project"
description: "Add reviewed Bowerloom files without importing your project or agent configuration."
section: "Guides"
order: 7
---

Existing mode integrates Bowerloom definitions with your current project through a new `.bowerloom/` directory. Start by [mapping your workflow](/docs/guides/integrate-workflow/) and reviewing the proposed roles, handoffs, and access. The installer does not read project-file contents or import live agent configuration. If `.bowerloom/` already exists, use [revision](/docs/revision/) instead of fresh setup.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

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
