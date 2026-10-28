# team

The team object of Bowerloom 0.8: `team.json`, the relay map, adoption of a 0.7 team, and the start plan.

Spec: `2026-10-28-bowerloom-teams-and-relay.md`, with the decisions of sections 13 and 13.1. The contracts are `packages/harness-definition` and `packages/fidelity`.

Decision 7 keeps the relay bus out of 0.8. Nothing in this package opens a socket, starts a process, or runs an engine.

## What it does

- `loadTeam(folder, { approvals, now })` reads one `.bowerloom/teams/<id>/` folder and checks it. It writes nothing.
- `validateTeam(files, options)` checks the same files in memory. Adoption uses it, so a team that adoption plans is a team that the loader takes.
- `planTeamAdoption(input)` and `applyTeamAdoption(input, revision)` adopt a 0.7 `team.yaml` by copy.
- `planTeamStart(team, input)` builds the start plan. It starts nothing.

## A team folder

```
.bowerloom/teams/<id>/
  team.json             format bowerloom/team/v1beta1
  maps/relay.json       optional, the 0.7 relay map, format trellis/relay-map/v0.7-alpha
  x-crew-v0.7/          unchanged 0.7 files kept by adoption
```

- `team.json` is strict JSON. The team id equals the folder name.
- `routes` in `team.json` points at the relay map. Its only value is `"maps/relay.json"`. A map with no pointer is refused, so a map is never ignored without notice.
- The 0.7 names `team.yaml`, `agents`, `prompts`, `skills`, `assets`, and `maps/vines.json` are allowed and not read. Any other name is refused, so a typo is not lost.
- Every file is read through the projection's safe reader: no link, one link, owned by you, at most 1 MiB.

## team.json

| Field | Rule |
| --- | --- |
| `format` | `bowerloom/team/v1beta1` |
| `id`, `description` | an id, and one line |
| `harness` | optional. The default harness id of the members |
| `members` | 1 to 64 members |
| `routes` | optional. `"maps/relay.json"` |
| `limits` | `activeMembers` is required. `messages` (`perMember`, `windowSeconds`) and `costUsd` are optional |
| `guardrails` | optional. The shape of `guardrails.json`: `rules` and an optional `sandbox` |

A member has these fields:

- `id`, `purpose`, `engine`, and `model`.
- `folder`, relative to the project.
- `start`: `headless`, `server`, or `manual`.
- `inbox`: `accept`, `hold`, or `refuse`.
- `reports_to`: a member id or `human`.
- `harness`, optional.

- A member uses the team harness unless it names its own (decision 10).
- `model` is one explicit model. A 0.7 class word (`economy`, `standard`, `reasoning`) is refused (decision 5).
- `folder` is relative to the project. `.` is the project. Leading `..` reaches a worktree beside it. An absolute path, `~`, a backslash, an empty segment, and `..` after a name are refused.
- A `reports_to` chain must reach `human`. A loop is refused.
- An `x-<name>` key keeps other content, at the top and in a member. An `x-<engine>` key is refused, because a team holds no engine-specific syntax.

## Refusals

| Check | Code |
| --- | --- |
| 1. A route names an unknown member | `TEAM_ROUTE_UNKNOWN_MEMBER` |
| 1. The participants differ from the members | `TEAM_RELAY_PARTICIPANTS` |
| 2. A bypass flag or `bypassPermissions` | `TEAM_BYPASS` |
| 3. A secret value | `TEAM_SECRET`, or `TEAM_SECRET_SCAN_INCOMPLETE` |
| 5. One engine and one folder, two harnesses | `TEAM_FOLDER_HARNESS_CLASH` |
| 6. An enforced team guardrail the engine cannot carry | `TEAM_GUARDRAIL_NOT_CARRIED` |

- **Bypass.** The scan reads every key and string of `team.json` and the relay map, `x-` blocks too, and the text of each kept 0.7 file. It compares words with case and punctuation removed, so `bypassPermissions`, `bypass_permissions`, `--dangerously-skip-permissions`, and `--dangerously-bypass-approvals-and-sandbox` are all found. The whole flags `--yolo` and OpenCode's `--auto` are found too. Prose that names a bypass is refused: a team file has no command line, so a bypass word has no safe use there.
- **Secrets.** The scan is the contract's `scanSecrets`, over `team.json`, the relay map, and every kept 0.7 file. A problem never repeats the value.
- **Folders.** A file system can fold letter case. So if the normal forms of two folders match in any letter case, they are the same folder.
- **Guardrails.** For each member, the team rules go through the fidelity translation for the member's engine, and the contract's `checkFidelity` judges the report. A recorded `FidelityApproval` for that rule, engine, and result covers the loss. A changed rule voids it.

