# adoption

Adoption of Bowerloom 0.8: it reads a project's engine files and writes a harness definition by copy into `.bowerloom/`. It never changes an engine file or a 0.7 file.

Specs: `2026-10-27-bowerloom-harness-definition.md`, sections 8, 10, 11, 12, and 13. The engine forms come from the portable parts spec (4.1 to 4.5) and the locked-in parts spec (5.2, 6.2, 7.2, 8.2, 10). The contract is `packages/harness-definition`.

## What it does

- `planAdoption(input)` reads the project and returns the plan: every item with its places, conflicts, differences, unmapped entries, replaced secrets, 0.7 managed copies, the exact files, the approvals it needs, and the loader's problems. It writes nothing. The input names a private state folder outside the project (`stateDir`).
- `applyAdoption(input, revision, approvals)` plans again under the project lock. If the revision is the same and `approvals` confirms every id in `approvalsRequired`, it writes. It creates files only, through the portable projection's write layer, and writes `harness.json` last. After the writes the definition must load with `loadDefinition` and have the planned revision. On any failure it removes what it wrote.
- `planAdoptionRecovery` and `applyAdoptionRecovery` finish a run that stopped part way. Before the first write, apply keeps a journal of the planned files in the state folder. While a journal is there, every plan refuses `ADOPTION_RECOVERY_REQUIRED`. Recovery removes exactly the journaled files that still hold the bytes adoption wrote. If the journal does not parse, or does not fit its shape, recovery only clears it and lists the files under `.bowerloom` to check by hand.

If no conflict waits for a choice, every gated unmapped entry is acknowledged, nothing blocks, and the planned definition loads, the plan is `ready`.

## What a person confirms

- **Approvals** (`approvalsRequired`, passed to apply): hooks and stdio MCP servers, because they run a command. Also an MCP server with a `${NAME}` anywhere, a replaced secret ("your own value of NAME will be sent to this server"), and a private block that holds a command, a URL, or a credential helper. Also instructions that only some engines read today, and a 0.7 source the catalog only claims.
- **Acknowledgements** (`acknowledged` in the input, by unmapped id): every deny, ask, or sandbox value that is not carried. This includes an entry of a rules folder that is not read, and a dropped key that restricts, such as `defaultMode` or a Codex agent's `approval_policy`. A nested search that stopped early needs one too.
- **Blocks**: an `@path` import in the adopted instructions. The person inlines it first.

When a deny or ask of an action cannot be carried, every allow of that action from that engine is dropped too, and the plan warns. A read deny also drops edit and write allows. The allows of other actions stay.

A key name, server name, tool name, pattern, or model shaped like a secret is never copied: its entry is not adopted, and it is listed by place, never by name.

## Limits

One run reads at most what the loader takes: 4,096 files, 32 MiB, 4,096 entries in a folder, and 16 folders deep. Past that it refuses `ADOPTION_TOO_LARGE`. The TOML and `.rules` readers refuse nesting deeper than 64. The unmapped list shows 1,000 entries and counts the rest; gated entries are always shown. Pointers show a key only when it is a safe name, else `#<index>`.

## Engines and versions

The engines are the input's, else the engines whose files the project holds, else the 0.7 default. `AGENTS.md` and `.agents/skills` name no engine: several engines read them.

The readers follow the forms of Claude Code 2.1.310, Codex 0.157.0, OpenCode 1.18.30, Pi 1.4.0, and DeepSeek Harness 0.2.2-alpha.2 (`READER_VERSIONS`). Each place records the version its form belongs to.

- OpenCode: only the 1.x shape is read. A 2.x shape, or a recorded version that is not 1.x, refuses with `ADOPTION_OPENCODE_VERSION`.
- DeepSeek Harness: the tag is pinned. Any other tag refuses with `ADOPTION_DSH_TAG`. The pinned tag is recorded in `harness.json`.

## Engine file to part

