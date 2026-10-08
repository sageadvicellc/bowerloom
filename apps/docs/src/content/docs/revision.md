---
title: "Revise an installed setup"
description: "Review a goal or profile change before replacing managed files."
section: "Guides"
order: 8
---

Revision changes an installed setup through another exact plan. It retains private history and preserves unrelated project files.

<!-- release:status:start -->
Open beta · 0.7.0-beta.1

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

## Ask your agent

```text
Help me revise my installed Bowerloom setup. Read its current state and show the replacement plan. Wait for my exact approval.
```

## Agent procedure

### Prerequisites

Install the matching CLI version through [Install Bowerloom](/docs/start/).

Use the original target and a readable installation receipt. Resolve any pending revision before starting another change.

### Prepare a revised goal

Read the current status first:

```sh
bowerloom init status --target /absolute/projects/clean-install-trial
```

Replace the example target with the installed project's absolute path. Plan the selected change:

```sh
bowerloom revise plan --target /absolute/projects/clean-install-trial --name "Clean install trial" --goal "Revise the project plan for accessibility review" --profile engineer --json
```

Read the old goal, new goal, proposed files, replacement scope, old installation revision, and new plan revision.

The CLI accepts these inline fields. Its help also documents the alternative `--brief` form. Do not mix the two forms.

### Approve the exact replacement

Wait for human approval of the new plan. Replace `OLD_INSTALLATION_REVISION` with the installed revision recorded in that plan.

Replace `EXACT_REVISION_PLAN` with the new plan's complete revision. Keep all brief inputs identical.

```sh
bowerloom revise apply --target /absolute/projects/clean-install-trial --name "Clean install trial" --goal "Revise the project plan for accessibility review" --profile engineer --from OLD_INSTALLATION_REVISION --approve EXACT_REVISION_PLAN
```

### Inspect the result

```sh
bowerloom init status --target /absolute/projects/clean-install-trial
```

Report the actual resulting installation revision and readiness fields. The resulting revision is distinct from the approved change plan.

The operation replaces managed setup files and preserves the recorded previous installation in private history. It starts no workers.

### If the revision stops partway

If status is `revision-pending`, preserve the marker, stage, and backup. Follow [Recover an interrupted revision](/docs/guides/recover-revision/).

If identity, old revision, or inputs differ, stop and inspect. Do not edit a receipt to clear the refusal.

## Review dependent access again

An old connection or runtime enrollment does not authorize a revised specification. Review those exact bindings before later execution.

## Support boundary

[Current support](/docs/status/) describes supported tasks and limits. [Plans and approval](/docs/permissions/) explains changed inputs.
