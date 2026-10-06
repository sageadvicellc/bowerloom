---
title: "Revise and recover"
description: "Change an installed setup through another exact plan."
---

:::note[Private beta command scope]
Use the [isolated installed executable](/docs/start/). The private `0.7.0-beta.0` trial covers Engineer-profile setup in new and existing projects and successful revision. Recovery, other profiles, and runtime execution remain outside that trial.
:::

## Prepare a revised goal

Plan the replacement setup with the installed executable:

```sh
bowerloom revise plan --target /absolute/projects/first-team --name "First team" --goal "Revise the project plan for accessibility review." --profile engineer
```

Read the old goal, new goal, and replacement scope. Copy the installed revision and the new plan revision. Keep all inputs identical when applying.

```sh
bowerloom revise apply --target /absolute/projects/first-team --name "First team" --goal "Revise the project plan for accessibility review." --profile engineer --from OLD_INSTALLATION_REVISION --approve EXACT_REVISION_PLAN
```

Bowerloom replaces its managed setup files and preserves the previous installation in a private history directory. Unrelated project files stay unchanged.

## If the revision stops partway

Inspect status first:

```sh
bowerloom init status --target /absolute/projects/first-team
```

`revision-pending` is not ready. Preserve the marker, stage, and backup. Use the original exact revision approval, then choose one action:

```sh
bowerloom revise recover --target /absolute/projects/first-team --approve EXACT_REVISION_PLAN --action resume
```

Or restore the recorded original during the interrupted transaction:

```sh
bowerloom revise recover --target /absolute/projects/first-team --approve EXACT_REVISION_PLAN --action rollback
```

Do not delete journals, edit identity fields, or adopt a replacement directory. Unexpected state requires inspection rather than a blind retry.

## Review dependent access again

An old connection or runtime enrollment does not authorize a revised specification. Revisit those exact bindings before later execution. Recovery starts no workers and grants no cleanup authority.

## Private beta trial and historical evidence

The private `0.7.0-beta.0` candidate passed successful revision for new and existing Engineer-profile targets. Interrupted recovery was not rerun. [Beta identity](/docs/status/#private-beta-candidate).

The following recovery result belongs to the earlier alpha artifact:

The installed trial tested interruption after both directory renames, with resume and rollback. Wrong approval refused and original files remained preserved. Tests used deliberate process interruption in synthetic projects, not a production crash claim. Source `cd62b530`, package `0.7.0-alpha.0`; [exact identity](/docs/status/#reviewed-setup-identity).

Revision uses a temporary loopback socket to exclude cooperating writers. A port collision refuses the operation.