| Engine file | Part |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md` | instructions. A `CLAUDE.md` that is `@AGENTS.md` is one more place of `AGENTS.md`. |
| `.claude/skills`, `.agents/skills`, `.opencode/skills`, `.pi/skills`, `.dsh/skills` | skills |
| `.claude/agents/*.md`, `.codex/agents/*.toml`, OpenCode `agent` and `.opencode/agents/*.md` | subagents |
| Claude Code `permissions`, Codex `.rules` and `disabled_tools`, OpenCode `permission`, skill `disallowed-tools` | guardrail rules |
| Claude Code `sandbox.enabled`, Codex `sandbox_mode` | the sandbox requirement |
| Claude Code and Codex hooks | hooks |
| `.mcp.json`, Codex `mcp_servers`, OpenCode `mcp`, `.pi/mcp.json` | MCP servers |
| Other settings keys | `engines/<engine>/<file>.json` |

A field with no neutral form goes into the entry's `x-<engine>` block. A permission-like key cannot go there (`isPermissionKey`), so it is listed as unmapped with the reason. That covers keys that run a command or grant trust, such as Claude Code's `awsAuthRefresh` or `enabledPlugins` and Codex's `notify` or `model_providers`. An OpenCode agent's `mode` (`primary`, `subagent`, or `all`) goes into its `x-opencode` block; any other mode is listed. Anything else that cannot be mapped is listed with the reason. Every entry of a folder a reader consumes is taken or listed, and a sweep lists every other file in an engine folder. Nested `AGENTS.md` and `CLAUDE.md` files are listed. The search skips `.git` and `node_modules` at every depth, and counts toward the read budget.

A skill's `allowed-tools` is listed, not adopted: a grant scoped to the skill has no neutral form, and without it the engine asks more often. A Codex MCP server with `enabled_tools` is not adopted, nor is a Codex agent with the read-only sandbox. A subagent tool limit only ever narrows. An MCP deny removes an allowed server by its whole name, a tool of it, or a glob that matches it.

## Merging and conflicts

- Identity is meaning: the neutral content first, then the private blocks. Identical items merge into one item that lists every place. If the copies differ in bytes, a note names them. Two copies that one engine reads, one with a private block and one without, are a conflict.
- An item's engine filter is the engines that read its places. With every engine of the harness, it has no filter.
- Items with the same part and id that differ are a conflict. Variants are in path order. A person picks one (`{ pick }`) or keeps them under distinct ids (`{ rename }`). The instructions and the sandbox take `pick` only.
- Guardrail rules for one action and pattern with different effects in different engines are both kept, each for its engines, and listed in `differences`.

## Secrets

A literal secret in an MCP `env`, header, argument, private block, or leftover settings key is replaced with `${NAME}`. The plan lists the place and the reference, never the value, and the entry needs approval. A secret in a Markdown file, a command, or a URL cannot be replaced safely, so that entry is listed and not adopted.

## 0.7 files

- `skills.json` and `bowerloom.json` are read through step 0's mapping of `harnesses` and `claude`. They stay byte for byte unchanged.
- A 0.7 skill in `.bowerloom/skills` is already where the definition keeps it. Adoption cannot change it, so one that the definition cannot carry refuses with `ADOPTION_LEGACY_SKILL`.
- A 0.7 managed copy (`.bowerloom/managed/...` or `.bowerloom-skills/...`) becomes a definition skill. `sources.json` records the conversion in `adopted`: the skill id and `adoptedFrom: { kind: "0.7-managed", path, sha256 }`, where `path` is the canonical copy and `sha256` is the hex of its skill content hash. An npm or git source goes into `sources` with `claimed: true`, because the 0.7 catalog only claims it. `plan.managed` lists each copy and the skill it became, and the plan item carries `adoptedFrom`. A catalog copy path that is not relative is refused. A 0.7 restriction that names no engine of the harness is not converted. No 0.7 file is deleted.

## For the projection lanes

- `plan.managed` names each converted copy and its engine copies. The portable projection takes an engine folder that a 0.7 managed copy holds when `sources.json` records the skill in `adopted` and the folder still has that content hash: it replaces the files and saves the originals, so removal restores the 0.7 copy. Any other such folder still refuses `PORTABLE_MANAGED_COPY`.
- A neutral hook command uses `${PROJECT_DIR}`. Claude Code's `$CLAUDE_PROJECT_DIR` and Codex's `$(git rev-parse --show-toplevel)` are rewritten to it.
- A hook on `PreToolUse`, `UserPromptSubmit`, or `PermissionRequest` is `enforced`. Other hooks are `advisory`.
- A Codex `allow` rule becomes a neutral `allow`. The note says Codex ran it outside the sandbox.
- A Codex rule's `justification`, `match`, and `not_match` go into its `x-codex` block. A justification of the form `Bowerloom guardrail <id>` is the one the rules writer gives a rule with none of its own, so it is not kept.
- In a Codex hook matcher, `exec_command` becomes `Bash`, `spawn_agent` becomes `Agent`, and `apply_patch`, the Codex edit tool, becomes `Edit|Write|MultiEdit|NotebookEdit`. The hook writer maps each back for Codex.
- A managed copy kept under another id gets no `adoptedFrom`: the record names only the canonical copy of its own id.

## The round trip (checks 1 and 9)

`test/roundtrip.test.mjs` adopts each engine's files, projects the definition with the full projection into a fresh project, and adopts that project again. MCP servers, subagents, hooks, and the sandbox come back as the same entries, with the same private blocks. Guardrails are compared by the decision the engine makes from the source file and from the projected file. These differences are expected, each with the result of its loss line:

- Every engine: the engine-private file of leftover settings (`engines/<engine>/...`) is not projected in this step: `absent`.
- Claude Code: a web deny also covers subdomains, so the projection blocks more: `weakened`. The sandbox also gets `allowUnsandboxedCommands: false` (ruling B11), which adoption lists as permission-like: the sandbox line stays `exact`. A key of the sandbox's `x-claude-code` block is not written until the step 5 live check documents it: an `absent` field line.
- Codex: the sandbox requirement and its `x-codex` block are not written until the step 5 live check confirms the permission profile (ruling B6): `weakened`.
- OpenCode: Bowerloom writes `"*": { "*": "ask" }` first, so a request the source left to OpenCode's own default (allow) asks. A shell deny is written with `*` for its spaces, and the web deny `*` also covers web search, so both block more: `translated`.
- DeepSeek Harness keeps MCP servers, hooks, and permissions outside the project, so there is nothing to carry. Pi carries MCP servers only.
