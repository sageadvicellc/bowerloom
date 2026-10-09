---
title: "Integrate your first team"
description: "Prepare your project for a team with bowerloom up, and approve each step."
section: "Learn"
order: 3
---

Integrate a team with the project you already use. First [map your existing workflow](/docs/guides/integrate-workflow/) and compare it with a fixed profile. Then run `bowerloom up --team <name> --goal <goal>` in the project folder. Each step adds only `.bowerloom` and the skill copies. It shows its exact plan first. It writes after you approve that plan. Your other project files stay as they are.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

## Ask your agent

```text
Help me prepare this project for a Bowerloom team with bowerloom up. Use the workflow description we reviewed. Ask me for the team name and the goal first. Run each step without --approve first, and show me the plan and its revision. Wait for my exact approval of each step, then run the same command with that revision. Stop at "prepared, workers held". Do not start workers, do not edit AGENTS.md or CLAUDE.md, and do not import live agent configuration.
```

## Agent procedure

### Prerequisites

Install the matching CLI version through [Install Bowerloom](/docs/start/).

Open a terminal in the project folder. The folder must be outside iCloud Drive and other cloud-synced folders.

A folder with no `.bowerloom` needs `--goal`. The project name is the folder name unless you pass `--name`.

### Plan the first step

Ask the human for the team name and the goal before the first `up`. Do not choose them yourself. This example uses the team `Studio crew` and a goal from the test run for this release.

```sh
bowerloom up --team "Studio crew" --goal "Prepare a fictional onboarding kit for an independent design studio."
```

The first plan is the `init` step. Read the folder, the team, and the count of setup files. The plan ends with a revision and exit code 3. Nothing is written yet. [Install Bowerloom](/docs/start/#prepare-a-project-with-one-command) shows the plan that this command printed in the test run for this release.

### Wait for exact approval

Wait for the human to approve the plan. Replace `REVISION_FROM_THE_PLAN` with its complete 64-character revision. Keep every other input identical.

```sh
bowerloom up --team "Studio crew" --goal "Prepare a fictional onboarding kit for an independent design studio." --approve REVISION_FROM_THE_PLAN
```

The command applies the step whose revision matches and prints `Applied plan <revision>.` If a step is left, it then prints the next plan and exits 3. A changed project gives a different revision, and the old approval refuses with `STALE_APPROVAL`.

Repeat for each later step. Later steps are `team`, `sync`, and `apply`, and `up` shows only the steps your project needs. Once the folder holds `.bowerloom`, `up` ignores `--goal`.

### Read the result

When no step is left, `up` prints `prepared, workers held`, points to `.bowerloom/START-HERE.md`, and exits 4. No worker started. If an item is held, it prints `prepared, N items held` and a next command for each item.

```sh
bowerloom status
bowerloom ls
```

When nothing drifted, `bowerloom status` reports `Setup: ready`. It also prints `Workers: none started (this beta starts none)`. With `--json`, it reports `runtimeReady` and `executionAuthorized` as false. `bowerloom ls` lists the teams, skills, and prompts in the project.

Approval of the `init` step adds 20 setup files and one private receipt. Unrelated project files remain unchanged.

### If the command refuses

If the plan changed after you saw it, the refusal is `STALE_APPROVAL`. Nothing was applied. Run the command again without `--approve` to see the new plan.

If you declined in a terminal, the refusal is `APPROVAL_DECLINED`. Nothing changed.

If a refusal names `PROJECT_IN_CLOUD_FOLDER`, move the project out of the synced folder. See [Errors](/docs/reference/errors/#project-and-approval-refusals).

If a revision is pending from an earlier setup, preserve its transaction records. Use [revision recovery](/docs/guides/recover-revision/).

Continue with [Read and review your setup](/docs/learn/review-your-setup/).
