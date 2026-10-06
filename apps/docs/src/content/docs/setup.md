---
title: "Plan and install a first team"
description: "Review the complete files before approving an installation."
---

:::note[Private beta command scope]
Use the [isolated installed executable](/docs/start/). The private `0.7.0-beta.0` trial covers Engineer-profile setup in new and existing projects and successful revision. Recovery, other profiles, and runtime execution remain outside that trial.
:::

## Choose a workspace and profile

Use `new` for an unused target with an existing parent directory. Use `existing` for a project directory that already exists. Existing mode adds `.bowerloom/`; it does not read project-file contents or import existing agent settings.

Choose `engineer`, `founder`, or `research`. These select different fixed role templates. They do not ask a model to design a team.

Use the private candidate executable from [installation](/docs/start/). Replace `/absolute/projects/first-team` with your own absolute path.

## Review the plan

```sh
bowerloom init plan --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Draft a short project plan for review."
```

Read the goal, roles, proposed access, worker limits, working agreement, and exact file changes. Add `--json` to inspect each file and hash.

For an existing project, change only the mode and target, then review that new plan:

```sh
bowerloom init plan --mode existing --target /absolute/projects/existing-project --profile engineer --name "First team" --goal "Draft a short project plan for review."
```

A previous `.bowerloom/` blocks a fresh installation. Use [revision](/docs/revision/) for an installed setup.

## Approve the exact files

Keep every input identical to the reviewed plan. Replace the approval placeholder with its complete revision.

For a new workspace, use the revision from the new-workspace plan:

```sh
bowerloom init apply --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Draft a short project plan for review." --approve EXACT_PLAN_REVISION
bowerloom init status --target /absolute/projects/first-team
```

For an existing project, use the revision from that existing-project plan:

```sh
bowerloom init apply --mode existing --target /absolute/projects/existing-project --profile engineer --name "First team" --goal "Draft a short project plan for review." --approve EXACT_PLAN_REVISION
bowerloom init status --target /absolute/projects/existing-project
```

A changed input or stale directory binding requires another review. Do not bypass a refusal by editing the receipt.

Success creates 20 setup files plus a private receipt. Both guide paths below are relative to the selected target project.
Read `.bowerloom/START-HERE.md` and `.bowerloom/startup-review.md` with your personal agent. Stop at that first decision. Setup does not authorize execution.

## Share definitions, not private state

Portable team definitions and skills can be reviewed separately. Keep `installation-receipt.json`, local paths, journals, logs, and access details private. Inspect files before sharing them; the tool is not a general secret detector.

## Private beta trial and historical evidence

The `0.7.0-beta.0` candidate passed new/existing Engineer-profile setup, exact approval refusal, status, and successful revision. It retained specification readiness without runtime readiness or execution authority. Founder and Research profiles were not rerun in this candidate trial. [Beta identity](/docs/status/#private-beta-candidate).

The following broader profile result belongs to the earlier alpha artifact:

All six profile/mode combinations passed the bounded installed trial at source `cd62b530`. The trial compared all planned files and preserved existing notes. Specification readiness remained separate from runtime readiness and execution authority. [Exact identity](/docs/status/#reviewed-setup-identity).
