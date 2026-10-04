<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/hero-dark.png">
  <img src="docs/assets/readme-beta/exports/hero-light.png" alt="Bowerloom, with Hanna, S4-G3, and H4N-N4 in the tree laboratory." width="100%">
</picture>

# Grow your capabilities with Bowerloom

Bowerloom is an open-source framework for building agent teams in files you can read.

Start with your personal agent and a small task you can review. Prepare a team. Inspect its roles and proposed access. Approve the exact setup plan.

Setup creates files. It does not start workers or grant permission to execute the team.

[Build with your agent](#build-with-your-agent) · [Explore the Labs workflow](#the-labs-workflow) · [Read the beta plan](https://github.com/sageadvicellc/bowerloom/issues/51)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/release-status-dark.png">
  <img src="docs/assets/readme-beta/exports/release-status-light.png" alt="">
</picture>

## Release status

The [alpha source prerelease](https://github.com/sageadvicellc/bowerloom/releases/tag/v0.7.0-alpha.0) is published. It contains source archives, without a published npm package or compiled command-line installer.

Beta development is active on `feature/bowerloom-beta`. Beta is not released or fully accepted. The instructions below use a pinned development checkout.

Reviewed source changes and focused tests support individual behaviors. They do not establish complete beta acceptance or live team execution in both Codex and Claude Code.

An installable command-line interface (CLI), both agent applications, company isolation, portable connections, and live Workbench comparisons remain beta acceptance work.

Bowerloom is free and open source. Model providers, hosting, and connected services can have separate costs. Sagespec remains private Labs configuration.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/getting-started-dark.png">
  <img src="docs/assets/readme-beta/exports/getting-started-light.png" alt="">
</picture>

## Build with your agent


![Hanna and S4-G3 study a holographic plan in a tree laboratory.](docs/assets/readme-beta/images/startup.webp)

Hanna and S4-G3 review a plan in the illustrated lab. The scene represents an intended workflow. It does not establish software behavior.

Start with the [team setup guide](docs/tutorials/team-tutorial-maker.md). Choose Engineer, Founder, or Research & development. Describe your goal and review cadence.

Your personal agent helps you review the proposed roles, access, worker limit, files, and working agreement. A working agreement records scope, responsibilities, and review points.

The setup uses fixed templates. It does not inspect your project or establish that your goal is feasible. You and your agent review that starting point before later work.

### Prepare the development checkout

Use `git`, Node 24.11 or a later Node 24 version, and `npm` 11. Keep this source checkout separate from the project that receives `.bowerloom/`.

From the directory that will contain your source checkout, run:

```sh
git clone --branch feature/bowerloom-beta https://github.com/sageadvicellc/bowerloom.git
cd bowerloom
git checkout --detach d2e5847b3c78e728a441cf2c2777fd6652c26a2c
npm ci --ignore-scripts
npm run build
node dist/apps/cli/src/main.js --help
```

This procedure builds the recorded source revision. It is not a published beta installation path.

### Plan the setup

Give your existing personal agent this starting request:

```text
Read this Bowerloom checkout and its init command.
Help me choose a new workspace or an existing project.
Use my goal to prepare a personal-agent profile and first team.
Show the full file plan and working agreement before installation.
Wait for my approval of the exact plan revision.
After installation, inspect the files with init status.
Read .bowerloom/startup-review.md and .bowerloom/START-HERE.md.
Stop for my review.
Do not start workers or import Claude or Codex settings.
```

From the built source checkout, plan a new workspace:

```sh
node dist/apps/cli/src/main.js init plan --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Plan an accessible project website and its meaningful checks."
```

Replace the example target with your absolute project path. Use an existing parent directory and an unused target for `new` mode.

For an existing project, use `--mode existing` and its absolute directory. That mode adds only `.bowerloom/`. It leaves project files and agent application settings unread and unchanged.

A previous `.bowerloom/` directory blocks a new installation. Use the separate revision flow to change an installed setup.

The default review explains the proposed files and approval effect. Add `--json` to read every generated file and content hash.

### Approve the exact files

Read the plan before installation. Keep the target, profile, name, goal, and other inputs identical to the reviewed plan.

Replace `REPLACE_WITH_EXACT_PLAN_REVISION` with that plan’s revision. From the same built source checkout, run:

```sh
node dist/apps/cli/src/main.js init apply --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Plan an accessible project website and its meaningful checks." --approve REPLACE_WITH_EXACT_PLAN_REVISION
node dist/apps/cli/src/main.js init status --target /absolute/projects/first-team
```

A changed input requires a new plan and approval. The installation approval permits only the listed setup files. It starts no workers, backend services, or connected tools.

Read `.bowerloom/startup-review.md` and `.bowerloom/START-HERE.md` with your personal agent. Stop for review before execution or connection work.

The Engineer profile defines an engineering lead, implementation maker, and code reviewer. Founder and Research profiles use different fixed role templates.

Read the [startup reference](packages/startup/README.md) for structured briefs, file boundaries, and inspection results. Read the [revision guide](docs/beta/revision-and-harness-plans.md) before changing an installed goal.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/portable-teams-dark.png">
  <img src="docs/assets/readme-beta/exports/portable-teams-light.png" alt="">
</picture>

## Portable teams


Team and skill definitions live outside any one agent application. You can read and version those files.

File portability does not establish execution in another application. Current harness commands process selected synthetic files, which contain fictional test data. Live Codex and Claude Code support remains unproven.

The [harness guide](docs/beta/revision-and-harness-plans.md) separates import, proposed changes, exact write approvals, removal, and recovery. None of those fixture commands authorizes model execution.

The separate [portable installer](docs/transition/bowerloom-migration.md) copies selected definitions. It also requires exact approval and starts no workers.

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

Generated startup definitions and the private installation receipt. Routines are planned. Connections, credentials, and runtime state remain separate.

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

Module names describe responsibilities. They do not imply equal readiness. Read the [beta engineering plan](docs/beta/engineering-plan.md) for the implemented work and remaining gates.

MCP, a standard connection between agents and tools, also has separate boundaries. The public `mcp plan` command reads selected synthetic declarations and recorded catalogs. It does not contact a server or authorize tool calls.

Internal discovery tests remain distinct from a production connector and live team execution. Read the [MCP discovery record](docs/beta/mcp-container-discovery.md) for its tested environment and open limits.

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

## A recorded GitHub workflow

The separate Labs-to-blog recipe turns selected experiment evidence into a blog draft. Your personal agent supplies the prose.

```text
Selected evidence → a proposed draft → exact approval → a GitHub draft pull request
```

The prepared trial created [draft pull request #41](https://github.com/sageadvicellc/bowerloom/pull/41). It recovered after a lost response without another write.

This result covers one prepared recipe and installation. It does not establish arbitrary automation, a newly authored runtime team, or measured productivity gains.

The recipe needs PostgreSQL and a repository-scoped GitHub App installation. Keep credentials and private installation files outside portable definitions.

Read the [recipe instructions](docs/recipes/labs-to-blog.md) and [recorded result](docs/recipes/live-acceptance.md) before use. The recipe and its approval flow are separate from startup.

Exact approval permits the proposed write. Publication and merging remain separate decisions. The tested recipe trusts a local operator. It does not independently prove human identity.

The [MCP entrypoint](apps/mcp/README.md) exposes controlled recipe operations. The operator CLI owns exact approval. MCP does not expose approval authority.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/approvals-dark.png">
  <img src="docs/assets/readme-beta/exports/approvals-light.png" alt="">
</picture>

## Approvals and control

Bowerloom binds approval to a specific plan or action. Changed inputs require a new plan. An uncertain external write needs inspection and reconciliation before another attempt.

Installation, enrollment, connection changes, and external writes need their own approvals. Setup alone permits none of the later actions.

The optional `destruct <team-id>` and `destruct all` commands affect registered Bowerloom work in the selected local registry. They preserve definitions, project files, saved state, and backend services.

These commands do not stop unrelated sessions, remote machines, or another user’s work. A stop request is not proof of completed cleanup. Read the result before further action.

See the [local controls guide](packages/local-control/README.md) for registration, stop results, preserved state, and renewed approval before work resumes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-beta/exports/contributing-dark.png">
  <img src="docs/assets/readme-beta/exports/contributing-light.png" alt="">
</picture>

## Contributing


![H4N-N4 assembles a small device while S4-G3 assists Hanna at the neighboring screen.](docs/assets/readme-beta/images/contributing.webp)

H4N-N4 builds at the illustrated lab workbench. The scene represents collaboration. It does not establish a software capability.

Bring a small, reproducible change that the team can review.

- Describe the problem and the result that you expect.
- Include a focused example or meaningful test with your change.
- Follow the [working order](docs/transition/working-order.md) for review and branch coordination.

Keep credentials, customer data, and private references out of public issues and pull requests.

Reviewed beta changes integrate through `feature/bowerloom-beta`. Hanna decides the final `main` merge and public beta release.

## Planned releases

| Release | Status and direction |
| --- | --- |
| `v0.7-alpha` | Published source prerelease with reviewed setup and a bounded Codex-first recipe |
| `v0.7-beta` | Active development toward installable distribution, both agent applications, controlled connections, company trials, and live Workbench comparisons |
| `v1-beta` | Planned broader framework integration and stress tests |
| `v1-rc` | Planned release candidate against the agreed acceptance gates |

Beta also requires portable routines, the full documentation site, homepage animation, and this README package. Required work is not evidence that a release gate passed.

Read the [beta scope](https://github.com/sageadvicellc/bowerloom/issues/51) and [release plan](docs/transition/release-plan.md) for their boundaries. Later rows are planned work.

<details>
<summary>Source records and further reading</summary>

- [Alpha source release](https://github.com/sageadvicellc/bowerloom/releases/tag/v0.7.0-alpha.0)
- [Team setup guide](docs/tutorials/team-tutorial-maker.md)
- [Startup file reference](packages/startup/README.md)
- [Revision and synthetic harness guide](docs/beta/revision-and-harness-plans.md)
- [Beta engineering plan](docs/beta/engineering-plan.md)
- [Private distribution proof and limits](tools/cli-distribution/README.md)
- [Historical alpha runtime evidence](docs/alpha/acceptance-status.md)
- [Source and migration boundaries](docs/transition/monorepo-cutover.md)

</details>

Historical evidence records retain the status of their recorded revisions. The published alpha source release and current beta plan supply the later release status.

Made by Sage Advice. [Package license declaration](package.json) · [Source and migration boundaries](docs/transition/monorepo-cutover.md).
