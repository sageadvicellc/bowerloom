---
title: "Beta guide"
description: "Integrate a workflow with your project. Review the setup, install the beta, choose a startup path, and read the beta limits."
section: "Help"
order: 28.5
---

Use the [setup builder](/#build) to describe the work you already do and the decisions you retain. Your personal agent helps map that process into roles and handoffs, then compares it with a fixed Engineer, Founder, or Research specification. The setup builder prepares text locally. It does not connect your account or start workers.

## Review before installation

Prepare a personal-agent profile, team definition, and working agreement in a new or existing project. Exact approval writes the planned files.

Setup does not start workers, grant runtime access, or authorize connected actions. A portable assistant profile and team blueprint in `.bowerloom` are the complete result of this exercise.

Roles, skills, handoffs, and review expectations stay in files that follow you. Commit `skills.json` and the team, skill, and prompt definitions with your project, and inspect them in another agent application. Keep the installation receipt, the setup notes, and credentials on your machine. Moving definitions does not transfer permissions or prove that another application can execute them.

## Install the beta CLI

Read the [documentation](/docs/) and the [README](https://github.com/sageadvicellc/bowerloom/blob/main/README.md) before you install anything. [Install Bowerloom](/docs/start/) has the full steps.

<!-- release:install:start -->
Install the beta CLI with Node `>=24.11.0 <25` and npm `11`.

```sh
npm install -g bowerloom@beta
bowerloom --version
bowerloom --help
```

First-team setup does not need Docker. The separate local backend requires Docker Desktop and its own plan and approval.

These guides use macOS arm64 and Node 24.11.0. Other host systems are outside this documented installation path.
<!-- release:install:end -->

There is no stable release yet, so the latest tag also points at this beta. Install with @beta to stay on the beta stream. Updates are not automatic. To update, run `npm install -g bowerloom@beta` again. Do not use `npm update -g bowerloom` for this: for a global package, npm updates to the `latest` tag, not to `beta`, and it can downgrade a beta install. If your agent runs in a sandbox that blocks writes outside the project, run the install in your own terminal.

## Choose your startup path

Open a terminal in your project folder and run `bowerloom up --team <name> --goal <goal>` with the team name and goal you choose. It adds only `.bowerloom`, keeps your project files as they are, and does not import `.codex` or `.claude` configuration. If `.bowerloom` already exists from an earlier setup, `up` continues from its state. [Revision](/docs/revision/) changes the goal or profile.

`up` uses the Engineer profile. For `--profile founder` or `--profile research`, use the `init` forms that `bowerloom help advanced` lists. Keep the project out of iCloud Drive, because `init` does not check. After `init apply`, run `bowerloom up --team <name>` to continue with sync and apply. Each template defines a lead, maker, and reviewer. The research profile prepares a protocol. It does not run experiments.

```sh
bowerloom up --team "First team" --goal "Map my existing project workflow from planning through review."
# Review the plan. Run it again with --approve only after approving its exact revision.
bowerloom up --team "First team" --goal "Map my existing project workflow from planning through review." --approve REPLACE_WITH_EXACT_PLAN_REVISION
bowerloom status
```

Each run shows one step and its plan, then exits 3. Repeat with each new revision until `up` prints `prepared, workers held`. Add `--json` to see a plan as one JSON object. Keep inputs unchanged between plan and approval.

After installation, ask your agent to read `.bowerloom/startup-review.md` and `.bowerloom/START-HERE.md` with you. Compare `team.yaml`, the role prompts, the working agreement, and the handoff map with your workflow. Report gaps before any separately approved project work. Plan a change to an installed setup, then approve its exact revision before replacement.

<a id="local-backend"></a>

## Backend operations need separate setup

The prompt builder and local startup files do not need a backend. Backend operations require Docker Desktop and a separate approved Supabase/PostgreSQL setup. MCP planning reads selected synthetic files. Local backend installation requires a separate plan and exact approval.

Vines records logs. Workbench holds repeatable experiments and tests. Their database-backed paths use upstream PostgreSQL. Supabase supplies local database services, and the controller uses the MIT DBOS library. These dependencies do not make a team ready to run.

Use the [backend guide](/docs/backend/) to review the supported setup and its exact approval boundaries. Keep credentials separate from portable files, and never reuse an unrelated database or reset existing data.

<a id="beta-evidence"></a>

## Supported tasks and limits

Setup does not start workers, grant runtime access, or authorize connected actions. Synthetic configuration commands support Codex and Claude Code fixtures. They do not run models or change live agent configuration. Pin skills from npm or GitHub with skills add, then install them for Claude Code and Codex with skills sync. A copy in the project does not prove that Claude Code or Codex finds or runs it. MCP planning reads selected synthetic files. Local backend installation requires a separate plan and exact approval.

<a id="release-plan"></a>

## Beyond local setup

Running a team needs separate runtime permissions and controls. The setup commands do not grant them.

Shared company access and unattended services are outside this setup walkthrough.

Bowerloom is free and open source. Agent accounts, hosting, and connected services can have separate costs.

## Get help and share feedback

Report reproducible bugs in [GitHub Issues](https://github.com/sageadvicellc/bowerloom/issues). Ask questions in [Q&A](https://github.com/sageadvicellc/bowerloom/discussions/categories/q-a). Share general feedback in [General](https://github.com/sageadvicellc/bowerloom/discussions/categories/general). Discuss features in [Ideas](https://github.com/sageadvicellc/bowerloom/discussions/categories/ideas).

[Bug reports and feedback](/docs/feedback/) · [Contribute from source](/docs/contributors/)
