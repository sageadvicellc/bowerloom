# team

The team object of Bowerloom 0.8: `team.json`, the relay map, adoption of a 0.7 team, and the start plan.

Spec: `2026-10-28-bowerloom-teams-and-relay.md`, with the decisions of sections 13 and 13.1. The contracts are `packages/harness-definition` and `packages/fidelity`.

Decision 7 keeps the relay bus out of 0.8. Nothing in this package opens a socket, starts a process, or runs an engine.

## What it does

- `loadTeam(folder, { approvals, now })` reads one `.bowerloom/teams/<id>/` folder and checks it. It writes nothing.
- `validateTeam(files, options)` checks the same files in memory. Adoption uses it, so a team that adoption plans is a team that the loader takes.
- `planTeamAdoption(input)` and `applyTeamAdoption(input, revision)` adopt a 0.7 team folder by copy.
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
- The loader also reads the 0.7 entries `team.yaml`, `agents/`, `prompts/`, `skills/`, `assets/`, and `maps/vines.json`. It scans them, and the revision covers them. Any other name is refused, so a typo is not lost.
- A file name must be plain: letters, digits, and `. _ @ : -`, at most 64 characters, and no secret shape. Another name is refused and never shown (`TEAM_FILE_NAME`).
- Every file is read through the projection's safe reader: no link, one link, owned by you, at most 1 MiB. The folder holds at most 1024 files, and at most 8 folders deep.
- A missing folder (`TEAM_FILE_MISSING`), a folder you cannot read (`TEAM_FILE_UNREADABLE`), and a link (`TEAM_FILE_UNSAFE`) are told apart.

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

Rules:

- A member uses the team harness unless it names its own (decision 10).
- `model` is one model name. It starts with a letter or digit, then holds up to 255 letters, digits, or `. _ : / @ + -`. So it is never read as a flag. A 0.7 class word (`economy`, `standard`, `reasoning`) is refused (decision 5).
- One-line text refuses control characters, C1 characters, and format characters (Unicode Cf).
- `folder` is `.`, a path inside the project, or `../<name>`, one folder beside the project. Nothing deeper is allowed beside the project.
- A `reports_to` chain must reach `human`. A loop is refused.
- An `x-<name>` key keeps other content, at the top and in a member. An `x-<engine>` key is refused, because a team holds no engine-specific syntax. A team guardrail rule or sandbox holds no `x-` key at all (`TEAM_GUARDRAIL_BLOCK`). Projection writes an engine block as it stands.

## Refusals

| Check | Code |
| --- | --- |
| 1. A route names an unknown member | `TEAM_ROUTE_UNKNOWN_MEMBER` |
| 1. The participants differ from the members | `TEAM_RELAY_PARTICIPANTS` |
| 2. A bypass or widening form | `TEAM_BYPASS` |
| 3. A secret value | `TEAM_SECRET`, or `TEAM_SECRET_SCAN_INCOMPLETE` |
| 5. One engine and one folder, two harnesses | `TEAM_FOLDER_HARNESS_CLASH` |
| 6. An enforced team guardrail the engine cannot carry | `TEAM_GUARDRAIL_NOT_CARRIED` |

- **Bypass and widening.** The scan reads every key and string of every team file, `x-` blocks too.
  - The bypass words are found anywhere in a string, with case and punctuation removed: `bypassPermissions`, `--dangerously-skip-permissions`, and `--dangerously-bypass-approvals-and-sandbox`.
  - These flags and words are found as one token: `--yolo`, `--auto`, `--full-auto`, `--auto-approve`, `--allow-all`, `--trust-all-tools`, `danger-full-access`, and `acceptEdits`.
  - These pairs are found in text, as a key and its value, and as two neighbouring strings of a list: `approval_policy never`, `--ask-for-approval never`, `--permission-mode auto`, `defaultMode acceptEdits`, and `--sandbox danger-full-access`.
  - Prose such as "we accept edits" is two tokens, and is not a flag.
