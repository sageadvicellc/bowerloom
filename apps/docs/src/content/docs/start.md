---
title: "Install Bowerloom"
description: "Read the requirements, learn when the CLI arrives, and adopt your first harness."
section: "Start here"
order: 1
---

Bowerloom lets you define one harness and install it into Claude Code and Codex. It shows a plan before every change. It writes only after you approve that exact plan. It copies text files and runs no engine and no model.

This page covers the command line. The [desktop app](/docs/app/) is the other way to use Bowerloom 0.8.0-beta.1. It is a beta, and it has its own install steps for the unsigned macOS app.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads pinned skills only from public sources. A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`, as [Where your items come from](/docs/guides/item-sources/#private-store) explains. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

<a id="ask-your-personal-agent"></a>

## Ask your agent

```text
Read the Bowerloom installation guide for 0.8.0-beta.1. Review the requirements with me. Tell me whether the CLI is published yet. When it is installed, read the version and help. Then run bowerloom harness status in my project, and show me each plan before you write anything. Wait for my exact approval of each step. Do not start an engine, and do not edit AGENTS.md or CLAUDE.md by hand.
```

## Agent procedure

<a id="prerequisites-and-availability"></a>

### Prerequisites and installation

You need Node `>=24.11.0 <25` and npm `11`. The Node range comes from the `engines` field of the product's `package.json`.

The CLI arrives on npm as `bowerloom`, under the `beta` dist-tag, when the beta publishes. A dist-tag is a name that points at one published version. This page shows no install command until then, because the package is not published yet. [Release notes](/docs/releases/) says when it is.

A colleague who was given a `bowerloom-0.8.0-beta.1.tgz` file can install it by its full path, such as `npm install -g ~/Downloads/bowerloom-0.8.0-beta.1.tgz`. Installing from a downloaded .tgz file gives the same dependency versions as the tested build. The file carries its dependencies, so it installs with no network and no npm cache. If your agent runs in a sandbox that blocks writes outside the project, ask the human to run the install command in their own terminal.

After installation, `bowerloom --version` prints this line:

```text
Bowerloom 0.8.0-beta.1
```

`bowerloom --help` starts with these two lines:

```text
Bowerloom 0.8.0-beta.1: open beta
Setup does not start workers, grant runtime access, or authorize connected actions.
```

If npm refuses an install with a permission error, do not use `sudo`. Set a user prefix for global packages instead:

```sh
mkdir -p "$HOME/.npm-global"
npm config set prefix "$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"
```

Add the `export` line to your shell profile so that new terminals find `bowerloom`. Then install again.

Harness commands and first-team setup do not need Docker. The separate local backend requires Docker Desktop and its own plan and approval. The separate local backend requires Docker Desktop and its own plan and approval.

These guides use macOS arm64 and Node 24.11.0. Other host systems are outside this documented installation path.

<a id="check-the-installed-command"></a>

### Read the installed identity

After installation, read the version and help:

```sh
bowerloom --version
bowerloom --help
bowerloom help harness
bowerloom help advanced
```

The short help lists the commands you use first. `bowerloom help <command>` shows the full help for one command. `bowerloom help harness` lists the harness commands. `bowerloom help advanced` lists every form, including the older request-file forms. [CLI reference](/docs/cli/) explains each command.

Use the documentation that matches your installed version.

### Adopt your first harness

Open a terminal in your project folder. Read the state, then adopt the engine files that the project already has:

```sh
bowerloom harness status
bowerloom harness adopt
```

`adopt` prints a plan and its revision, and exits 3. It writes only `.bowerloom`. Show the plan to the human. After the human approves it, run the same command with `--approve <revision>`. Then run `bowerloom harness install` the same way. [Adopt and install a harness](/docs/guides/adopt-and-install/) shows every flag and every refusal.

<a id="prepare-a-project-with-one-command"></a>

### Prepare a team with `up` (0.7 flow)

This flow comes from 0.7. It sets up a personal agent and a team, and it is described under Legacy 0.7 team setup. The harness commands above are the current path.

If Claude Code runs with its sandbox on, run the `bowerloom` commands outside it. [Agent sandboxes](/docs/troubleshooting/#agent-sandboxes) shows how.

Before the first `up`, ask the human for the team name and the goal. Do not choose them yourself. Then open a terminal in your project folder and run `up` with that team name and goal:

```sh
bowerloom up --team "Studio crew" --goal "Prepare a fictional onboarding kit for an independent design studio."
```

`up` looks at the project and shows one next step at a time. In a terminal it asks before each step. An agent passes `--approve <revision>` instead. The steps are:

1. `init` sets up `.bowerloom` in this folder. It needs `--goal`.
2. `team` creates the team when the name is neither `first-team` nor a team you created.
3. `sync` installs the pinned skills of the team and copies them into place for Claude Code and Codex, when `.bowerloom/skills.json` lists any.
4. `apply` puts the prompts of the team in place for Claude Code and Codex, and any skill copy that sync did not place.

Each run without `--approve` prints the plan and its revision, then exits 3. This is the first plan that `up` showed in the test run for this release:

```text
Next step: init. Set up .bowerloom in this folder for team Studio crew.
  Project: studio
  Goal: Prepare a fictional onboarding kit for an independent design studio.
  Folder: ~/studio (an existing folder: adds .bowerloom only, and your files stay as they are)
  Team: Studio crew (first-team)
  Creates 20 setup files and a private installation receipt in .bowerloom.
