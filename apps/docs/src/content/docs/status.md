---
title: "Beta support and limits"
description: "Find supported tasks, system requirements, and community help for the beta."
section: "Help"
order: 26
---

Bowerloom `0.8.0-beta.1` keeps one harness for a project and installs it for Claude Code and Codex, after a preview. Use this page to choose a supported task.

<!-- release:support:start -->
Open beta · 0.8.0-beta.1

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

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads pinned skills only from public sources. A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`, as [Where your items come from](/docs/guides/item-sources/#private-store) explains. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

## What 0.8.0-beta.1 supports

- Engines: Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines. They work only with `BOWERLOOM_PREVIEW_ENGINES=1`, and install refuses them without it.
- The harness commands `status`, `adopt`, `install`, `accept`, `merge`, `drift`, `remove`, and `recover`. [Adopt and install a harness](/docs/guides/adopt-and-install/) and the [CLI reference](/docs/cli/#harness) cover them.
- A fidelity report for each engine and each part: exact, translated, weakened, or absent. A rule that an engine carries more weakly needs your approval, line by line. [Harness, engines, and fidelity](/docs/concepts/harness-and-fidelity/) explains it.
- The Codex permission profile for path rules and sandbox rules. [Codex and Claude Code](/docs/harnesses/#the-codex-permission-profile) explains it.
- The [desktop app](/docs/app/), a beta for macOS, with the Builder, the save step, Save points, Go back, and Set aside. Apple did not sign it.
- [Notes and the Notes keeper](/docs/guides/notes/): notes folders, and the ready-made agent and six skills that look after them.
- `bowerloom report` and `bowerloom events`, which make a diagnostic bundle and show the local event log. Nothing is sent by itself.

## Limits of 0.8.0-beta.1

- No Bowerloom command runs an engine or a model, and no worker starts.
- The desktop app is a beta and is not signed or notarized. It has no automatic updates. The save step, save points, and the Builder exist only in the app.
- This guide set uses macOS arm64 and Node 24.11.0. Other host systems are outside the documented path.
- Preview engines are not supported in this beta.
- A projected file does not prove that an engine finds or runs it.

## The 0.7 commands that remain

Bowerloom `0.7.0` added these commands, and each one is documented. They still appear in the CLI help of 0.8.0-beta.1.

- `bowerloom up --team <name>` prepares a project one approved step at a time and ends at `prepared, workers held`, or at `prepared, N items held` with a next command for each item.
- `bowerloom ls` and `bowerloom status` read the project and write nothing.
- `bowerloom team create`, `skill create`, and `prompt create` make files inside `.bowerloom`, or in your store with `--global`.
- `.bowerloom/skills.json` pins skills at exact versions and commits. `skills add`, `skills check`, `skills sync`, `skills recover`, and `skills migrate` manage it.
- `bowerloom skills sync` puts the pinned skills in place for Claude Code and Codex. `bowerloom apply` puts the prompts in place, and any skill copy that is still missing, and copies the agents of a team to `.claude/agents` for Claude Code.
- `bowerloom use`, `unuse`, and `team adopt` pick items for a project.
- `bowerloom lock verify` and `lock update` keep `bowerloom.lock.json`.
- `bowerloom store status`, `store migrate`, and `receipt clean` manage your store.
- `bowerloom cache list` and `cache prune` manage this machine's caches.
- `bowerloom apply --frozen` and `skills sync --frozen` install only what the lock records.

Every change shows a plan first and needs `--approve <revision>`. Exit codes are 0 done, 1 refused, 2 usage, 3 approval required, and 4 held by a gate, and 130 stopped at the yes/no question. See [Approvals and exit codes](/docs/cli/#approvals-and-exit-codes).

These limits of the 0.7 commands are current facts of this beta:

- No worker starts. `up` ends at `prepared, workers held`.
- Native discovery of the skill, prompt and agent copies by Claude Code and Codex is not observed.
- Codex agents are not projected in this beta. Context slices are projected for Claude Code only. This is true of `bowerloom apply`. `bowerloom harness install` writes Codex agents to `.codex/agents`.
- `bowerloom status` names a slice file that was edited, a slice that is held, and an installed slice index that is out of date, each with its next step.
- `bowerloom status` does not report the files of a team's `agents/` folder as edited. It reports a bad agent file as `owner-refused` with `AGENT_INVALID`. For an agent whose source is gone, or that is held while an older copy is installed, it prints `agent <role>: installed copy still active` with the notices of that copy. When the rest of the apply plan is refused, `status` prints `plan unavailable (<code>)` and still plans the agents on their own.
- Pinned third-party skills come from public npm and GitHub sources, and only MIT and Apache-2.0 skills install. Store items come from your store, or from its GitHub remote on a teammate's machine. A store in a private repository needs `BOWERLOOM_GITHUB_TOKEN`.
- `bowerloom revise` refuses once a project holds content added after setup. The fix comes in a later 0.7 release.
- Bowerloom keeps history and deletes none. A full item needs a manual step. See [the guide](/docs/guides/add-skills/#current-beta-limits).
- The beta needs Node `>=24.11.0 <25`. If a global npm prefix needs `sudo`, set a user prefix instead. See [Install Bowerloom](/docs/start/).

<a id="read-results-at-their-actual-scope"></a>

## Read status fields

Specification readiness means that the inspected files meet their required rules. Runtime readiness and permission to execute remain separate. `ready-for-review` means that the setup needs your review. It does not mean that a team runs.

## Setup and revision (0.7)

Setup prepares fixed Engineer, Founder, or Research definitions. Exact approval writes 20 setup files and one private receipt.

Revision plans a replacement before applying it. These paths do not import live agent configuration, create hosted agents, or start workers.

## Harnesses

`bowerloom harness adopt` and `install` work on your real project files, after you approve a plan. They support Claude Code and Codex. They do not run an engine or a model. The older `--synthetic` forms process selected fixture files only.

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
