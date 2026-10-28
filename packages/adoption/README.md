# adoption

Adoption of Bowerloom 0.8: it reads a project's engine files and writes a harness definition by copy into `.bowerloom/`. It never changes an engine file or a 0.7 file.

Specs: `2026-10-27-bowerloom-harness-definition.md`, sections 8, 10, 11, 12, and 13. The engine forms come from the portable parts spec (4.1 to 4.5) and the locked-in parts spec (5.2, 6.2, 7.2, 8.2, 10). The contract is `packages/harness-definition`.

## What it does

- `planAdoption(input)` reads the project and returns the plan: every item with its places, conflicts, differences, unmapped entries, replaced secrets, 0.7 managed copies, the exact files, and the loader's problems. It writes nothing.
- `applyAdoption(input, revision)` plans again under the project lock. If the revision is the same, it writes. It creates files only, through the portable projection's write layer. After the writes the definition must load with `loadDefinition` and have the planned revision. On any failure it removes what it wrote.

If no conflict waits for a choice and the planned definition loads, the plan is `ready`.

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
| Claude Code `permissions`, Codex `.rules` and `disabled_tools`, OpenCode `permission`, skill `allowed-tools` and `disallowed-tools` | guardrail rules |
| Claude Code `sandbox.enabled`, Codex `sandbox_mode` | the sandbox requirement |
| Claude Code and Codex hooks | hooks |
| `.mcp.json`, Codex `mcp_servers`, OpenCode `mcp`, `.pi/mcp.json` | MCP servers |
| Other settings keys | `engines/<engine>/<file>.json` |

A field with no neutral form goes into the entry's `x-<engine>` block. A permission-like key cannot go there (`isPermissionKey`), so it is listed as unmapped with the reason. Anything else that cannot be mapped is listed with the reason. A sweep lists every file in an engine folder that no reader took.

## Merging and conflicts

- Identity is meaning: the neutral content first, then the private blocks. Identical items merge into one item that lists every place.
- An item's engine filter is the engines that read its places. With every engine of the harness, it has no filter.
- Items with the same part and id that differ are a conflict. Variants are in path order. A person picks one (`{ pick }`) or keeps them under distinct ids (`{ rename }`). The instructions and the sandbox take `pick` only.
- Guardrail rules for one action and pattern with different effects in different engines are both kept, each for its engines, and listed in `differences`.

## Secrets

A literal secret in an MCP `env`, header, argument, private block, or leftover settings key is replaced with `${NAME}`. The plan lists the place and the reference, never the value, and the entry needs approval. A secret in a Markdown file, a command, or a URL cannot be replaced safely, so that entry is listed and not adopted.

## 0.7 files

- `skills.json` and `bowerloom.json` are read through step 0's mapping of `harnesses` and `claude`. They stay byte for byte unchanged.
- A 0.7 skill in `.bowerloom/skills` is already where the definition keeps it. Adoption cannot change it, so one that the definition cannot carry refuses with `ADOPTION_LEGACY_SKILL`.
- A 0.7 managed copy (`.bowerloom/managed/...` or `.bowerloom-skills/...`) becomes a definition skill. An npm or git source is recorded in `sources.json`. `plan.managed` lists each copy and the skill it became. No 0.7 file is deleted.

## For the projection lanes

- `plan.managed` names each converted copy and its engine copies. The portable projection still refuses `PORTABLE_MANAGED_COPY` for those folders until it reads this record.
- A neutral hook command uses `${PROJECT_DIR}`. Claude Code's `$CLAUDE_PROJECT_DIR` and Codex's `$(git rev-parse --show-toplevel)` are rewritten to it.
- A hook on `PreToolUse`, `UserPromptSubmit`, or `PermissionRequest` is `enforced`. Other hooks are `advisory`.
- A Codex `allow` rule becomes a neutral `allow`. The note says Codex ran it outside the sandbox.
