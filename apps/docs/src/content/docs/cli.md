---
title: "CLI reference"
description: "Find the beta command forms and their required scope."
section: "Reference"
order: 22
---

Use the documentation for the installed version. This reference describes the `0.7.0-beta` line.

<!-- release:status:start -->
Open beta · 0.7.0-beta.1

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

Workers do not start in this beta.

## Discovery

After meeting [installation requirements](/docs/start/), read:

```sh
bowerloom --version
bowerloom --help
bowerloom help <command>
bowerloom help advanced
```

`bowerloom --help` lists the commands you use first. `bowerloom help <command>` shows the full help for `up`, `ls`, `status`, `skills`, `apply`, `team`, `skill`, `prompt`, and `init`. `bowerloom help advanced` lists every form, including the request-file forms and the plumbing commands below. A command followed by `--help` shows the same text as `help <command>`.

Bare `bowerloom` prints the short help. An unknown command prints `Unknown command <word>. Run bowerloom help.` The help heading reads `open beta`.

The version output identifies `Bowerloom 0.7.0-beta.N`. Command syntax does not grant execution permission.

## Approvals and exit codes

Every command that changes a project shows a plan first. The plan ends with a revision, a 64-character lowercase hex value that names that exact plan.

- In a terminal, the command asks `Apply plan <short revision>? [y/N]`, plans again, and applies only if the revision is unchanged.
- With `--approve <revision>`, the command applies once and never asks. A revision that no longer matches refuses with `STALE_APPROVAL` and changes nothing.
- With `--json`, or without a terminal, the command prints the plan and its revision and exits 3. Nothing is written.
- Pass `--approve` once. There is no `--yes` and no `-y`. Either one is a usage error, exit 2, and no environment variable changes that.

| Exit code | Meaning |
| --- | --- |
| 0 | Done, or nothing to change. |
| 1 | Refused. The refusal code names the reason. |
| 2 | Usage error. The command line did not match a Bowerloom command. |
| 3 | Approval required. Read the plan, then run the same command with `--approve <revision>`. |
| 4 | Held by a gate. `up` returns 4 with `prepared, workers held`, or `prepared, N items held` with a next command for each item. |
| 130 | You stopped at the yes/no question with Ctrl-C or Ctrl-D. It prints `Stopped. Nothing was changed.` |

In a terminal, a refusal prints its code, a plain sentence, and a `Next:` line. Without a terminal, a refusal prints one line of JSON on standard error: `{"error":{"code":"...","message":"..."}}`. Agents parse that line. [Errors](/docs/reference/errors/) lists the codes.

## Project commands

These commands work in a project folder. The project is the nearest parent folder that holds `.bowerloom`, found the way git finds `.git`. The search stops at your home folder. A project in a cloud-synced folder refuses with `PROJECT_IN_CLOUD_FOLDER`. A home folder or a whole disk refuses with `PROJECT_ROOT_REFUSED`.

```text
bowerloom up --team <name> [--goal <goal>] [--name <project-name>] [--approve <revision>] [--json]
bowerloom ls [teams|skills|prompts] [--json]
bowerloom status [--json]
```

