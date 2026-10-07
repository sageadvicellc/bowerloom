---
title: "Status and error reference"
description: "Read the exact status or refusal before choosing a next action."
section: "Reference"
order: 24
---

Use the actual result from the matching installed version. A status is an observed state. An error identifies a refused operation.

Keep your project out of iCloud Drive folders. This beta does not support them, and it does not check for them yet. It reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

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
| `compiledCandidate` | The compiled definition identity when inspection can establish it |
| `contextImported` | False in the setup results documented here |
| `hostedAgentCreated` | False in the setup results documented here |

`ready-for-review` requires human review. It does not mean that a team runs or has execution permission.

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

A wrong setup approval returns `STALE_APPROVAL` with exit 1 and no project changes. Do not infer every I/O failure is unchanged.

## Skills refusals

The `bowerloom skills` commands print one line of JSON on standard error and exit 1. [Add a third-party skill](/docs/guides/add-skills/#if-a-command-refuses-or-stops) shows the exact forms.

<!-- BIND: pending installed evidence -->
| Code | Trigger and meaning | Preserve and next action |
| --- | --- | --- |
| `SKILLS_REFUSED (<CODE>)` | The command stopped for a known reason. The code in parentheses names it, such as `NPM_CACHE_DIRECTORY` or `GIT_TREE_BOUND`. | Keep the error. Inspect the cache and installation records. |
| `SKILLS_UNCERTAIN` | The cache state is not certain. The message names two codes. | Run `skills source inspect`, then `skills source recover plan`, before another action. |
| `SKILLS_UNCERTAIN` with `_CACHE_OPEN_PARTIAL` | Recovery cannot read the operation folder. | Start again with a new `SOURCE_OPERATION`. |
| `MANAGED_SKILL_STALE_APPROVAL` | The approved revision no longer matches the plan. | Plan again and obtain new approval. |
| `MANAGED_SKILL_LOCAL_DRIFT` | Someone edited an installed file. | Keep the edit. Inspect before you plan again. |
| `MANAGED_SKILL_REFUSED` | The general installation refusal. It also covers cache or receipt drift. | Inspect the cache and installation. Do not overwrite local files. |

## Stop results

| Result | Meaning | Next action |
| --- | --- | --- |
| `NOT_RUNNING` | No execution started, or previous execution finished. | Report this actual scope. |
| `STOPPED` | The original registered owner acknowledged cleanup. | Retain the owner's result. |
| `STOP_UNCONFIRMED` | Cleanup remains unconfirmed. | Preserve records and inspect the original owner. |

A timeout does not establish cleanup. [Stop registered work](/docs/stop/) explains registry scope.

## Other subsystem errors

Connection, harness, backend, recipe, and runtime commands have separate boundaries. Read the exact subsystem output and its reference prerequisites.

A refused operation does not authorize an older or less restricted path. Use [Troubleshooting](/docs/troubleshooting/) for the next supported inspection.