## Adoption

`planTeamAdoption({ source, target, answers })` reads the 0.7 `team.yaml` and `maps/relay.json`. It writes nothing.

- **The engine of each owner is a question.** The 0.7 schema has no engine field. The plan never offers a default engine.
- **The model of each owner is a question.** The question names the 0.7 `modelClass` as context only.
- **The team harness is a question.**
- A role or description that does not fit on one line of 1024 characters is a question too.
- Every other member field has a safe default, and `plan.defaults` lists each one: folder `.`, start `manual`, inbox `hold`, reports to `human`.
- `role`, `prompt`, `skills`, `modelClass`, and `permissions` of each owner stay in the member's `x-crew-v0.7` block. The tasks, with their outputs and acceptance, and the other 0.7 fields stay in the team's `x-crew-v0.7` block. `limits.activeMembers` is the 0.7 `maxActiveWorkers`.
- The plan scans the 0.7 files for secrets and bypass words before any question is answered.

`applyTeamAdoption(input, revision)` plans again. If the revision is the same and the plan is ready, it writes. It creates files only, never replaces one, and writes `team.json` last:

- `x-crew-v0.7/team.yaml`, a copy of the 0.7 file.
- `maps/relay.json`, a copy. If the target is the source folder, the map is already there, and adoption does not write it.
- `team.json`.

Then it checks that the 0.7 files still have their planned hashes, and that the team loads with the planned revision. On any failure it removes what it wrote. It takes no project lock and keeps no journal: it writes at most three new files, and a failure removes them at once.

## The start plan

`planTeamStart(team, { projectDir, versions, harnesses, approvals, now, members })` lists these items for each member:

- the folder, and the engine and version
- the command and the environment names
- the delivery mode and the billing source
- how its engine carries each team guardrail

 `plan.report` has one delivery line per member, with its result word (check 14). A person approves `plan.revision`. `startsAuthorized` is always false.

- **No bus.** `plan.relay` says `bus: "absent"`, `sockets: 0`, and `processes: 0`, and lists each route as moved by a person (check 13). Each delivery line is `absent`, and names the mode and the result word that the section 6 table gives with a bus.
- **Commands.** Every flag comes from a record: the Claude Code and Codex adapters in this repository, or the research notes. Claude Code runs `claude --print --model <model> --output-format json --permission-mode dontAsk --permission-prompts none --settings {"crossSessionInbound":"<inbox>"}`, version 2.1.259 or later. Codex runs `codex exec --json -m <model> -`. A manual member has no command.
- **Environment names.** The `${NAME}` references in the member harness's MCP servers and hooks for that engine, and the names Bowerloom sets, such as `OPENCODE_SERVER_PASSWORD`. Never a value.

The start is refused when:

| Case | Code |
| --- | --- |
| An unattended member meets an `ask` rule its engine carries, from the team or its harness | `TEAM_START_APPROVAL_UNREACHABLE` |
| OpenCode unattended: its projected default is `ask` | `TEAM_START_APPROVAL_UNREACHABLE` |
| Codex `exec` with an MCP server for Codex (open issue 24135) | `TEAM_START_APPROVAL_UNREACHABLE` |
| No record names the model flag (OpenCode, Pi), or DeepSeek Harness headless | `TEAM_START_UNDOCUMENTED` |
| A server start on Claude Code, Codex, Pi, or DeepSeek Harness | `TEAM_START_MODE_UNSUPPORTED` |
| An engine version is missing, not semver, or older than the command needs | `TEAM_START_ENGINE_VERSION` |
| A member harness is not given, or does not list the member engine | `TEAM_START_HARNESS_MISSING`, `TEAM_START_HARNESS_ENGINE` |
| A member folder does not exist or is a link | `TEAM_START_FOLDER` |
| More members than `limits.activeMembers` | `TEAM_START_LIMIT` |
| An enforced team guardrail is not carried, with the plan's approvals | `TEAM_GUARDRAIL_NOT_CARRIED` |

A `manual` member starts with a person present, who sees each approval. So the approval checks do not refuse it.

## Not built here

- The relay bus, its envelope, adapters, and checks 7 to 12. They wait for the Repowire trial of decision 7.
- Combining team guardrails with a member harness for projection. The projection lanes do it. A team does not project files by itself (section 8, rule 1).
- The receipt of a started team (section 8, rule 5).

## Contract notes

- Team guardrails reuse `checkGuardrails` and `Checker` from `harness-definition/src/schema.ts`, which the contract index does not export.
- The relay map reuses the 0.7 schema check in `authoring/src/contracts.ts`.