`up` prepares the project one step at a time and starts no workers. See [Install Bowerloom](/docs/start/#prepare-a-project-with-one-command). With `--json`, each line is one JSON object, and each step plan names its `step` and `team`. `up` never edits `AGENTS.md` or `CLAUDE.md`, and it never runs `claude`, `codex`, or any other program. `up` ends at `prepared, workers held`. When a skill, prompt, or team is held or gone, it ends at `prepared, N items held` and prints a next command for each item.

`ls` reads the names of teams, skills, and prompts in `.bowerloom` and writes nothing. An empty section shows `none yet`. A link, a stray file, or a name that is not a plain id counts as `Not listed`, and `ls` never follows it. With `--json`, `ls` and `ls skills` also print `pinned`, a list of the pinned skill ids. `pinned` is null when `.bowerloom/skills.json` cannot be read. Run `bowerloom skills check` then. A folder with more than 256 entries refuses with `INSPECTION_LIMIT`.

`status` shows the project folder, the setup state, any drift, and any skill you edited by hand. It reads only. It prints `Workers: none started (this beta starts none)`. With `--json` it prints one object with `status`, `revision`, `drift`, `owned`, `runtimeReady`, and `executionAuthorized`. `status` names each held or missing skill, prompt, or team with its next step. A deleted prompt or team is held. Run `bowerloom prompt create <id>` to restore a registered prompt that was deleted. Restore a deleted team from version control. A skill installed by an earlier Bowerloom shows as `Legacy managed skill: .bowerloom-skills`, with the migrate command.

`bowerloom status --installation <private.json>` still reads a prepared session. See [Historical demo and session](#historical-demo).

## Create commands

```text
bowerloom team create <name> [--profile engineer|founder|research] [--approve <revision>] [--json]
bowerloom skill create <name> [--team <team>]... [--approve <revision>] [--json]
bowerloom prompt create <name> [--team <team>]... [--approve <revision>] [--json]
```

Agents use these commands most. They write inside `.bowerloom` only. You and your agents own the files they make. [Create teams, skills, and prompts](/docs/guides/create-items/) explains each one.

## Apply

```text
bowerloom apply [--harness claude|codex|both] [--approve <revision>] [--json]
```

`skills sync` already copies the skills in `.bowerloom/skills.json` into place. `apply` puts the prompts in `.bowerloom/prompts` in place for Claude Code, Codex, or both (the default), and it confirms that every skill copy is in place. Run it when the project has prompts. When every copy is already in place, it prints `Nothing to change.` and exits 0. It never fetches. It adds copies and removes none. It never overwrites a copy you changed. It never edits `AGENTS.md` or `CLAUDE.md`. The plan shows a note for a prompt that sets `allowed-tools`, registers hooks, or runs shell commands. Read that prompt before you approve. See [Add third-party skills](/docs/guides/add-skills/#apply-the-skills).

<a id="init"></a>

## First setup

```text
bowerloom init plan --mode new|existing --target <absolute-directory> --name <project-name> --goal <goal> [--profile engineer|founder|research] [--assistant <name>] [--team <name>] [--review milestones|handoff] [--json]
bowerloom init apply --mode new|existing --target <absolute-directory> --name <project-name> --goal <goal> [--profile engineer|founder|research] [--assistant <name>] [--team <name>] [--review milestones|handoff] --approve <revision>
bowerloom init plan --mode new|existing --target <absolute-directory> --brief <brief.json> [--json]
bowerloom init apply --mode new|existing --target <absolute-directory> --brief <brief.json> --approve <revision>
bowerloom init status --target <absolute-directory>
bowerloom init demo-plan --target <absolute-directory> --from <installed-revision> [--json]
```

Plans describe files. Apply requires unchanged inputs and exact approval. Status reads the installation. Demo-plan describes a synthetic handoff without execution.

[First-team tutorial](/docs/learn/first-team/) and [Existing project](/docs/guides/existing-project/) explain the sequence. A stale approval requires another plan.

<a id="revise"></a>

## Revision

```text
bowerloom revise plan --target <absolute-directory> --brief <brief.json>
bowerloom revise apply --target <absolute-directory> --brief <brief.json> --from <installed-revision> --approve <plan-revision>
bowerloom revise recover --target <absolute-directory> --approve <plan-revision> --action resume|rollback
```

Apply requires the old installed revision and exact new plan approval. Recovery uses the recorded transaction and original approval. It starts no workers.

The parser also accepts inline name, goal, profile, assistant, team, review, and plan --json. Do not mix inline fields with --brief. Read [Revision](/docs/revision/) and [Recovery](/docs/guides/recover-revision/).

<a id="control-and-destruct"></a>

## Control and stop

```text
bowerloom control plan|register --root <root> --team <id> --spec <relative-team-file> [--adapter graph|recipe --installation <private.json>] [--registry <directory>] [--approve <revision>]
bowerloom destruct <team-id> --root <root> [--registry <directory>] [--timeout-ms <milliseconds>]
bowerloom destruct all [--registry <directory>] [--timeout-ms <milliseconds>]
```

Control records a separately reviewed owner. Registration needs its exact approval. It does not start work. Destruct requests a stop within the selected registry.

A missing owner or uncertain result is not proof of cleanup. Keep the original enrollment and records. Read [Stop registered work](/docs/stop/).

<a id="link"></a>

## Local definition links

```text
bowerloom link plan --from <root> --to <root> --file <definition> --out <private-new-file>
bowerloom link apply --from <root> --to <root> --file <definition> --out <private-new-file> --approve <revision>
bowerloom link read --connection <file> --target <receiving-root>
bowerloom link revoke --connection <file>
```

Links disclose one selected definition between reviewed installed local roots. Apply requires the exact file and recipient binding. Read and revoke use the private connection record.

A link grants no execution authority. Changed source, recipient, expiry, or file binding requires inspection and renewed approval. Do not share raw receipts.

<a id="harness"></a>

## Synthetic harness configuration

```text
bowerloom harness import --harness codex|claude --file <absolute-fixture-file> --synthetic
bowerloom harness plan --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --synthetic
bowerloom harness managed-plan --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --state <new-private-directory> --synthetic
bowerloom harness apply --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --state <new-private-directory> --synthetic --approve <revision>
bowerloom harness removal-plan --state <private-directory> --synthetic
bowerloom harness remove --state <private-directory> --synthetic --approve <removal-plan-revision>
bowerloom harness recover --state <private-directory> --synthetic --approve <recorded-operation-revision>
```

Import and plan read separately reviewed synthetic inputs. Approved projection and removal change the selected fixture. Recovery requires its recorded operation approval.

The --synthetic flag is an assertion. If a file is live or unreviewed, stop. Read [Codex and Claude Code](/docs/harnesses/).

<a id="mcp"></a>

## MCP planning

```text
bowerloom mcp plan --declaration <absolute-json-file> --binding <absolute-json-file> --catalog <absolute-json-file> --synthetic
```

This form reads three reviewed synthetic files and prints a private plan. It starts no server, resolves no secret, and invokes no tool.

Keep private bindings and output private. Catalog descriptions remain untrusted data. Read [MCP connections](/docs/mcp/).

<a id="backend"></a>

## Local backend

```text
bowerloom backend doctor
bowerloom backend plan|install --root <new-absolute-directory> [--studio-port <port>] [--database-port <port>] [--approve <revision>]
bowerloom backend status --root <private-installation-directory>
```

Doctor inspects prerequisites. Plan describes a separate Supabase installation. Install needs exact approval and starts the named services. Status reads retained state.

The macOS Docker context, ARM64 daemon, Compose v2, storage, and approval requirements remain separate. Read [Local backend](/docs/backend/).

<a id="skills"></a>

## Third-party skills

```text
bowerloom skills add npm:<package>@<version>:<path> [--id <id>] [--team <team>]... [--replace] [--approve <revision>] [--json]
bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path> [--id <id>] [--team <team>]... [--replace] [--approve <revision>] [--json]
bowerloom skills check [--json]
bowerloom skills sync [--offline] [--team <team>] [--approve <revision>] [--json]
bowerloom skills recover plan|apply --item <id> [--action resume|rollback|abandon] [--approve <revision>] [--json]
bowerloom skills migrate plan|apply --state <earlier-state-folder> [--approve <revision>] [--json]
```

`skills add` pins one skill in `.bowerloom/skills.json`. The pin must be exact. An npm source takes an exact version such as `1.2.3`. A GitHub source takes a full 40-character lower-case commit, and the repository name is lower case. Ranges, tags, branches, and short commits refuse before anything is fetched. `<path>` is the skill folder inside the package or repository. `skills add` reads only `registry.npmjs.org` or `api.github.com`, without credentials. It takes MIT and Apache-2.0 skills only. It records the pin and installs nothing.

`--id` sets the entry id. The default is the skill name. `--team` limits the skill to a team. Without it, every team gets the skill. `--replace` moves an existing id to another version or commit of the same package or repository. The plan shows the old pin and the new pin, and the entry keeps its teams unless you pass `--team`. Then `skills sync` updates the copies. [Move a skill to a newer pin](/docs/guides/add-skills/#move-a-skill-to-a-newer-pin) shows an example.

`skills check` reads `.bowerloom/skills.json` and checks every pin offline. It writes nothing.

`skills sync` installs every skill in `skills.json` for Claude Code and Codex into `.bowerloom/managed`, `.claude/skills`, and `.agents/skills`. It fetches only pins that the private cache does not hold yet, and it checks every byte against its pin first. `--offline` refuses before any change if a pin still needs fetching. `--team` syncs only that team's skills. A skill whose copy you changed is held and shown with its next step, and the others apply. Sync removes nothing. Ctrl-C stops it between two skills, never inside one.

`skills recover` finishes or undoes the one unfinished change of an item, after a crash or a refusal inside it. `skills migrate` moves a skill that an earlier Bowerloom installed in `.bowerloom-skills` to `.bowerloom/managed`. `skills.json` must pin the same source first. `migrate plan` prints the `skills add` command if it does not.

[Add third-party skills](/docs/guides/add-skills/) explains the sequence and the refusal codes. `bowerloom help skills` shows the same forms.

### Request-file forms

These older forms take hand-written request files. `bowerloom help advanced` lists them. The `skills add`, `sync`, and `apply` commands above replace them for everyday use.

```text
bowerloom skills source plan --request <absolute-json> --state <private-root> --operation <id> --min-free-bytes <integer>
bowerloom skills source acquire --plan <absolute-json> --approve <revision>
bowerloom skills source git plan --request <absolute-json> --state <private-root> --operation <id> --min-free-bytes <integer>
bowerloom skills source git acquire --plan <absolute-json> --approve <revision>
bowerloom skills source inspect --request <absolute-local-cache-selector-json>
bowerloom skills source recover plan --request <absolute-json>
bowerloom skills source recover apply --plan <absolute-json> --approve <revision>
bowerloom skills plan --request <absolute-install-request-json>
bowerloom skills update plan --request <absolute-update-request-json>
bowerloom skills apply --plan <absolute-json> --approve <revision> --previous <revision|none>
bowerloom skills inspect --request <absolute-json>
bowerloom skills recover plan --request <absolute-json>
bowerloom skills recover apply --plan <absolute-json> --approve <revision>
```

These forms read public npm and public GitHub sources only. `skills recover` takes `--item` for the new forms and `--request` for the request-file forms.

<a id="routine"></a>

## Routine planning

```text
bowerloom routine plan --root <absolute-.bowerloom-directory> --experiment-id <logical-id> --experiment-digest <sha256:hex>
```

Routine planning describes a routine. It starts no workers.

<a id="portable"></a>

## Portable bundles

```text
bowerloom portable validate <bundle-directory>
bowerloom portable plan|install <bundle-directory> --select <part,part> --harness codex|claude --target <new-absolute-directory> [--approve <revision>]
```

These forms require a separately reviewed bundle and selected parts. Approved installation copies selected files into a new target. It starts no workers.

The portable installer accepts `codex` and `claude`. Any other value fails with `UNSUPPORTED_HARNESS`. The `codex` value projects skills into `.agents/skills/`. The `claude` value projects them into `.claude/skills/bowerloom-<part-id>/`. Claude Code has not been observed to discover these files natively. The installer does not establish general harness conversion. An existing target or stale approval requires inspection.

<a id="recipe"></a>

## Recipe controller

```text
bowerloom recipe inspect|setup --installation <private.json>
bowerloom recipe plan|review|approve|run|reconcile|cancel|status --installation <private.json> --input <request.json>
```

These forms require the exact private installation, input, operator authority, and accepted recipe scope. They are not a general startup procedure.

The operator CLI owns exact approval. An uncertain external result requires reconciliation of the original operation. Do not replay it blindly.

<a id="validate-and-plan"></a>

## Team source

```text
bowerloom validate <crew.yaml> [--root <directory>]
bowerloom plan <crew.yaml> [--root <directory>]
```

These forms read crew.yaml and print JSON. The source root defaults to its containing directory. They start no workers.

Use a separately scoped source tree. Successful validation does not grant runtime permission or prove a model sandbox.

<a id="authoring"></a>

## Scenario authoring

```text
bowerloom authoring validate|export <authoring.json> --scenario <frozen-scenario.json> [--root <directory>]
```

These forms require a separately frozen supported scenario. They compile the selected authoring input for that scenario.

An export is not an executed experiment. Preserve the scenario and source-license requirements in [Workbench](/docs/workbench/).

<a id="historical-demo"></a>

## Historical demo and session

```text
bowerloom up --demo --pro|--5x|--20x --installation <private.json>
bowerloom status|review|cancel --installation <private.json>
bowerloom approve --installation <private.json> --candidate <sha256:...> --action <sha256:...>
```

These forms require a private prepared installation and separately accepted execution scope. They do not replace first-team setup.

Up stops for exact approval. Approve writes and tests the stored proposal. Tier flags do not promise measured throughput. The task runner executes sequentially.

## Flags and refusal

`init plan --json` and `revise plan --json` expose the complete plan. Apply requires the exact reviewed revision, not a guessed value.

Malformed, duplicate, extra, or conflicting arguments refuse. Do not infer success without reading the actual result.

The CLI has no generic `init recover`, public MCP connect command, or general native bootstrap command.

## Compatibility aliases

`trellis` and `trellis-mcp` remain compatibility aliases. They do not expose a different authority or qualify an older runtime path.

## Support boundary

[Current support](/docs/status/) describes supported tasks and limits. [Status and error reference](/docs/reference/errors/) explains core refusals.
