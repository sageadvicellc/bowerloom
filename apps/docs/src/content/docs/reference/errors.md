---
title: "Status and error reference"
description: "Read the exact status or refusal before choosing a next action."
section: "Reference"
order: 24
---

Use the actual result from the matching installed candidate. A status is an observed state. An error identifies a refused operation.

## Status fields

| Field | Meaning in the reviewed setup |
| --- | --- |
| `status` | `ready-for-review`, `drifted`, or `revision-pending` |
| `revision` | Installed setup revision, or null when inspection cannot establish it |
| `specReady` | Whether the inspected specification meets its required checks |
| `runtimeReady` | False in the setup results documented here |
| `executionAuthorized` | False in the setup results documented here |
| `reviewRequired` | True in the setup results documented here |
| `drift` | Recorded differences or inspection failures |
| `compiledCandidate` | The compiled candidate identity when inspection can establish it |
| `contextImported` | False in the setup results documented here |
| `hostedAgentCreated` | False in the setup results documented here |

`ready-for-review` requires human review. It does not mean that a team ran or that native execution is qualified.

`revision-pending` requires retained transaction state and [explicit recovery](/docs/guides/recover-revision/). `drifted` requires inspection of actual differences.

## Setup refusals

| Code | Trigger and meaning | Preserve and next action |
| --- | --- | --- |
| `BOWERLOOM_EXISTS` | The target already contains `.bowerloom/`. | Inspect the setup. Use [revision](/docs/revision/). |
| `EXACT_APPROVAL_REQUIRED` | Approval is absent or lacks the required revision form. | Retain the plan. Obtain its exact human approval. |
| `IDENTITY_POLICY_UNSUPPORTED` | Recorded identity policy does not meet the supported path. | Preserve the receipt. Inspect compatibility without editing identity. |
| `PRIVATE_OWNER_REQUIRED` | Directory ownership or permissions violate the required boundary. | Inspect the selected path. Do not bypass ownership controls. |
| `REVISION_PENDING` | A retained revision marker blocks fresh installation. | Preserve the transaction. Use [recovery](/docs/guides/recover-revision/). |
| `STALE_APPROVAL` | Current inputs or binding do not match approval. | Retain the refusal. Plan again and obtain new approval. |
| `STARTUP_TARGET` | The target fails the required absolute path form. | Select the intended valid path. Plan again. |
| `TARGET_EXISTS` | New mode finds an existing target. | Inspect it. Choose existing mode only for the intended project. |
| `UNSAFE_DIRECTORY` | A path fails required directory conditions. | Inspect the path and ancestors. Do not force the write. |

The candidate's wrong setup approval returns `STALE_APPROVAL` with exit 1 and no project changes. Do not infer every I/O failure is unchanged.

## Stop results

| Result | Meaning | Next action |
| --- | --- | --- |
| `NOT_RUNNING` | No execution started, or previous execution finished. | Report this actual scope. |
| `STOPPED` | The original registered owner acknowledged cleanup. | Retain the owner's result. |
| `STOP_UNCONFIRMED` | Cleanup remains unconfirmed. | Preserve records and inspect the original owner. |

A timeout does not establish cleanup. [Stop registered work](/docs/stop/) explains registry scope.

## Other subsystem errors

Connection, harness, backend, recipe, and runtime commands have separate boundaries. Read the exact subsystem output and its reference prerequisites.

Missing qualification is not permission to use an older or less restricted path. Use [Troubleshooting](/docs/troubleshooting/) for the next supported inspection.
