---
title: "Beta support and limits"
description: "Find supported tasks, system requirements, and community help for the beta."
section: "Help"
order: 26
---

Bowerloom `0.7.0-beta.2` prepares readable local definitions for your existing personal agent. Use this page to choose a supported task.

<!-- release:support:start -->
Open beta · 0.7.0-beta.2

Setup does not start workers, grant runtime access, or authorize connected actions.

| Capability | Current boundary |
| --- | --- |
| Setup | Prepare a personal-agent profile, team definition, and working agreement in a new or existing project. Exact approval writes the planned files. |
| Portable skills | Project selected skill files into a new Codex or Claude Code workspace. Native discovery by Claude Code has not been observed. The installer does not prove discovery or execution. |
| Revision | Plan a change to an installed setup, then approve its exact revision before replacement. |
| Execution | Setup does not start workers, grant runtime access, or authorize connected actions. |
| Harnesses | Synthetic configuration commands support Codex and Claude Code fixtures. They do not run models or change live agent configuration. |
| Connections | MCP planning reads selected synthetic files. Local backend installation requires a separate plan and exact approval. |
| Company | Shared company access, retrieval, offboarding, and deletion are outside this beta's documented setup path. |

These guides use macOS arm64 and Node 24.11.0. Other host systems are outside this documented installation path.

Running a team needs separate runtime permissions and controls. The setup commands do not grant them. Shared company access and unattended services are outside this setup walkthrough.
<!-- release:support:end -->

## Beta limits

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

Bowerloom `0.7.0` adds these commands, and each one is documented:

- `bowerloom up --team <name>` prepares a project one approved step at a time and ends at `prepared, workers held`, or at `prepared, N items held` with a next command for each item.
- `bowerloom ls` and `bowerloom status` read the project and write nothing.
- `bowerloom team create`, `skill create`, and `prompt create` make files inside `.bowerloom`.
- `.bowerloom/skills.json` pins skills at exact versions and commits. `skills add`, `skills check`, `skills sync`, `skills recover`, and `skills migrate` manage it.
- `bowerloom skills sync` puts the pinned skills in place for Claude Code and Codex. `bowerloom apply` puts the prompts in place, and any skill copy that is still missing.

Every change shows a plan first and needs `--approve <revision>`. Exit codes are 0 done, 1 refused, 2 usage, 3 approval required, and 4 held by a gate, and 130 stopped at the yes/no question. See [Approvals and exit codes](/docs/cli/#approvals-and-exit-codes).

These limits are current facts of this beta:

- No worker starts. `up` ends at `prepared, workers held`.
- Native discovery of the skill and prompt copies by Claude Code and Codex is not observed.
- Skills come from public sources only, and only MIT and Apache-2.0 skills install.
- `bowerloom revise` refuses once a project holds content added after setup. The fix comes in a later 0.7 release.
- Bowerloom keeps history and deletes none. A full item needs a manual step. See [the guide](/docs/guides/add-skills/#current-beta-limits).
- The beta needs Node `>=24.11.0 <25`. If a global npm prefix needs `sudo`, set a user prefix instead. See [Install Bowerloom](/docs/start/).

<a id="read-results-at-their-actual-scope"></a>

## Read status fields

Specification readiness means that the inspected files meet their required rules. Runtime readiness and permission to execute remain separate. `ready-for-review` means that the setup needs your review. It does not mean that a team runs.

## Setup and revision

Setup prepares fixed Engineer, Founder, or Research definitions. Exact approval writes 20 setup files and one private receipt.

Revision plans a replacement before applying it. These paths do not import live agent configuration, create hosted agents, or start workers.

## Harnesses

Synthetic configuration commands process selected Codex and Claude Code fixtures. They do not change live configuration or run models.

Portable skill installation supports a new Codex workspace and a new Claude Code workspace. It does not support an existing target. For an existing project, `skills sync` puts skills in place and `apply` puts prompts in place for both harnesses, Claude Code and Codex. A harness is the agent application that reads the copies. Native discovery by Claude Code and Codex is not observed.

A projected file does not prove that an agent discovers or runs it. Read [Codex and Claude Code](/docs/harnesses/).

## Connections

The MCP command plans from three selected synthetic inputs. It does not connect a server, resolve secrets, or invoke tools.

The local backend uses a separate macOS Docker profile. Read [MCP](/docs/mcp/) and [Local backend](/docs/backend/) for their prerequisites.

## Company

Shared company access, retrieval, offboarding, and deletion are outside this beta's documented setup path.

A local setup does not enroll employees or establish a shared service. Real business data needs an approved retention and deletion policy.

## Security

Setup approval grants no unattended execution or connected-tool authority. Review each later action and its required controls separately.

Keep credentials, customer data, raw receipts, and private paths out of shared files. Read [Trust and security boundaries](/docs/security/).

## Help and feedback

Use [GitHub Issues](https://github.com/sageadvicellc/bowerloom/issues) for reproducible bugs.

Ask questions in [Q&A](https://github.com/sageadvicellc/bowerloom/discussions/categories/q-a). Share feedback in [General](https://github.com/sageadvicellc/bowerloom/discussions/categories/general).

Discuss feature proposals in [Ideas](https://github.com/sageadvicellc/bowerloom/discussions/categories/ideas). [Bug reports and feedback](/docs/feedback/) explains what to include.

## Release identity

Use the documentation for your installed version. [Install Bowerloom](/docs/start/) gives the entry path, and [Release notes](/docs/releases/) describes its changes.
