---
title: "Stop registered work"
description: "Understand what a stop result covers and what remains uncertain."
---

<!-- release:status:start -->
**Open beta · unreleased** · `0.7.0-beta.0`

**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

Setup does not start workers, grant runtime access, or authorize connected actions.

- Full runtime acceptance remains incomplete.
- The initial beta needs founder acceptance and publication approval.
- Unattended support requires an independently accepted installed security configuration.
<!-- release:status:end -->

`destruct` means stop registered work. It does not delete teams, project files, outputs, or saved history. It does not stop Docker or the local Supabase backend.

## Scope comes from enrollment

Setup approval does not enroll a runtime owner. Control enrollment is separate, revision-bound approval. A registered team with no execution reports `NOT_RUNNING`.

With a previously registered local owner, these commands request a stop:

Use the installed version and registry selected in your reviewed setup.

```sh
bowerloom destruct first-team --root /absolute/projects/first-team
bowerloom destruct all
```

`all` means the selected registry for the current user, not every machine or agent. An isolated registry requires the same `--registry /absolute/private/registry` used at enrollment.

## Interpret the result

| Result | Meaning |
| --- | --- |
| `STOPPED` | The registered owner acknowledged the stop after cleanup. |
| `NOT_RUNNING` | No execution started, or earlier executions already finished. |
| `STOP_UNCONFIRMED` or held uncertainty | Cleanup is not confirmed. Preserve the records and inspect the original owner. |

A timeout is not proof that work stopped. Repeated requests observe unresolved owners; they do not justify replacing the owner or erasing its history.

A link between projects grants no stop authority. An unregistered personal-agent session is outside this control.

## Support boundary

[Current support](/docs/status/) records the tested systems and release limits. This page does not establish full runtime acceptance.
