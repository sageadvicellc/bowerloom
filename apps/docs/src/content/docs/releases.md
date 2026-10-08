---
title: "Release notes"
description: "Read the beta changes, compatibility notes, and routes for feedback."
section: "Help"
order: 27
---

Release notes describe user-visible changes by version. [Current support](/docs/status/) describes supported tasks and limits.

<!-- release:status:start -->
Open beta · 0.7.0-beta.0

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

<a id="070-beta0-unreleased"></a>

## 0.7.0-beta.0

Integrate a team specification with an existing project through a fixed Engineer, Founder, or Research profile. A separate unused workspace is optional.

Review the full plan before approval. Exact approval installs 20 setup files and one private receipt.

Plan changes to an installed goal or profile before replacing managed files. Interrupted revisions support recorded resume and rollback actions.

Status reports specification readiness, runtime readiness, execution authority, review requirements, and drift. Setup remains ready for human review without starting workers.

Run `bowerloom up --team <name> --goal <goal>` in a project folder to prepare it one approved step at a time. The run ends at `prepared, workers held`. No worker starts. Install the private archive with `npm install -g ./bowerloom-0.7.0-beta.N.tgz`.

List a project with `bowerloom ls` and read its state with `bowerloom status`. Create a team, a skill, or a prompt inside `.bowerloom` with `team create`, `skill create`, and `prompt create`.

Pin skills from npm or GitHub in `.bowerloom/skills.json` with `skills add`. Check the pins with `skills check`. Install them with `skills sync`, and put them in place for Claude Code and Codex with `apply`. Only exact pins and MIT or Apache-2.0 skills are accepted. Commit `skills.json` and your authored skills. Managed copies and the `.claude` and `.agents` projections stay on each machine.

Every change shows a plan and needs `--approve <revision>`. Exit codes are 0 done, 1 refused, 2 usage, 3 approval required, and 4 held by a gate. There is no `--yes`. Project commands refuse a project in a cloud-synced folder with `PROJECT_IN_CLOUD_FOLDER`. `bowerloom help` and `bowerloom help advanced` list the commands.

Project selected portable skill files into a new Codex or Claude Code workspace. MCP planning reads selected synthetic inputs without connecting a server.

## Compatibility

Older installations keep their original format and identity rules. The current Darwin identity policy does not silently rewrite their receipts.

Use the matching installed version for setup changes. Inspect pending transactions and private receipts before any recovery.

The `trellis` and `trellis-mcp` names remain compatibility aliases. They grant no different permissions.

## Historical records

Earlier source releases and test records remain in the repository. Their results apply to their original version and task.

The `v0.7-workbench` Labs label does not identify the framework package. [Workbench](/docs/workbench/) explains comparison records.

<a id="publication-and-support"></a>

## Feedback

Report problems through [Bug reports and feedback](/docs/feedback/). Use Q&A for questions, General for feedback, and Ideas for features. [Roadmap](/docs/roadmap/) separates estimated future stages from these shipped changes.
