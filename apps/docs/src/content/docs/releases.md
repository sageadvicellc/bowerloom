---
title: "Release notes"
description: "Read the beta changes, compatibility notes, and routes for feedback."
section: "Help"
order: 27
---

Release notes describe user-visible changes by version. [Current support](/docs/status/) describes supported tasks and limits.

<!-- release:status:start -->
Open beta · 0.7.0-beta.1

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

## 0.7.0-beta.1

### Install

This beta comes as a private archive. A private archive is one `.tgz` file that the team sends you. There is no public npm package. Install it globally, with the full path to the file:

```sh
npm install -g ~/Downloads/bowerloom-0.7.0-beta.1.tgz
bowerloom --version
```

Use the full path where you saved the file. `~/Downloads` is only an example. Inside Claude Code, a `cd` to a folder outside the project does not last, so a path such as `./bowerloom-0.7.0-beta.1.tgz` works only when the command already runs in the folder that holds the file.

The second command prints `Bowerloom 0.7.0-beta.1`. [Install Bowerloom](/docs/start/) has the full steps.

### What the tests covered

We installed this archive globally with npm and ran the installed `bowerloom` command. A pin is the exact npm version or Git commit that a project records for a skill. The tests covered these tasks:

- Install a skill from an npm package and from a Git repository.
- Update a skill to a new pin.
- Resume a change that stopped part way. Resume finishes the approved change.
- Roll back a change that stopped part way. Rollback puts back what was there before.
- Refusals for npm and Git sources. A refusal stops the command with a code. The tests covered a wrong or old approval, a skill copy that you changed, and private records that no longer match.
- Two real public skills. The first is `collections` from the TanStack npm package `@tanstack/db-skills@0.0.1`. The second is `verification-loop` from the ECC repository on GitHub, first at one commit and then at a later commit.
- A teammate who receives a project with its `skills.json`, checks the pins, and reaches the sync step of `bowerloom up`.
- Help, usage errors, and exit codes.

### Known limits

- Two refusals have no test yet: `SKILLS_SYNC_LIMIT` and `SKILLS_CACHE_RECOVERY_REQUIRED`. Tests for both come in 0.7.1.
- Claude Code can run its commands in a sandbox. The sandbox limits what those commands can reach, and it sends web requests through a proxy. A proxy is a server that passes requests on. Bowerloom ignores that proxy and sends its HTTPS requests directly. It also needs connections to `localhost` for its project lock. So when the sandbox is on, Bowerloom cannot reach npm or GitHub from inside Claude Code, and its lock check can fail. Bowerloom has no setting that changes this. Run the `bowerloom` commands outside the sandbox: in your own terminal, or as an excluded command in the Claude Code settings. [Agent sandboxes](/docs/troubleshooting/#agent-sandboxes) shows both ways. 0.7.1 will address the proxy.
- When the lock check fails, the refusal `MANAGED_SKILL_LOCK_SLOT_COLLISION` does not name the port. Its `Next:` line shows `<port>` as written. 0.7.1 fixes this.
- Bowerloom does not add `.claude/skills`, `.claude/commands`, or `.agents/skills` to your `.gitignore`. Add them yourself, as [What to commit](/docs/guides/add-skills/#what-to-commit) says. 0.7.1 fixes this.
- The tests used Node 24.11.0 and npm 11.6.1 on macOS only. They cover no other version or system.
- Bowerloom checks every byte of a skill against its pin, and it checks the skill license. It does not prove that a skill is safe. Read a skill before you approve its plan.
- Workers stay held in this beta. `bowerloom up` ends at `prepared, workers held` and exits 4 with the code `WORKERS_HELD`. No worker starts.

<a id="070-beta0-unreleased"></a>

## 0.7.0-beta.0

Integrate a team specification with an existing project through a fixed Engineer, Founder, or Research profile. A separate unused workspace is optional.

Review the full plan before approval. Exact approval installs 20 setup files and one private receipt.

Plan changes to an installed goal or profile before replacing managed files. Interrupted revisions support recorded resume and rollback actions.

Status reports specification readiness, runtime readiness, execution authority, review requirements, and drift. Setup remains ready for human review without starting workers.

Run `bowerloom up --team <name> --goal <goal>` in a project folder to prepare it one approved step at a time. The run ends at `prepared, workers held`. No worker starts. Install the private archive with `npm install -g ~/Downloads/bowerloom-0.7.0-beta.N.tgz`. Use the full path where you saved the file.

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
