---
title: "Read and review your setup"
description: "Read the local guides, roles, agreement, and actual status before the next decision."
section: "Learn"
order: 4
---

The installed specification connects the proposed roles and handoffs with your project. Read it with your existing personal agent and compare it with the workflow you described. Inspect the working agreement, role prompts, team definition, and handoff map for mismatches. Record any gap before approving later project work. File readiness grants no worker, backend, or connected-action authority.

## Ask your agent

```text
Read my Bowerloom setup guides with me. Explain the roles, agreement, milestones, and actual status, then stop for my review.
```

## Agent procedure

### Prerequisites

Use the matching installed version and the target from your successful approved setup. [Install Bowerloom](/docs/start/) gives the version and requirements.

### Inspect status

Replace the path with your actual target.

```sh
bowerloom init status --target /absolute/projects/clean-install-trial
```

Read `revision`, `status`, `specReady`, `runtimeReady`, `executionAuthorized`, `reviewRequired`, `drift`, and `compiledCandidate`.

`ready-for-review` means that the setup needs your review. It does not mean that a team ran.

If status reports a pending revision or drift, preserve the files. Follow [troubleshooting](/docs/troubleshooting/) before treating the setup as ready.

### Read both guides

Use your agent's existing file reader for `.bowerloom/START-HERE.md`. Then read `.bowerloom/startup-review.md`.

Both paths are relative to your selected project. Bowerloom does not add a separate CLI file-reader command here.

Read the personal-agent profile, team roles, working agreement, and milestones. Compare their declarations with your actual workflow.

Read `team.yaml` and `maps/relay.json` under `.bowerloom/teams/first-team/`. Compare their task dependencies with the agreed handoffs.

### Make the next decision

Review whether the scope, proposed access, and milestones match your needs. Record changes for a new [revision plan](/docs/revision/).

Keep the private receipt, local paths, and access details private. [Files and configuration](/docs/configuration/) separates definitions from local records.

Stop for the human's review. Reading these guides grants no execution, backend, tool connection, or hosted-agent authority.

[Understand teams and files](/docs/concepts/teams-and-files/) · [Plans and approval](/docs/permissions/)
