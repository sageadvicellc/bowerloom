<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/hero-dark.png">
  <img src="docs/assets/readme-beta/exports/hero-light.png" alt="Bowerloom, with Hanna, S4-G3, and H4N-N4 in the tree laboratory." width="100%">
</picture>

# Grow your capabilities with Bowerloom

<p>
  <a href="https://bowerloom.ai/docs/releases/"><img src="docs/assets/badge-version.svg" alt="Current beta version" height="28"></a>
  <a href="LICENSE"><img src="docs/assets/badge-license.svg" alt="Package license declaration: MIT" height="28"></a>
  <a href="package.json"><img src="docs/assets/badge-node.svg" alt="Node 24.11 through 24.x" height="28"></a>
  <a href="#install-bowerloom"><img src="docs/assets/badge-npm.svg" alt="npm 11" height="28"></a>
</p>

Bowerloom is an open-source framework for building agent teams in files you can read.

Start with your personal agent and a small task you can review. Prepare a team. Inspect its roles and proposed access. Approve the exact setup plan.

Setup creates files. It does not start workers or grant permission to execute the team.

[Main site](https://bowerloom.ai) · [Documentation](https://bowerloom.ai/docs/) · [Build with your agent](#build-with-your-agent)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/release-status-dark.png">
  <img src="docs/assets/readme-beta/exports/release-status-light.png" alt="">
</picture>

## Release status

<!-- release:status:start -->
Open beta · 0.7.0-beta.0

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/getting-started-dark.png">
  <img src="docs/assets/readme-beta/exports/getting-started-light.png" alt="">
</picture>

## Build with your agent


![Hanna and S4-G3 study a holographic plan in a tree laboratory.](docs/assets/readme-beta/images/startup.webp)

Start with the [team setup guide](https://bowerloom.ai/docs/setup/). Choose Engineer, Founder, or Research & development. Describe your goal and review cadence.

Your personal agent helps you review the proposed roles, access, worker limit, files, and working agreement. A working agreement records scope, responsibilities, and review points.

The setup uses fixed templates. It does not inspect your project or establish that your goal is feasible. You and your agent review that starting point before later work.

### Install Bowerloom

<!-- release:install:start -->
Install the beta CLI with Node `>=24.11.0 <25` and npm `11`.

```sh
npm install --global bowerloom@0.7.0-beta.0
bowerloom --version
bowerloom --help
```

First-team setup does not need Docker. The separate local backend requires Docker Desktop and its own plan and approval.

These guides use macOS arm64 and Node 24.11.0. Other host systems are outside this documented installation path.
<!-- release:install:end -->

### Plan the setup

Give your existing personal agent this starting request:

```text
Read the Bowerloom documentation and its init command.
Help me choose a new workspace or an existing project.
Use my goal to prepare a personal-agent profile and first team.
Show the full file plan and working agreement before installation.
Wait for my approval of the exact plan revision.
After installation, inspect the files with init status.
Read .bowerloom/startup-review.md and .bowerloom/START-HERE.md.
Stop for my review.
Do not start workers or import Claude or Codex settings.
```

After CLI installation, plan a new workspace:

```sh
bowerloom init plan --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Plan an accessible project website and its meaningful checks."
```

Replace the example target with your absolute project path. Use an existing parent directory and an unused target for `new` mode.

For an existing project, plan with `--mode existing` and its absolute directory:

```sh
bowerloom init plan --mode existing --target /absolute/projects/existing-project --profile engineer --name "First team" --goal "Plan an accessible project website and its meaningful checks."
```

That mode adds only `.bowerloom/`. It leaves project files and agent application settings unread and unchanged.

A previous `.bowerloom/` directory blocks a new installation. Use the separate revision flow to change an installed setup.

The default review explains the proposed files and approval effect. Add `--json` to read every generated file and content hash.

### Approve the exact files

Read the plan before installation. Keep the target, profile, name, goal, and other inputs identical to the reviewed plan.

Replace `REPLACE_WITH_EXACT_PLAN_REVISION` with the revision from your selected plan. Keep the same installed version.

For the new-workspace plan, use:

```sh
bowerloom init apply --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Plan an accessible project website and its meaningful checks." --approve REPLACE_WITH_EXACT_PLAN_REVISION
bowerloom init status --target /absolute/projects/first-team
```

For the existing-project plan, use its own exact approval revision and target:

```sh
bowerloom init apply --mode existing --target /absolute/projects/existing-project --profile engineer --name "First team" --goal "Plan an accessible project website and its meaningful checks." --approve REPLACE_WITH_EXACT_PLAN_REVISION
bowerloom init status --target /absolute/projects/existing-project
```

A changed input requires a new plan and approval. The installation approval permits only the listed setup files. It starts no workers, backend services, or connected tools.

Read `.bowerloom/startup-review.md` and `.bowerloom/START-HERE.md` with your personal agent. Stop for review before execution or connection work.

The Engineer profile defines an engineering lead, implementation maker, and code reviewer. Founder and Research profiles use different fixed role templates.

Read the [configuration reference](https://bowerloom.ai/docs/configuration/) for file boundaries. Read [revision and recovery](https://bowerloom.ai/docs/revision/) before changing an installed goal.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/portable-teams-dark.png">
  <img src="docs/assets/readme-beta/exports/portable-teams-light.png" alt="">
</picture>

## Portable teams


Team and skill definitions live outside any one agent application. You can read and version those files.

File portability does not establish execution in another application. Current harness commands process selected synthetic files, which contain fictional test data. These fixture commands do not run models or change live configuration.

The [harness guide](https://bowerloom.ai/docs/harnesses/) separates import, proposed changes, exact write approvals, removal, and recovery. None of those fixture commands authorizes model execution.

Copying portable definitions requires its own reviewed plan and exact approval. It starts no workers.

Before sharing definitions, review the saved project name, goal, and brief text. Those fields can contain private information. Exclude installation receipts, private bindings, credentials, and execution records.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/architecture-dark.png">
  <img src="docs/assets/readme-beta/exports/architecture-light.png" alt="">
</picture>

## Inside `.bowerloom/`


This setup separates portable definitions from its private installation receipt. The text tree shows the proposed installed layout. Planning proposes 20 definition files. Approved installation adds one private receipt.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/structure-dark.png">
  <img src="docs/assets/readme-beta/exports/structure-light.png" alt="Startup proposes 20 portable files under .bowerloom. Approved installation adds one private receipt. The text tree below lists every file.">
</picture>

```text
.bowerloom/
├── START-HERE.md
├── brief.json
├── manifest.json
├── milestones.md
├── optional-controls.md
├── skills/
│   └── personal-assistant/
│       ├── SKILL.md
│       └── profile.json
├── startup-review.md
├── startup.json
├── teams/
│   └── first-team/
│       ├── assets/
│       │   ├── brief.json
│       │   ├── milestones.md
│       │   └── working-agreement.md
│       ├── maps/
│       │   ├── relay.json
│       │   └── vines.json
│       ├── prompts/
│       │   ├── lead.md
│       │   ├── maker.md
│       │   └── reviewer.md
│       ├── skills/
│       │   └── bounded-draft.md
│       └── team.yaml
├── working-agreement.md
└── installation-receipt.json  [private; created during installation]
```

| Part | What it contains |
| --- | --- |
| `START-HERE.md` and `startup-review.md` | Your goal, proposed setup, first decision, and review instructions |
| `brief.json` | Your explicit project name, goal, profile, and review choices |
| `skills/personal-assistant/` | Guidance and a profile for your existing agent |
| `teams/first-team/` | The team definition, prompts, skill, source assets, and communication and logging maps |
| `working-agreement.md` and `milestones.md` | Responsibilities, boundaries, and review points |
| `manifest.json` and `startup.json` | Bundle contents and startup document references |
| `optional-controls.md` | Instructions for separately approved local connections and registered-work stops |
| `installation-receipt.json` | The private target path, exact approval, file hashes, and compiler evidence |

The logging map declares future channels. Setup does not open connections or create a logging service. A compiled definition is not a running team.

The generated setup contains no `.bowerloom/routines/` directory. These setup commands do not schedule work or start event triggers.

Private connection bindings, credentials, and runtime state need separate locations and approvals. This diagram does not place them inside the portable definition folders.

## Meet the workshop

| Module | Responsibility and current boundary |
| --- | --- |
| Teams | Roles, skills, and permission definitions. Startup produces a specification, without running the team. |
| Relay | Communication definitions and approved local links. A link grants no execution or write authority. |
| Roots | Source-linked knowledge and controlled access. Shared company retrieval and access are outside the documented setup path. |
| Vines | Logs that record work. Startup declares logging maps without a running logging service. |
| Workbench | Repeatable scenarios and comparison records. Setup does not execute a comparison. |

Module names describe responsibilities. They do not imply equal readiness. Read [current support](https://bowerloom.ai/docs/status/) for supported tasks and limits.

MCP, a standard connection between agents and tools, also has separate boundaries. The `mcp plan` command reads selected synthetic declarations and recorded catalogs. It does not contact a server or authorize tool calls.

MCP planning supplies no public server connection or tool-call command. Read the [MCP guide](https://bowerloom.ai/docs/mcp/) for its boundaries.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/labs-workflow-dark.png">
  <img src="docs/assets/readme-beta/exports/labs-workflow-light.png" alt="">
</picture>

## The Labs workflow

The first Sagespec team brought together a Knowledge officer, Brand review, and a Tech lead. Their Bowerloom work connects source knowledge, brand direction, and technical delivery.

| Role | Responsibility |
| --- | --- |
| Knowledge officer | Maintains the wiki and source records, then turns source material into specifications |
| Brand review | Sets the identity and creative direction, delegates design, and reviews the result |
| Tech lead | Defines technical scope, assigns specialists, and brings evidence and decisions to the founder |

The internal `v0.7-workbench` label marks this Labs experiment. It is not an end-user release version or the public Workbench module.

The workflow describes development responsibilities. It does not establish that the Bowerloom runtime independently executed the entire Sagespec team. Sagespec remains private.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/approvals-dark.png">
  <img src="docs/assets/readme-beta/exports/approvals-light.png" alt="">
</picture>

## Approvals and control

Bowerloom binds approval to a specific plan or action. Changed inputs require a new plan. An uncertain external write needs inspection and reconciliation before another attempt.

Installation, enrollment, connection changes, and external writes need their own approvals. Setup alone permits none of the later actions.

The optional `destruct <team-id>` and `destruct all` commands affect registered Bowerloom work in the selected local registry. They preserve definitions, project files, saved state, and backend services.

These commands do not stop unrelated sessions, remote machines, or another user’s work. A stop request is not proof of completed cleanup. Read the result before further action.

See the [stop guide](https://bowerloom.ai/docs/stop/) for registration, stop results, preserved state, and renewed approval before work resumes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/contributing-dark.png">
  <img src="docs/assets/readme-beta/exports/contributing-light.png" alt="">
</picture>

## Bugs, questions, and feedback

Report reproducible bugs in [GitHub Issues](https://github.com/sageadvicellc/bowerloom/issues). Search open and closed issues before creating a report.

Include the version, OS, harness, expected result, actual result, reproduction steps, and sanitized logs. Add new evidence to an existing report when applicable.

Ask questions in [Q&A](https://github.com/sageadvicellc/bowerloom/discussions/categories/q-a). Share feedback in [General](https://github.com/sageadvicellc/bowerloom/discussions/categories/general).

Discuss feature proposals in [Ideas](https://github.com/sageadvicellc/bowerloom/discussions/categories/ideas). Describe the task, problem, proposed result, and current workaround.

Read [Bug reports and feedback](https://bowerloom.ai/docs/feedback/) for report examples and privacy guidance. Keep private paths, credentials, and raw receipts private.

## Contributing


![H4N-N4 assembles a small device while S4-G3 assists Hanna at the neighboring screen.](docs/assets/readme-beta/images/contributing.webp)

Bring a small, reproducible change that the team can review.

- Describe the problem and the result that you expect.
- Include a focused example or meaningful test with your change.
- Follow the [contributor guide](https://bowerloom.ai/docs/contributors/) for source changes and review.

Keep credentials, customer data, and private references out of public issues and pull requests.

Use [GitHub Issues](https://github.com/sageadvicellc/bowerloom/issues) to agree on the scope before a large change.

## Current capabilities

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

Read the [contributor guide](https://bowerloom.ai/docs/contributors/) for source development.

Made by Sage Advice. [License](LICENSE) · [Source](https://github.com/sageadvicellc/bowerloom).
