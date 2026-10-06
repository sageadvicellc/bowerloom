---
title: "Prepare a separate workspace"
description: "Use an optional new workspace without replacing an existing project."
section: "Guides"
order: 7.2
---

Use this optional guide when you want a separate unused workspace. For your current project, use [Integrate your first team](/docs/learn/first-team/) instead. This example prepares the fixed Engineer specification named “Clean install trial.” It ends with a file review and starts no workers.

## Ask your agent

```text
Prepare a Bowerloom Engineer setup for this project. Make sure that its absolute path is correct and unused. Use the name "Clean install trial" and goal "Review a synthetic team setup." Show me the plan and files, then wait for my exact approval. Do not start workers or a backend.
```

## Agent procedure

### Prerequisites

Install the matching CLI version through [Install Bowerloom](/docs/start/).

Use an absolute path that you own. Its parent directory must exist, with accessible, safe ancestors.

The new target must not exist. If it exists, use [the existing-project guide](/docs/guides/existing-project/) only for that intended project.

### Plan the files

Replace `/absolute/projects/clean-install-trial` with the selected absolute target. Keep the other example inputs unchanged.

```sh
bowerloom init plan --mode new --target /absolute/projects/clean-install-trial --name "Clean install trial" --goal "Review a synthetic team setup" --profile engineer --json
```

Read `input`, `files`, `binding`, `installationIdentityPolicy`, and `revision` in the returned plan.

Review every proposed file, hash, role, access declaration, agreement, and milestone. The plan contains the full 20-file inventory.

The plan reports `specReady: true`, `runtimeReady: false`, `executionAuthorized: false`, and `reviewRequired: true`. These fields describe a valid plan, not an installation.

### Wait for exact approval

Show the complete plan to the human. Wait for approval of that exact plan.

Replace `EXACT_REVIEWED_PLAN_REVISION` with the plan's complete 64-character `revision`. The placeholder is not an approval or example hash.

Keep the mode, target, name, goal, and profile identical to the reviewed inputs.

```sh
bowerloom init apply --mode new --target /absolute/projects/clean-install-trial --name "Clean install trial" --goal "Review a synthetic team setup" --profile engineer --approve EXACT_REVIEWED_PLAN_REVISION
```

### Read the result

```sh
bowerloom init status --target /absolute/projects/clean-install-trial
```

The apply receipt includes `plan.revision`. A successful setup reports `ready-for-review` with no drift.

Status keeps `runtimeReady: false` and `executionAuthorized: false`. Context import and hosted-agent creation also remain false.

Approval writes 20 setup files plus a private receipt. It starts no workers or backend services.

### If the command refuses

If `STALE_APPROVAL` appears, prepare another plan for the actual inputs. Obtain exact approval again before applying.

If `TARGET_EXISTS` appears, inspect the intended target. Do not delete it to force new mode.

If `BOWERLOOM_EXISTS` appears, use [revision](/docs/revision/) for the installed setup. If a revision is pending, preserve its records.

If an I/O result is uncertain, inspect status and preserved files. Do not repeat the write blindly.

Continue with [Read and review your setup](/docs/learn/review-your-setup/).

For additional portable skills, read [Add a portable skill for Codex](/docs/guides/add-skills/). Its current installer requires a separate new workspace.
