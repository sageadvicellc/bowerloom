---
title: "Choose your setup path"
description: "Find the current setup task from an older documentation link."
compatibility: true
---

Integrate Bowerloom with the project you already use. First [map your manual or one-to-one agent workflow](/docs/guides/integrate-workflow/) into roles, handoffs, and review points. The fixed profiles provide a starting specification for comparison with that process. Setup stores those definitions in `.bowerloom/` through an exact approved file plan. It does not import your project or execute the team.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

## Choose a workspace and profile

Use [Integrate your first team](/docs/learn/first-team/) or [Existing project](/docs/guides/existing-project/) for your intended project. If `.bowerloom/` already exists, use [revision](/docs/revision/). Engineer, Founder, and Research provide fixed role templates. An optional [separate workspace](/docs/guides/new-workspace/) remains available when you need a new target.

## Review the plan

Each task shows its exact planning command and complete file-review step. The project, goal, profile, and binding remain part of approval. Compare the roles, proposed access, and handoffs with your current process before approving the files.

## Approve the exact files

Use only the revision from the human's reviewed plan. After installation, follow [Read and review your setup](/docs/learn/review-your-setup/). Inspect the actual status before treating the specification as ready for later work.

## Share definitions, not private state

Your team definitions stay in files that follow you. Read [Files and configuration](/docs/configuration/) before sharing them. Keep private receipts, paths, journals, logs, credentials, and access details out of shared definitions. Copying a definition transfers no execution authority.

## Support boundary

[Current support](/docs/status/) describes supported tasks and limits. [Roadmap](/docs/roadmap/) describes estimated future stages.
