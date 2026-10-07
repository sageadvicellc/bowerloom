---
title: "Beta support and limits"
description: "Find supported tasks, system requirements, and community help for the beta."
section: "Help"
order: 26
---

Bowerloom `0.7.0-beta.0` prepares readable local definitions for your existing personal agent. Use this page to choose a supported task.

<!-- release:support:start -->
Open beta · 0.7.0-beta.0

Setup does not start workers, grant runtime access, or authorize connected actions.

| Capability | Current boundary |
| --- | --- |
| Setup | Prepare a personal-agent profile, team definition, and working agreement in a new or existing project. Exact approval writes the planned files. |
| Portable skills | Project selected skill files into a new Codex workspace. The installer does not prove discovery or execution. |
| Revision | Plan a change to an installed setup, then approve its exact revision before replacement. |
| Execution | Setup does not start workers, grant runtime access, or authorize connected actions. |
| Harnesses | Synthetic configuration commands support Codex and Claude Code fixtures. They do not run models or change live agent configuration. |
| Connections | MCP planning reads selected synthetic files. Local backend installation requires a separate plan and exact approval. |
| Company | Shared company access, retrieval, offboarding, and deletion are outside this beta's documented setup path. |

These guides use macOS arm64 and Node 24.11.0. Other host systems are outside this documented installation path.

Running a team needs separate runtime permissions and controls. The setup commands do not grant them. Shared company access and unattended services are outside this setup walkthrough.
<!-- release:support:end -->

## Beta limits

Keep your project out of iCloud Drive folders. This beta does not support them, and it does not check for them yet. It reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

`bowerloom up --team`, `bowerloom ls`, a `skills.json` file, `bowerloom skills sync`, one-command apply, and commands that create teams, skills, and prompts are not available in this beta release. Today each skill install takes a hand-written request and installs one skill per project. Workers do not start.

<a id="read-results-at-their-actual-scope"></a>

## Read status fields

Specification readiness means that the inspected files meet their required rules. Runtime readiness and permission to execute remain separate. `ready-for-review` means that the setup needs your review. It does not mean that a team runs.

## Setup and revision

Setup prepares fixed Engineer, Founder, or Research definitions. Exact approval writes 20 setup files and one private receipt.

Revision plans a replacement before applying it. These paths do not import live agent configuration, create hosted agents, or start workers.

## Harnesses

Synthetic configuration commands process selected Codex and Claude Code fixtures. They do not change live configuration or run models.

Portable skill installation supports a new Codex workspace. It does not support Claude Code or an existing target.

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
