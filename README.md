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
**Open beta · unreleased** · `0.7.0-beta.0`

**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

Setup does not start workers, grant runtime access, or authorize connected actions.

- Full runtime acceptance remains incomplete.
- The initial beta needs founder acceptance and publication approval.
- Unattended support requires an independently accepted installed security configuration.
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
**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

npm package ownership and the publishing identity are not yet verified. A selected package name does not reserve it.

The planned npm command for `0.7.0-beta.0` is shown for review. Do not run it before this exact version is published.

```sh
npm install --global bowerloom@0.7.0-beta.0
```

Requirements: Node `>=24.11.0 <25` and `npm` 11. Docker Desktop and a separate approved Supabase/PostgreSQL setup for backend operations. Backend setup is separate from installing the CLI.

Tested scope: macOS arm64, Node `24.11.0` — Isolated package installation, setup, revision, upgrade and removal with cached dependencies.

Clean public installation and additional systems remain under review. No operating system is recorded as release-qualified yet.

Cached, isolated package checks do not establish clean public or global installation. Publication and broader delivery remain gated.
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

After the documented version is published and installed, plan a new workspace:

```sh
bowerloom init plan --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Plan an accessible project website and its meaningful checks."
```

Replace the example target with your absolute project path. Use an existing parent directory and an unused target for `new` mode.

For an existing project, use `--mode existing` and its absolute directory. That mode adds only `.bowerloom/`. It leaves project files and agent application settings unread and unchanged.

A previous `.bowerloom/` directory blocks a new installation. Use the separate revision flow to change an installed setup.

The default review explains the proposed files and approval effect. Add `--json` to read every generated file and content hash.

### Approve the exact files

Read the plan before installation. Keep the target, profile, name, goal, and other inputs identical to the reviewed plan.

Replace `REPLACE_WITH_EXACT_PLAN_REVISION` with that plan’s revision. Using the same installed version, run:

```sh
bowerloom init apply --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Plan an accessible project website and its meaningful checks." --approve REPLACE_WITH_EXACT_PLAN_REVISION
bowerloom init status --target /absolute/projects/first-team
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

File portability does not establish execution in another application. Current harness commands process selected synthetic files, which contain fictional test data. Live Codex and Claude Code support remains unproven.

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

Portable routines under `.bowerloom/routines/` are planned beta work. They are absent from this generated setup. Scheduling and event triggers remain deferred.

Private connection bindings, credentials, and runtime state need separate locations and approvals. This diagram does not place them inside the portable definition folders.

## Meet the workshop

| Module | Responsibility and current boundary |
| --- | --- |
| Teams | Roles, skills, and permission definitions. Startup produces a specification, without running the team. |
| Relay | Communication definitions and approved local links. A link grants no execution or write authority. |
| Roots | Source-linked knowledge and controlled access. Beta retrieval and company access still need their acceptance evidence. |
| Vines | Logs that record work. Startup declares logging maps without a running logging service. |
| Workbench | Repeatable scenarios and comparison records. A live beta comparison remains required. |

Module names describe responsibilities. They do not imply equal readiness. Read [current support](https://bowerloom.ai/docs/status/) for the tested scope and remaining gates.

MCP, a standard connection between agents and tools, also has separate boundaries. The `mcp plan` command reads selected synthetic declarations and recorded catalogs. It does not contact a server or authorize tool calls.

Internal discovery tests remain distinct from a production connector and live team execution. Read the [MCP guide](https://bowerloom.ai/docs/mcp/) for its boundaries.

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

## Contributing


![H4N-N4 assembles a small device while S4-G3 assists Hanna at the neighboring screen.](docs/assets/readme-beta/images/contributing.webp)

Bring a small, reproducible change that the team can review.

- Describe the problem and the result that you expect.
- Include a focused example or meaningful test with your change.
- Follow the [working order](docs/transition/working-order.md) for review and branch coordination.

Keep credentials, customer data, and private references out of public issues and pull requests.

Reviewed beta changes integrate through `feature/bowerloom-beta`. Hanna decides the final `main` merge and public beta release.

## Current capabilities

<!-- release:support:start -->
**Open beta · unreleased** · `0.7.0-beta.0`

**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

Setup does not start workers, grant runtime access, or authorize connected actions.

- Full runtime acceptance remains incomplete.
- The initial beta needs founder acceptance and publication approval.
- Unattended support requires an independently accepted installed security configuration.

| Capability | Current boundary |
| --- | --- |
| Setup | Prepare and review a personal-agent profile, team specification and working agreement in a new or existing project. Exact approval installs the planned files. |
| Revision | Review an installed setup change before applying its exact revision. |
| Execution | Setup does not start workers, grant runtime access, or authorize connected actions. |
| Harnesses | Codex and Claude Code execution require separate qualification. File portability does not establish runtime support. |
| Connections | MCP connections and local backends require separate reviewed bindings and permissions. |
| Company access | Shared company access, offboarding and deletion remain release requirements. |

Recorded checks: macOS arm64, Node `24.11.0`. Isolated package installation, setup, revision, upgrade and removal with cached dependencies.

Clean public installation and additional systems remain under review. No release-qualified system is listed.
<!-- release:support:end -->

Read the [contributor guide](https://bowerloom.ai/docs/contributors/) for source development. Historical audit records remain in the repository; they are not current onboarding instructions.

Made by Sage Advice. [Package license declaration](package.json) · [Source and migration boundaries](docs/transition/monorepo-cutover.md).
