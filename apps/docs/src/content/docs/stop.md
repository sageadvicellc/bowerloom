---
title: "Stop registered work"
description: "Understand what a stop result covers and what remains uncertain."
---

:::note[Private beta command scope]
Use the [isolated installed executable](/docs/start/). This command reference is not exercised by the private beta candidate trial. Historical evidence stays separate; it does not establish beta acceptance for this operation.
:::

`destruct` means stop registered work. It does not delete teams, project files, outputs, or saved history. It does not stop Docker or the local Supabase backend.

## Scope comes from enrollment

Setup approval does not enroll a runtime owner. Control enrollment is separate, revision-bound approval. A registered team with no execution reports `NOT_RUNNING`.

With a previously registered local owner, these commands request a stop:

Use only the installed artifact and registry selected in your reviewed installation packet.

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

## Historical evidence and limits

The independent installed trial exercised five synthetic timer owners, team selection, registry isolation, delayed acknowledgement, and explicit uncertainty. All test timers ended. This proves the tested control protocol, not cleanup of an arbitrary native model or external service.

Source `cd62b530`, package `0.7.0-alpha.0`; [exact identity](/docs/status/#reviewed-setup-identity). Production runtime enrollment remains a separate prerequisite.
