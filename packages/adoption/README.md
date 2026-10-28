# adoption

Adoption of Bowerloom 0.8: it reads a project's engine files and writes a harness definition by copy into `.bowerloom/`. It never changes an engine file or a 0.7 file.

Specs: `2026-10-27-bowerloom-harness-definition.md`, sections 8, 10, 11, 12, and 13. The engine forms come from the portable parts spec (4.1 to 4.5) and the locked-in parts spec (5.2, 6.2, 7.2, 8.2, 10). The contract is `packages/harness-definition`.

## What it does

- `planAdoption(input)` reads the project and returns the plan: every item with its places, conflicts, differences, unmapped entries, replaced secrets, 0.7 managed copies, the exact files, the approvals it needs, and the loader's problems. It writes nothing. The input names a private state folder outside the project (`stateDir`).
- `applyAdoption(input, revision, approvals)` plans again under the project lock. If the revision is the same and `approvals` confirms every id in `approvalsRequired`, it writes. It creates files only, through the portable projection's write layer, and writes `harness.json` last. After the writes the definition must load with `loadDefinition` and have the planned revision. On any failure it removes what it wrote.
- `planAdoptionRecovery` and `applyAdoptionRecovery` finish a run that stopped part way. Before the first write, apply keeps a journal of the planned files in the state folder. While a journal is there, every plan refuses `ADOPTION_RECOVERY_REQUIRED`. Recovery removes exactly the journaled files that still hold the bytes adoption wrote.

If no conflict waits for a choice, every gated unmapped entry is acknowledged, nothing blocks, and the planned definition loads, the plan is `ready`.

## What a person confirms

- **Approvals** (`approvalsRequired`, passed to apply): hooks and stdio MCP servers, because they run a command. Also an MCP server with a `${NAME}` anywhere, a replaced secret ("your own value of NAME will be sent to this server"), and a private block that holds a command, a URL, or a credential helper. Also instructions that only some engines read today, and a 0.7 source the catalog only claims.
- **Acknowledgements** (`acknowledged` in the input, by unmapped id): every deny, ask, or sandbox value that is not carried. This includes an entry of a rules folder that is not read, which could hold one.
- **Blocks**: an `@path` import in the adopted instructions. The person inlines it first.

When a deny or ask of an action cannot be carried, every allow of that action from that engine is dropped too, and the plan warns. A read deny also drops edit and write allows.

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

A field with no neutral form goes into the entry's `x-<engine>` block. A permission-like key cannot go there (`isPermissionKey`), so it is listed as unmapped with the reason. Anything else that cannot be mapped is listed with the reason. Every entry of a folder a reader consumes is taken or listed, and a sweep lists every other file in an engine folder. Nested `AGENTS.md` and `CLAUDE.md` files are listed; the search skips `.git` and `node_modules`.

A skill's `allowed-tools` is listed, not adopted: a grant scoped to the skill has no neutral form, and without it the engine asks more often. A Codex MCP server with `enabled_tools` is not adopted. A subagent tool limit only ever narrows.

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
- A 0.7 managed copy (`.bowerloom/managed/...` or `.bowerloom-skills/...`) becomes a definition skill. An npm or git source is recorded in `sources.json`, and the plan marks it `claimed: true`. The contract does not take that field in `sources.json` yet. `plan.managed` lists each copy and the skill it became. A catalog copy path that is not relative is refused. A 0.7 restriction that names no engine of the harness is not converted. No 0.7 file is deleted.

## For the projection lanes

- `plan.managed` names each converted copy and its engine copies. The portable projection still refuses `PORTABLE_MANAGED_COPY` for those folders until it reads this record.
- A neutral hook command uses `${PROJECT_DIR}`. Claude Code's `$CLAUDE_PROJECT_DIR` and Codex's `$(git rev-parse --show-toplevel)` are rewritten to it.
- A hook on `PreToolUse`, `UserPromptSubmit`, or `PermissionRequest` is `enforced`. Other hooks are `advisory`.
- A Codex `allow` rule becomes a neutral `allow`. The note says Codex ran it outside the sandbox.
