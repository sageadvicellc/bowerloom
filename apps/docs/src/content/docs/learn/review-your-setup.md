---
title: "Read and review your setup"
description: "Read the local guides, roles, agreement, and actual status before the next decision."
section: "Learn"
order: 4
---

The installed setup is a proposal for work. Read it with your existing agent before approving any later effect.

## Ask your agent

```text
Read my Bowerloom setup guides with me. Explain the roles, agreement, milestones, and actual status, then stop for my review.
```

## Agent procedure

### Prerequisites

Use the matching installed version and the target from your successful approved setup. [Install Bowerloom](/docs/start/) records current availability.

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

Read the personal-agent profile, team roles, working agreement, and milestones. Compare their declarations with your actual goal.

### Make the next decision

Review whether the scope, proposed access, and milestones match your needs. Record changes for a new [revision plan](/docs/revision/).

Keep the private receipt, local paths, and access details private. [Files and configuration](/docs/configuration/) separates definitions from local records.

Stop for the human's review. Reading these guides grants no execution, backend, tool connection, or hosted-agent authority.

[Understand teams and files](/docs/concepts/teams-and-files/) · [Plans and approval](/docs/permissions/)
