---
title: "Add a setup to an existing project"
description: "Add reviewed Bowerloom files without importing your project or agent configuration."
section: "Guides"
order: 7
---

Existing mode adds `.bowerloom/` to your chosen project. It does not read project-file contents or import live agent configuration.

## Ask your agent

```text
Help me add a Bowerloom setup to this existing project. Show the file plan before changing anything. Do not import my agent configuration.
```

## Agent procedure

### Prerequisites

For CLI operations, first meet the exact publication and installation requirements in [Install Bowerloom](/docs/start/).

The package is unpublished. Public readers must stop before these commands. The examples describe the reviewed candidate.

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

The recorded success is `ready-for-review` with no drift. Runtime readiness and execution authority remain false.

Approval adds 20 setup files and one private receipt. Unrelated project files remain unchanged.

### If the command refuses

If `.bowerloom/` exists, inspect it and follow [revision](/docs/revision/). Do not overwrite the installation through fresh setup.

If inputs or binding change, prepare another plan and obtain exact approval. Do not guess a replacement revision.

If a revision is pending, preserve its transaction records. Use [revision recovery](/docs/guides/recover-revision/).

Continue with [Read and review your setup](/docs/learn/review-your-setup/).