Then each run shows the next step, if any: team, skills sync and apply, each with its own plan. Workers stay held.
This writes setup files only. It starts no workers and runs nothing.
Revision: a42ec3be3b5e38c2181ccb3418668e395fda471fdab2bb5f1201397e4cdd8078
Approval required. Run the same command again with --approve a42ec3be3b5e38c2181ccb3418668e395fda471fdab2bb5f1201397e4cdd8078
```

Bowerloom prints the full path of the folder. This example shows it as `~/studio`. The project name comes from the folder name. Your revision will differ from this one. Use the revision that your own plan prints.

Show the plan to the human. After the human approves it, run the same command again with the revision:

```sh
bowerloom up --team "Studio crew" --goal "Prepare a fictional onboarding kit for an independent design studio." --approve REVISION_FROM_THE_PLAN
```

That run applies the step whose revision matches and prints `Applied plan <revision>.` If a step is left, it then shows the next plan and exits 3. Repeat until the project is prepared.

When no step is left, the run prints `prepared, workers held` and exits 4. In the test run for this release, the project needed only the `init` step. So the first approved run was also the last, and it printed this text:

```text
Applied plan a42ec3be3b5e38c2181ccb3418668e395fda471fdab2bb5f1201397e4cdd8078.
prepared, workers held
  Team: Studio crew (first-team), with skills, prompts, agents, and context slices in place for Claude Code and Codex.
  Next: read .bowerloom/START-HERE.md. This beta starts no worker; worker launch comes after the startup gate.
```

The test run also recorded standard error. It held one line of JSON with the code `WORKERS_HELD`.

When a skill, prompt, agent, or team is held or gone, the last run prints `prepared, N items held` instead, with a next command for each item. Press Ctrl-C or Ctrl-D at the yes/no question to stop. It prints `Stopped. Nothing was changed.` and exits 130. Exit 4 means a gate holds the workers. It does not mean the command failed. Read [Approvals and exit codes](/docs/cli/#approvals-and-exit-codes).

`up` never edits `AGENTS.md` or `CLAUDE.md`, and it never runs `claude`, `codex`, or any other program.

<a id="if-installation-cannot-proceed"></a>

### If installation fails

Read the npm error before you try another command. Make sure that your Node and npm versions meet the requirements above.

If the installed version differs from the version these docs name, use the matching documentation. Keep the original error for a sanitized [bug report](/docs/feedback/#report-a-bug).

Do not use an unknown package or archive to get around an installation failure.

## Choose the next task

- [Desktop app (beta)](/docs/app/) shows the same steps on screen.
- [Adopt and install a harness](/docs/guides/adopt-and-install/) covers the command path.
- [Add third-party skills](/docs/guides/add-skills/) pins skills from npm and GitHub, syncs them, and applies them.
- [Integrate your first team](/docs/learn/first-team/) walks through the 0.7 `up` flow step by step.

Source development follows [Contribute from source](/docs/contributors/). [Installation troubleshooting](/docs/troubleshooting/#installation) covers failed or mismatched installations.

[Bug reports and feedback](/docs/feedback/) explains where to ask questions and report problems.
