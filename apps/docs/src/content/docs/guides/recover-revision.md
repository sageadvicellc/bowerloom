---
title: "Recover an interrupted revision"
description: "Legacy 0.7. Preserve the transaction and choose its supported resume or rollback action."
section: "Legacy 0.7 team setup"
order: 9
---

> **Legacy (0.7).** This page describes the team setup flow of Bowerloom 0.7. Its commands are still in the CLI help of 0.8.0-beta.1. The current path is [Adopt and install a harness](/docs/guides/adopt-and-install/).

Recovery resolves an interrupted revision. It uses the recorded transaction and its original approval.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads pinned skills only from public sources. A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`, as [Where your items come from](/docs/guides/item-sources/#private-store) explains. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

## Ask your agent

```text
Help me understand this interrupted Bowerloom revision. Preserve the transaction records and show the supported resume or rollback choice before acting.
```

## Agent procedure

### Prerequisites

Install the matching CLI version through [Install Bowerloom](/docs/start/).

Use the exact original project and retained transaction records. Obtain the original recorded revision-plan approval.

If the original approval or transaction cannot be established, stop. Preserve the marker, stage, backup, receipt, and history.

### Inspect the pending state

Replace the target with the interrupted project's absolute path.

```sh
bowerloom init status --target /absolute/projects/clean-install-trial
```

`revision-pending` is not a ready setup. Inspect the recorded transaction before choosing an action.

### Choose one action

Explain the supported choice to the human. Use the original approved transaction revision for `EXACT_REVISION_PLAN`.

If the selected action is resume, use:

```sh
bowerloom revise recover --target /absolute/projects/clean-install-trial --approve EXACT_REVISION_PLAN --action resume
```

If the selected action is rollback, use:

```sh
bowerloom revise recover --target /absolute/projects/clean-install-trial --approve EXACT_REVISION_PLAN --action rollback
```

Resume continues the recorded approved transaction. Rollback restores its recorded prior installation.

### Inspect the resolved state

```sh
bowerloom init status --target /absolute/projects/clean-install-trial
```

Report the actual transaction outcome and readiness fields. Recovery starts no workers and grants no cleanup authority.

### If recovery refuses

Preserve journals and identity fields. Do not adopt a replacement directory or repeatedly call fresh installation.

There is no generic `init recover` command. If an I/O outcome stays uncertain, inspect retained state before further action.

[Revision guide](/docs/revision/) · [Troubleshooting](/docs/troubleshooting/#revision) · [Status reference](/docs/reference/errors/)
