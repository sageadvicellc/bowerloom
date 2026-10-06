---
title: "Stop registered work"
description: "Request a scoped stop and read the registered owner\u2019s actual response."
section: "Guides"
order: 10
---

`destruct` requests a stop of registered work. It preserves teams, project files, outputs, and history.

It does not stop Docker, a local backend, or unrelated personal-agent sessions.

<!-- release:status:start -->
Open beta · 0.7.0-beta.0

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

## Ask your agent

```text
Help me stop this registered Bowerloom work. Identify its owner and selected registry first. Report uncertainty without deleting records or project files.
```

## Agent procedure

### Scope comes from enrollment

Install the matching CLI version through [Install Bowerloom](/docs/start/).

Use a separately reviewed runtime enrollment and its original owner. Setup approval alone does not enroll an owner.

Select the same registry that the enrollment uses. An isolated registry requires its explicit absolute path.

### Request the selected stop

For one registered team, replace the root and registry with their reviewed paths:

```sh
bowerloom destruct first-team --root /absolute/projects/clean-install-trial --registry /absolute/private/registry
```

For all registered work in that same selected registry, use:

```sh
bowerloom destruct all --registry /absolute/private/registry
```

Choose the intended scope before invoking either command. `all` covers that local registry, not every user, machine, or agent.

The reference also accepts `--timeout-ms`. Use only the timeout allowed by the reviewed owner scope.

### Interpret the result

| Result | Meaning |
| --- | --- |
| `STOPPED` | The registered owner acknowledged the stop after cleanup. |
| `NOT_RUNNING` | No execution started, or previous executions already finished. |
| `STOP_UNCONFIRMED` | Cleanup is unconfirmed. Preserve the original owner's records. |

A registered setup with no execution reports `NOT_RUNNING`. A timeout does not prove that work stopped.

### If the owner remains uncertain

Inspect the original owner and retained records. Repeated requests do not authorize replacing the owner or deleting its history.

A project link grants no stop authority. Keep unresolved stop uncertainty visible.

## Support boundary

[Current support](/docs/status/) describes supported tasks and limits. [Stop troubleshooting](/docs/troubleshooting/#stop) covers unresolved outcomes.
