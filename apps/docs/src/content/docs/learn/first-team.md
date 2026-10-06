---
title: "Integrate your first team"
description: "Plan a team specification for your existing project, then approve its exact files."
section: "Learn"
order: 3
---

Integrate a team specification with the project you already use. First [map your existing workflow](/docs/guides/integrate-workflow/) and compare it with a fixed profile. Existing mode adds `.bowerloom/` without reading project-file contents or importing live agent configuration. Review the exact file plan before installation, then compare the resulting roles and handoffs with your process.

## Ask your agent

```text
Help me integrate a Bowerloom team specification with this existing project. Use the workflow description we reviewed and compare it with the fixed Engineer profile. Show the complete file plan and working agreement before changing anything. If .bowerloom already exists, use revision instead of fresh installation. Wait for my exact approval. Do not import project contents or live agent configuration, start workers, or execute the project.
```

## Agent procedure

### Prerequisites

Install the matching CLI version through [Install Bowerloom](/docs/start/).

Select an existing absolute project directory that you own. Its ancestors must meet the setup path requirements.

The project must contain no `.bowerloom/` installation or pending revision. Inspect the intended target before planning.

### Plan the files

Replace `/absolute/projects/existing-project` with that exact project path.

```sh
bowerloom init plan --mode existing --target /absolute/projects/existing-project --name "First team" --goal "Plan an accessible project website and its meaningful checks." --profile engineer --json
```

Read the complete inputs, binding, file inventory, identity policy, and revision. Review the fixed roles, agreement, and milestones.

The plan's `specReady` field does not mean that files exist or execution is authorized.

### Wait for exact approval

Wait for the human to approve the exact plan. Replace `EXACT_REVIEWED_PLAN_REVISION` with its complete 64-character `revision`.

Keep every input identical to that approved plan.

```sh
bowerloom init apply --mode existing --target /absolute/projects/existing-project --name "First team" --goal "Plan an accessible project website and its meaningful checks." --profile engineer --approve EXACT_REVIEWED_PLAN_REVISION
```

### Read the result

```sh
bowerloom init status --target /absolute/projects/existing-project
```

A successful setup reports `ready-for-review` with no drift. Runtime readiness and execution authority remain false.

Approval adds 20 setup files and one private receipt. Unrelated project files remain unchanged.

### If the command refuses

If `.bowerloom/` exists, inspect it and follow [revision](/docs/revision/). Do not overwrite the installation through fresh setup.

If inputs or binding change, prepare another plan and obtain exact approval. Do not guess a replacement revision.

If a revision is pending, preserve its transaction records. Use [revision recovery](/docs/guides/recover-revision/).

Continue with [Read and review your setup](/docs/learn/review-your-setup/).
