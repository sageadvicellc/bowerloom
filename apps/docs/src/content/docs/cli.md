---
title: "CLI reference"
description: "Find the beta command forms and their required scope."
section: "Reference"
order: 22
---

Use the documentation for the installed version. This reference describes `0.7.0-beta.0`.

<!-- release:status:start -->
Open beta · 0.7.0-beta.0

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

Keep your project out of iCloud Drive folders. This beta does not support them, and it does not check for them yet. It reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

`bowerloom up --team`, `bowerloom ls`, a `skills.json` file, `bowerloom skills sync`, one-command apply, and commands that create teams, skills, and prompts are not available in this beta release. Today each skill install takes a hand-written request and installs one skill per project. Workers do not start.

## Discovery

After meeting [installation requirements](/docs/start/), read:

```sh
bowerloom --version
bowerloom --help
bowerloom init --help
```

The version output identifies `Bowerloom 0.7.0-beta.0`. Command syntax does not grant execution permission.

## Read reference forms

The forms below describe CLI help. They are reference syntax, not ready-to-run commands.

Angle brackets name required values. A vertical bar separates alternatives. Square brackets mark optional syntax.

Use absolute paths where the form requests them. Establish every private input and capability prerequisite before invoking a command.

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

These forms read public npm and public GitHub sources only. Each install uses a hand-written request and installs one skill per project. [Add a third-party skill](/docs/guides/add-skills/) explains the sequence and the refusal codes.

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
bowerloom portable plan|install <bundle-directory> --select <part,part> --harness codex --target <new-absolute-directory> [--approve <revision>]
```

These forms require a separately reviewed bundle and selected parts. Approved installation copies selected files into a new target. It starts no workers.

The portable installer accepts only `codex`. It does not establish general harness conversion. An existing target or stale approval requires inspection.

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