- **No argv from an `x-` block.** No later consumer can build a command line, or any engine argument, from an `x-` block of a team. The scan cannot list every widening form.
- **Secrets.** The scan is the contract's `scanSecrets`, over every file the loader reads. File names are scanned too.
- **Messages.** Every problem message and path, and every adoption question, passes the secret scan before it is returned. If the scan fires, the text is dropped, and the message says that a value was withheld. If the list of problems reaches 200, its last line says how many more there are (`TEAM_PROBLEMS_TRUNCATED`).
- **Folders.** A file system can fold letter case. So if the normal forms of two folders match in any letter case, they are the same folder.
- **Guardrails.** For each member, the team rules go through the fidelity translation for the member's engine, and the contract's `checkFidelity` judges the report. A recorded `FidelityApproval` for that rule, engine, and result covers the loss. A changed rule voids it.

## Adoption

`planTeamAdoption({ source, target, answers, acknowledged, home })` reads the 0.7 team folder. It writes nothing. The target must be `<project>/.bowerloom/teams/<id>`.

- **The engine of each owner is a question.** The 0.7 schema has no engine field. The plan never offers a default engine.
- **The model of each owner is a question.** The question names the 0.7 `modelClass` as context only.
- **The team harness is a question.**
- A 0.7 id that is not a valid 0.8 id is a `rename` question. The answer is `answers.id` for the team, or `id` in the owner's answer. If the relay map names a renamed owner, adoption writes a new `maps/relay.json` and keeps the 0.7 map in `x-crew-v0.7/maps/relay.json`. In place, the 0.7 map cannot change, so the plan refuses (`TEAM_ADOPT_RENAME_IN_PLACE`).
- A role or description that does not fit on one line of 1024 characters is a question too.
- A question shows the owner id. Control and format characters are removed from the role. If the role then passes the secret scan, the question shows it too.
- `plan.defaults` lists every value the plan chose or derived:
  - folder `.`, start `manual`, inbox `hold`, and reports to `human`
  - the purpose, from the role, and the description
  - `limits.activeMembers`, from the 0.7 `maxActiveWorkers`
- Each answer is checked at once, even while other questions are open. An answered folder goes through the same confinement as the start plan.
- `role`, `prompt`, `skills`, `modelClass`, and `permissions` of each owner stay in the member's `x-crew-v0.7` block. The tasks, with their outputs and acceptance, and the other 0.7 fields stay in the team's `x-crew-v0.7` block.
- `plan.notMapped` says that the owner permissions and scope are kept in `x-crew-v0.7`, are not enforced, and become no team guardrail.
- `plan.notCarried` lists each entry adoption does not copy, with why: a name outside the 0.7 entries, a link, a name that is not plain, a file it cannot read, or a folder too deep.
- The plan is ready only after `acknowledged` names every `notCarried` and `notMapped` id.
- In place, an entry in `notCarried` stays in the folder and stops the team from loading. So the plan refuses (`TEAM_ADOPT_IN_PLACE_BLOCKED`).
- In place, the folder keeps two copies of each 0.7 entry: the original, and the copy under `x-crew-v0.7/`.

`applyTeamAdoption(input, revision)` plans again. If the revision is the same and the plan is ready, it writes. It creates files only, never replaces one, and writes `team.json` last:

- `x-crew-v0.7/team.yaml` and every 0.7 entry under `x-crew-v0.7/`, byte for byte.
- `maps/relay.json`, a copy, or a new map after a rename. If the target is the source folder, the 0.7 map is already there.
- `team.json`.

Then it checks two things:

- The 0.7 files still have their planned hashes (`TEAM_ADOPT_SOURCE_CHANGED`).
- The team loads with the planned revision (`TEAM_ADOPT_VERIFY`).

On any failure it removes what it wrote:

- A failed step keeps its error code, the file it was at, and a `cause`.
- A file or folder that cleanup cannot remove is listed as `TEAM_ADOPT_LEFT_BEHIND`, with its path.
- If nothing was left behind, the message says that adoption removed its files. Otherwise it does not say so.

Adoption takes no project lock and keeps no journal.

## The start plan

`planTeamStart(team, { projectDir, versions, harnesses, approvals, now, members, home })` lists these items for each member:

- the folder, and the engine and version
- the command and the environment names
- the delivery mode and the billing source
- how its engine carries each team guardrail

`plan.report` has one delivery line per member per mode that the member's engine offers, each with its result word. The chosen mode is marked (check 14). `plan.omitted` lists the members that a subset plan leaves out. A person approves `plan.revision`. `startsAuthorized` is always false.

**Trust.** `planTeamStart` trusts its caller for the harness entries and the engine versions. It must never be driven by a message from a relay.

- **No bus.** `plan.relay` says `bus: "absent"`, `sockets: 0`, and `processes: 0`, and lists each route as moved by a person (check 13). Each delivery line is `absent`, and names the mode and the result word that the section 6 table gives with a bus.
- **Folders.** Each folder is checked on disk from the real project folder down.
  - A link at any part is refused (`TEAM_FOLDER_LINK`).
  - These are refused as `TEAM_FOLDER_OUTSIDE`: the home folder, a folder that holds it, and a folder in a user engine config folder. Examples are `~/.claude`, `~/.codex`, `~/.config`, `~/.pi`, and `~/.dsh`.
  - A missing folder (`TEAM_START_FOLDER`) and a folder you cannot read (`TEAM_FOLDER_UNREADABLE`) are told apart.
- **Commands.** Every flag comes from a record: the Claude Code and Codex adapters in this repository, the project-sync writer, or the research notes. Each command pins the sandbox and the approval behaviour. `command.pinned` says how, and `command.ambient` names the engine config that still loads unread.
  - Claude Code does not start unattended yet (`TEAM_START_UNPINNED`). User-level Claude Code config loads and can allow requests that the harness does not. No record names the value form of `--setting-sources` that leaves them out, and the step 5 live check records the flag. The table keeps the recorded command for that day: `claude --print --model <model> --output-format json --permission-mode dontAsk --permission-prompts none --settings {"crossSessionInbound":"<inbox>","sandbox":{"enabled":true,"allowUnsandboxedCommands":false}}`, version 2.1.259 or later.
  - Codex, version 0.157.0 or later: `codex -c approval_policy="never" exec --json --sandbox workspace-write -m <model> -`. In `codex exec`, no request can ask a person. So `never` makes a request outside the sandbox fail.
  - A harness can ask for no sandbox. An unattended run is still sandboxed, and this can block work that needs the network.
  - A manual member has no command.
- **Environment names.** The `${NAME}` references in the member harness's MCP servers and hooks for that engine, and the names Bowerloom sets, such as `OPENCODE_SERVER_PASSWORD`. Never a value.

The start is refused in these cases:

| Case | Code |
| --- | --- |
| An unattended member meets an `ask` rule its engine carries, from the team or its harness | `TEAM_START_APPROVAL_UNREACHABLE` |
| OpenCode unattended: its projected default is `ask` | `TEAM_START_APPROVAL_UNREACHABLE` |
| Codex `exec` with an MCP server for Codex (open issue 24135) | `TEAM_START_APPROVAL_UNREACHABLE` |
| No record names the model flag (OpenCode, Pi), or DeepSeek Harness headless | `TEAM_START_UNDOCUMENTED` |
| No recorded flag pins the sandbox and approvals: ambient engine config not checked. This includes Claude Code, until the step 5 live check records `--setting-sources` | `TEAM_START_UNPINNED` |
| A server start on Claude Code, Codex, Pi, or DeepSeek Harness | `TEAM_START_MODE_UNSUPPORTED` |
| An engine version is missing, not semver, or older than the command needs | `TEAM_START_ENGINE_VERSION` |
| A member harness is not given, or does not list the member engine | `TEAM_START_HARNESS_MISSING`, `TEAM_START_HARNESS_ENGINE` |
| A member folder fails confinement | `TEAM_FOLDER_LINK`, `TEAM_FOLDER_OUTSIDE`, `TEAM_FOLDER_NOT_A_FOLDER`, `TEAM_FOLDER_UNREADABLE`, `TEAM_START_FOLDER` |
| An empty member list, or an unknown member | `TEAM_START_USAGE` |
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
- The safe file reads and writes reuse `project-sync/src/portable-files.ts`.
