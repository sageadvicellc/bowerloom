---
title: "Install Bowerloom"
description: "Install the private beta archive, read its version, and prepare your first project."
section: "Start here"
order: 1
---

Bowerloom brings governance to the agent teams, skills, and prompts in your project. It shows a plan before every change. It writes only after you approve that exact plan. It pins every third-party skill to an exact version or commit. It accepts only MIT and Apache-2.0 skills. It copies text files and runs nothing. In this beta no worker starts.

Install the `bowerloom` command from the private archive that you received. Then run one command in a project folder. Each step shows its plan first, and you approve each step.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

<a id="ask-your-personal-agent"></a>

## Ask your agent

```text
Read the Bowerloom installation guide for 0.7.0-beta.1. Review the requirements and the install command with me. After installation, read the version and help. Ask me for the team name and the goal. Then run bowerloom up for my project and show me each plan. Wait for my exact approval of each step. Do not start workers, and do not edit AGENTS.md or CLAUDE.md.
```

## Agent procedure

<a id="prerequisites-and-availability"></a>

### Prerequisites and installation

You need Node `>=24.11.0 <25` and npm `11`. The Node range comes from the `engines` field of the product's `package.json`.

You received a private archive named `bowerloom-0.7.0-beta.1.tgz`. The package is not on the public npm registry.

Stop before you install. Show the human the install command below and what it does, and wait for the human's approval. The command installs the archive globally, with the full path to the file:

```sh
npm install -g ~/Downloads/bowerloom-0.7.0-beta.1.tgz
bowerloom --version
bowerloom --help
```

Use the full path where you saved the file. `~/Downloads` is only an example. Inside Claude Code, a `cd` to a folder outside the project does not last, so a path such as `./bowerloom-0.7.0-beta.1.tgz` works only when the command already runs in the folder that holds the file.

npm reports the packages it added and exits 0. For the `0.7.0-beta.1` archive, `bowerloom --version` prints this line:

```text
Bowerloom 0.7.0-beta.1
```

`bowerloom --help` starts with these two lines:

```text
Bowerloom 0.7.0-beta.1: open beta
Setup does not start workers, grant runtime access, or authorize connected actions.
```

If npm refuses with a permission error, do not use `sudo`. Set a user prefix for global packages instead:

```sh
mkdir -p "$HOME/.npm-global"
npm config set prefix "$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"
```

Add the `export` line to your shell profile so that new terminals find `bowerloom`. Then run the install command again.

First-team setup does not need Docker. The separate local backend requires Docker Desktop and its own plan and approval.

These guides use macOS arm64 and Node 24.11.0. Other host systems are outside this documented installation path.

<a id="check-the-installed-command"></a>

### Read the installed identity

After installation, read the version and help:

```sh
bowerloom --version
bowerloom --help
bowerloom help advanced
```

The short help lists the commands you use first. `bowerloom help <command>` shows the full help for one command. `bowerloom help advanced` lists every form, including the older request-file forms. [CLI reference](/docs/cli/) explains each command.

Use the documentation that matches your installed version.

### Prepare a project with one command

If Claude Code runs with its sandbox on, run the `bowerloom` commands outside it. [Agent sandboxes](/docs/troubleshooting/#agent-sandboxes) shows how.

Before the first `up`, ask the human for the team name and the goal. Do not choose them yourself. Then open a terminal in your project folder and run `up` with that team name and goal:

```sh
bowerloom up --team "Studio crew" --goal "Prepare a fictional onboarding kit for an independent design studio."
```

`up` looks at the project and shows one next step at a time. In a terminal it asks before each step. An agent passes `--approve <revision>` instead. The steps are:

1. `init` sets up `.bowerloom` in this folder. It needs `--goal`.
2. `team` creates the team when the name is neither `first-team` nor a team you created.
3. `sync` installs the pinned skills of the team, when `.bowerloom/skills.json` lists any.
4. `apply` puts the skills and prompts of the team in place for Claude Code and Codex.

Each run without `--approve` prints the plan and its revision, then exits 3. This is the first plan that `up` showed in the test run for this release:

```text
Next step: init. Set up .bowerloom in this folder for team Studio crew.
  Project: studio
  Goal: Prepare a fictional onboarding kit for an independent design studio.
  Folder: ~/code/studio (an existing folder: adds .bowerloom only, and your files stay as they are)
  Team: Studio crew (first-team)
  Creates 20 setup files and a private installation receipt in .bowerloom.
Then each run shows the next step, if any: team, skills sync and apply, each with its own plan. Workers stay held.
This writes setup files only. It starts no workers and runs nothing.
Revision: a42ec3be3b5e38c2181ccb3418668e395fda471fdab2bb5f1201397e4cdd8078
Approval required. Run the same command again with --approve a42ec3be3b5e38c2181ccb3418668e395fda471fdab2bb5f1201397e4cdd8078
```

The project name comes from the folder name. Your revision will differ from this one. Use the revision that your own plan prints.

Show the plan to the human. After the human approves it, run the same command again with the revision:

```sh
bowerloom up --team "Studio crew" --goal "Prepare a fictional onboarding kit for an independent design studio." --approve REVISION_FROM_THE_PLAN
```

That run applies the step whose revision matches and prints `Applied plan <revision>.` If a step is left, it then shows the next plan and exits 3. Repeat until the project is prepared.

When no step is left, the run prints `prepared, workers held` and exits 4. In the test run for this release, the project needed only the `init` step. So the first approved run was also the last, and it printed this text:

```text
Applied plan a42ec3be3b5e38c2181ccb3418668e395fda471fdab2bb5f1201397e4cdd8078.
prepared, workers held
  Team: Studio crew (first-team), with skills and prompts in place for Claude Code and Codex.
  Next: read .bowerloom/START-HERE.md. This beta starts no worker; worker launch comes after the startup gate.
```

The test run also recorded standard error. It held one line of JSON with the code `WORKERS_HELD`.

When a skill, prompt, or team is held or gone, the last run prints `prepared, N items held` instead, with a next command for each item. Press Ctrl-C or Ctrl-D at the yes/no question to stop. It prints `Stopped. Nothing was changed.` and exits 130. Exit 4 means a gate holds the workers. It does not mean the command failed. Read [Approvals and exit codes](/docs/cli/#approvals-and-exit-codes).

`up` never edits `AGENTS.md` or `CLAUDE.md`, and it never runs `claude`, `codex`, or any other program.

<a id="if-installation-cannot-proceed"></a>

### If installation fails

Read the npm error before you try another command. Make sure that your Node and npm versions meet the requirements above.

If the installed version differs from the archive name, use the matching documentation. Keep the original error for a sanitized [bug report](/docs/feedback/#report-a-bug).

Do not use an unknown archive or a different package name to get around an installation failure.

## Choose the next task

- [Integrate your first team](/docs/learn/first-team/) walks through `up` step by step.
- [Add third-party skills](/docs/guides/add-skills/) pins skills from npm and GitHub, syncs them, and applies them.
- [Create teams, skills, and prompts](/docs/guides/create-items/) covers the create commands.
- If `.bowerloom/` already exists from an earlier setup, `up` continues from its state. [Revision](/docs/revision/) changes the goal or profile.

Source development follows [Contribute from source](/docs/contributors/). [Installation troubleshooting](/docs/troubleshooting/#installation) covers failed or mismatched installations.

[Bug reports and feedback](/docs/feedback/) explains where to ask questions and report problems.
