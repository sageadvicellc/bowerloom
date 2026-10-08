---
title: "Troubleshooting"
description: "Find the supported next inspection without bypassing a refusal."
section: "Help"
order: 25
---

Start with the installed version, actual output, and intended task. Preserve uncertain state before choosing another operation.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

## Ask your agent

```text
Help me understand this Bowerloom refusal. Read the matching version and error guidance. Suggest the next safe inspection without bypassing the boundary.
```

## Agent procedure

### Prerequisites

Use the actual output and matching documentation. Keep raw receipts, private paths, tokens, and customer records private.

### Read the command identity

For an installed CLI, read:

```sh
bowerloom --version
```

Use the documentation that matches this version. Keep the original error before attempting a different installation.

### Inspect an installed setup

For your actual setup target, read:

```sh
bowerloom init status --target /absolute/projects/clean-install-trial
```

Use [Status and error reference](/docs/reference/errors/) to interpret its fields. Report the actual code, intended effect, and one supported next step.

If the outcome remains uncertain, preserve the original evidence. A help request grants no bypass, cleanup, or automatic retry authority.

## Installation

Make sure that Node and npm meet the requirements in [Install Bowerloom](/docs/start/). Read the npm error before retrying.

If `npm install -g` refuses with a permission error, do not use `sudo`. Set a user prefix with `npm config set prefix "$HOME/.npm-global"` and add `$HOME/.npm-global/bin` to your `PATH`. [Install Bowerloom](/docs/start/#prerequisites-and-availability) shows the steps.

If the version differs, use matching documentation. A setup command does not grant model execution permission.

## Project commands

If a command exits 3, it waits for approval. Read the plan, then run the same command with `--approve <revision>`. If it exits 4 with `prepared, workers held`, the project is prepared and a gate holds the workers.

If `PROJECT_IN_CLOUD_FOLDER` appears, move the project out of `~/Documents`, `~/Desktop`, or a `~/Library` cloud folder. If `PROJECT_NOT_FOUND` appears, change into the project folder, or run `bowerloom up --team <name> --goal <goal>`. [Errors](/docs/reference/errors/#project-and-approval-refusals) lists every code.

If a skill copy is held for local drift, Bowerloom never overwrites it. Follow the `Next:` line. If `MANAGED_SKILL_HISTORY_FULL` appears, move the older `op-<key>` folders out with `mv`, as the `Next:` line says.

## Existing setup

If `.bowerloom/` exists, inspect it before any change. Use [revision](/docs/revision/) for an installed goal or profile.

If the new target already exists, choose existing mode only for the intended project. Do not delete it to satisfy new mode.

## Approval

If approval is stale, read the actual changed inputs or binding. Prepare another plan and obtain exact approval.

Do not guess a hash or edit the receipt. [Plans and approval](/docs/permissions/) explains the boundary.

## Drift

If status lists drift, inspect the actual files and identity. Preserve the result before selecting a supported revision or repair.

Direct edits do not create approval. Replacement directories do not inherit the original receipt's identity.

## Revision

If status is `revision-pending`, preserve the marker, stage, backup, and original approval. Follow [Recover an interrupted revision](/docs/guides/recover-revision/).

Do not run fresh installation or delete journals to clear pending state.

## Stop

If a stop is unconfirmed, inspect the original owner in the selected registry. Retain its uncertainty and records.

Do not claim cleanup from a timeout. Do not enroll a replacement owner over unresolved state.

## Backend

If Docker context, platform, or storage fails, stop before installation. Read [Local backend](/docs/backend/) for the separate prerequisites.

Preserve partial backend state. Do not prune unrelated Docker data or delete volumes.

## Help

Provide the exact version, command family, safe code, expected action, and sanitized result. Exclude credentials, private paths, raw receipts, and customer data.

Keep the original failure available privately for scoped review. Use [Bug reports and feedback](/docs/feedback/) to choose the right channel.

[Security boundaries](/docs/security/) explains untrusted reports and tool rights.
