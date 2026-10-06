---
title: "Revise and recover"
description: "Change an installed setup through another exact plan."
---

<!-- release:status:start -->
**Open beta · unreleased** · `0.7.0-beta.0`

**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

Setup does not start workers, grant runtime access, or authorize connected actions.

- Full runtime acceptance remains incomplete.
- The initial beta needs founder acceptance and publication approval.
- Unattended support requires an independently accepted installed security configuration.
<!-- release:status:end -->

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

## Support boundary

[Current support](/docs/status/) records the tested systems and release limits. This page does not establish full runtime acceptance.
